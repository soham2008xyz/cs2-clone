import type { WebSocket } from 'ws';
import {
  applyArmor,
  BTN,
  buttonsToMove,
  DEFAULT_PISTOL,
  encode,
  getMap,
  getWeapon,
  MAX_HP,
  mulberry32,
  PFLAG,
  SNAPSHOT_RATE,
  START_MONEY,
  stepMovement,
  TICK_DT,
  TICK_RATE,
  traceShot,
  type CombatTarget,
  type CompiledMap,
  type GameEvent,
  type InputMsg,
  type PlayerSnap,
  type RosterEntry,
  type SelfState,
  type TeamId,
  type Vec2,
  type WeaponDef,
} from '@cs2d/shared';
import { LagCompensator } from './lagcomp.js';

const SNAPSHOT_EVERY = Math.round(TICK_RATE / SNAPSHOT_RATE);
const MAX_QUEUED_INPUTS = 8;
const RESPAWN_TICKS = 5 * TICK_RATE; // Phase 3 test mode; replaced by rounds in Phase 4

export interface WeaponSlot {
  id: string;
  ammo: number;
  reserve: number;
}

export interface PlayerConn {
  id: number;
  ws: WebSocket | null; // null = bot
  name: string;
  team: TeamId;
  pos: Vec2;
  aim: number;
  hp: number;
  armor: number;
  money: number;
  alive: boolean;
  primary: WeaponSlot | null;
  secondary: WeaponSlot | null;
  activeSlot: 1 | 2 | 3;
  reloadEndTick: number; // 0 = not reloading
  nextShotTick: number;
  bloom: number; // accumulated recoil spread
  buttons: number;
  prevButtons: number;
  lastSeq: number;
  lastSeenTick?: number;
  inputQueue: InputMsg[];
  respawnTick: number;
  kills: number;
  deaths: number;
}

const slotOf = (p: PlayerConn): WeaponSlot | null =>
  p.activeSlot === 1 ? p.primary : p.activeSlot === 2 ? p.secondary : null;

export const activeWeapon = (p: PlayerConn): WeaponDef => {
  const slot = slotOf(p);
  return getWeapon(slot ? slot.id : 'knife');
};

export class Room {
  readonly map: CompiledMap;
  readonly players = new Map<number, PlayerConn>();
  tick = 0;
  private nextId = 1;
  private timer: ReturnType<typeof setInterval> | null = null;
  private rng = mulberry32(0xc0ffee);
  private lagComp = new LagCompensator();
  private events: Array<{ ev: GameEvent; to?: number }> = [];

  constructor(mapName: string) {
    this.map = getMap(mapName);
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => this.step(), 1000 / TICK_RATE);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  private pickTeam(requested?: TeamId): TeamId {
    if (requested) return requested;
    let t = 0;
    let ct = 0;
    for (const p of this.players.values()) p.team === 'T' ? t++ : ct++;
    return t <= ct ? 'T' : 'CT';
  }

  private spawnPos(team: TeamId): Vec2 {
    const spawns = this.map.spawns[team];
    const used = [...this.players.values()].filter((p) => p.team === team).length;
    return { ...spawns[used % spawns.length] };
  }

  /** Phase 3 test loadout: rifle + pistol. Phase 4 replaces with the buy system. */
  private giveLoadout(p: PlayerConn): void {
    const rifleId = p.team === 'T' ? 'ak47' : 'm4a4';
    const rifle = getWeapon(rifleId);
    const pistol = getWeapon(DEFAULT_PISTOL[p.team]);
    p.primary = { id: rifle.id, ammo: rifle.magazine, reserve: rifle.reserve };
    p.secondary = { id: pistol.id, ammo: pistol.magazine, reserve: pistol.reserve };
    p.activeSlot = 1;
  }

  addPlayer(ws: WebSocket | null, name: string, requestedTeam?: TeamId): PlayerConn {
    const team = this.pickTeam(requestedTeam);
    const player: PlayerConn = {
      id: this.nextId++,
      ws,
      name: name.slice(0, 24) || 'Player',
      team,
      pos: this.spawnPos(team),
      aim: 0,
      hp: MAX_HP,
      armor: 0,
      money: START_MONEY,
      alive: true,
      primary: null,
      secondary: null,
      activeSlot: 1,
      reloadEndTick: 0,
      nextShotTick: 0,
      bloom: 0,
      buttons: 0,
      prevButtons: 0,
      lastSeq: 0,
      inputQueue: [],
      respawnTick: 0,
      kills: 0,
      deaths: 0,
    };
    this.giveLoadout(player);
    this.players.set(player.id, player);
    ws?.send(encode({ t: 'welcome', id: player.id, map: this.map.def.name, tick: this.tick }));
    this.broadcastRoster();
    return player;
  }

  removePlayer(id: number): void {
    this.players.delete(id);
    this.broadcastRoster();
  }

  handleInput(id: number, msg: InputMsg): void {
    const p = this.players.get(id);
    if (!p) return;
    if (msg.s <= p.lastSeq) return;
    if (p.inputQueue.length >= MAX_QUEUED_INPUTS) p.inputQueue.shift();
    p.inputQueue.push(msg);
  }

  private emit(ev: GameEvent, to?: number): void {
    this.events.push({ ev, to });
  }

  // ── weapon handling ──────────────────────────────────────────────────────

  private startReload(p: PlayerConn): void {
    const slot = slotOf(p);
    if (!slot || p.reloadEndTick > 0) return;
    const w = getWeapon(slot.id);
    if (slot.ammo >= w.magazine || slot.reserve <= 0) return;
    p.reloadEndTick = this.tick + Math.round(w.reloadSec * TICK_RATE);
  }

  private finishReload(p: PlayerConn): void {
    const slot = slotOf(p);
    if (!slot) return;
    const w = getWeapon(slot.id);
    const need = w.magazine - slot.ammo;
    const take = Math.min(need, slot.reserve);
    slot.ammo += take;
    slot.reserve -= take;
  }

  private switchSlot(p: PlayerConn, slot: number): void {
    if (slot === p.activeSlot) return;
    if (slot === 1 && !p.primary) return;
    if (slot === 2 && !p.secondary) return;
    if (slot < 1 || slot > 3) return;
    p.activeSlot = slot as 1 | 2 | 3;
    p.reloadEndTick = 0; // switching cancels reload
    const w = activeWeapon(p);
    p.nextShotTick = Math.max(p.nextShotTick, this.tick + Math.round(0.25 * TICK_RATE));
    void w;
  }

  private tryFire(p: PlayerConn, input: InputMsg): void {
    const w = activeWeapon(p);
    const slot = slotOf(p);
    if (this.tick < p.nextShotTick || p.reloadEndTick > 0) return;
    // semi-auto requires a fresh press
    if (!w.auto && (p.prevButtons & BTN.ATTACK) !== 0) return;
    if (slot && slot.ammo <= 0) {
      this.startReload(p);
      return;
    }

    p.nextShotTick = this.tick + Math.max(1, Math.round(TICK_RATE / (w.rpm / 60)));
    if (slot) slot.ammo--;

    const moving = (input.b & (BTN.UP | BTN.DOWN | BTN.LEFT | BTN.RIGHT)) !== 0;
    const walking = (input.b & BTN.WALK) !== 0;
    const spread = w.spreadBase + (moving && !walking ? w.spreadMove : 0) + p.bloom;
    p.bloom = Math.min(0.12, p.bloom + w.spreadPerShot);

    // lag-compensated target positions
    const rewound = this.lagComp.rewind(p.lastSeenTick, this.tick);
    const targets: CombatTarget[] = [];
    for (const other of this.players.values()) {
      if (other.id === p.id || !other.alive) continue;
      const pos = rewound?.get(other.id) ?? other.pos;
      targets.push({ id: other.id, pos, team: other.team, alive: other.alive });
    }

    const result = traceShot(p.pos, input.a, spread, w, p.team, targets, this.map, this.rng);
    this.emit({ e: 'shot', id: p.id, x: p.pos.x, y: p.pos.y, tx: result.end.x, ty: result.end.y, w: w.id });

    if (result.hit) {
      const victim = this.players.get(result.hit.targetId);
      if (victim?.alive) {
        const { hpDamage, armor } = applyArmor(result.hit.rawDamage, victim.armor, w.armorPen);
        victim.armor = armor;
        victim.hp -= hpDamage;
        this.emit({ e: 'hit', id: p.id, target: victim.id, d: hpDamage }, p.id);
        this.emit({ e: 'hurt', d: hpDamage, from: p.id }, victim.id);
        if (victim.hp <= 0) this.onKill(p, victim, w);
      }
    }
  }

  private onKill(killer: PlayerConn, victim: PlayerConn, weapon: WeaponDef): void {
    victim.hp = 0;
    victim.alive = false;
    victim.deaths++;
    victim.respawnTick = this.tick + RESPAWN_TICKS;
    killer.kills++;
    killer.money = Math.min(16000, killer.money + weapon.killReward);
    this.emit({ e: 'kill', k: killer.id, v: victim.id, w: weapon.id });
  }

  // ── main loop ────────────────────────────────────────────────────────────

  private step(): void {
    this.tick++;

    for (const p of this.players.values()) {
      // Phase 3 test respawns (rounds replace this in Phase 4)
      if (!p.alive && p.respawnTick > 0 && this.tick >= p.respawnTick) {
        p.alive = true;
        p.hp = MAX_HP;
        p.armor = 0;
        p.bloom = 0;
        p.respawnTick = 0;
        p.pos = this.spawnPos(p.team);
        this.giveLoadout(p);
      }

      if (p.reloadEndTick > 0 && this.tick >= p.reloadEndTick) {
        p.reloadEndTick = 0;
        this.finishReload(p);
      }

      const queue = p.inputQueue;
      p.inputQueue = [];
      for (const input of queue) {
        p.lastSeq = input.s;
        if (input.k !== undefined) p.lastSeenTick = input.k;
        p.aim = input.a;
        if (p.alive) {
          if (input.w) this.switchSlot(p, input.w);
          if (input.b & BTN.RELOAD) this.startReload(p);
          p.pos = stepMovement(p.pos, buttonsToMove(input.b), activeWeapon(p).mobility, this.map, TICK_DT);
          if (input.b & BTN.ATTACK) this.tryFire(p, input);
        }
        p.prevButtons = input.b;
        p.buttons = input.b;
      }

      // recoil bloom decay
      const w = activeWeapon(p);
      if (w.spreadDecay > 0) p.bloom = Math.max(0, p.bloom - w.spreadDecay * TICK_DT);
    }

    this.lagComp.record(this.tick, this.players.values());
    if (this.tick % SNAPSHOT_EVERY === 0) this.broadcastSnapshot();
  }

  // ── snapshots ────────────────────────────────────────────────────────────

  private snapPlayers(): PlayerSnap[] {
    const snaps: PlayerSnap[] = [];
    for (const p of this.players.values()) {
      let flags = 0;
      if (p.alive) flags |= PFLAG.ALIVE;
      if ((p.buttons & BTN.WALK) !== 0) flags |= PFLAG.WALKING;
      if (p.reloadEndTick > 0) flags |= PFLAG.RELOADING;
      snaps.push([
        p.id,
        Math.round(p.pos.x * 10) / 10,
        Math.round(p.pos.y * 10) / 10,
        Math.round(p.aim * 1000) / 1000,
        p.hp,
        flags,
        activeWeapon(p).id,
      ]);
    }
    return snaps;
  }

  private selfState(p: PlayerConn): SelfState {
    const slot = slotOf(p);
    return {
      ammo: slot?.ammo ?? 0,
      reserve: slot?.reserve ?? 0,
      armor: p.armor,
      money: p.money,
      slot: p.activeSlot,
      weapon: activeWeapon(p).id,
      reload: p.reloadEndTick > 0 ? p.reloadEndTick - this.tick : 0,
    };
  }

  private broadcastSnapshot(): void {
    const players = this.snapPlayers();
    const events = this.events;
    this.events = [];
    for (const p of this.players.values()) {
      if (!p.ws) continue;
      const ev = events.filter((e) => e.to === undefined || e.to === p.id).map((e) => e.ev);
      p.ws.send(
        encode({ t: 's', k: this.tick, a: p.lastSeq, p: players, me: this.selfState(p), ...(ev.length ? { ev } : {}) }),
      );
    }
  }

  broadcastRoster(): void {
    const roster: RosterEntry[] = [...this.players.values()].map((p) => ({
      id: p.id,
      name: p.name,
      team: p.team,
    }));
    for (const p of this.players.values()) {
      p.ws?.send(encode({ t: 'roster', players: roster }));
    }
  }
}
