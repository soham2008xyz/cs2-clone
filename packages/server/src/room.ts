import type { WebSocket } from 'ws';
import {
  applyArmor,
  BOMB_TIME,
  BTN,
  BUY_WINDOW,
  BUYZONE_RADIUS_TILES,
  buttonsToMove,
  clampMoney,
  DEFAULT_PISTOL,
  DEFUSE_TIME,
  DEFUSE_TIME_KIT,
  dist,
  encode,
  FRIENDLY_FIRE,
  fromAngle,
  FREEZE_TIME,
  getGrenade,
  getMap,
  getWeapon,
  GRENADE_MAX_TOTAL,
  HELMET_PEN_MULT,
  GRENADE_THROW_SPEED,
  GRENADES,
  HE_ARMOR_PENETRATION,
  isOvertimeHalfStart,
  isPistolRound,
  isSideSwap,
  matchWinner,
  MAX_HP,
  MOLOTOV_DPS,
  MOLOTOV_DURATION,
  MOLOTOV_RADIUS,
  mulberry32,
  OT_MONEY,
  PFLAG,
  PICKUP_RADIUS,
  PLANT_REWARD,
  PLANT_TIME,
  PRICE_DEFUSE_KIT,
  PRICE_HELMET,
  PRICE_KEVLAR,
  resolveFlashBlind,
  resolveHeDamage,
  ROUND_END_TIME,
  ROUND_TIME,
  roundPayout,
  SMOKE_BLOOM_TIME,
  SMOKE_DURATION,
  SMOKE_RADIUS,
  SNAPSHOT_RATE,
  START_MONEY,
  stepGrenade,
  stepMovement,
  TICK_DT,
  TICK_RATE,
  TILE_SIZE,
  traceShot,
  WEAPONS,
  type CombatTarget,
  type CompiledMap,
  type GameEvent,
  type GrenadeKind,
  type GroundItem,
  type InputMsg,
  type LossStreaks,
  type MatchPhase,
  type MatchSnap,
  type NadeSnap,
  type Occluder,
  type PlayerSnap,
  type RosterEntry,
  type RoundEndReason,
  type SelfState,
  type TeamId,
  type Vec2,
  type WeaponDef,
  type ZoneSnap,
} from '@cs2d/shared';
import { BotController, type BotDifficulty } from './bots/bot.js';
import { LagCompensator } from './lagcomp.js';

const SNAPSHOT_EVERY = Math.round(TICK_RATE / SNAPSHOT_RATE);
const MAX_QUEUED_INPUTS = 8;
const WARMUP_RESPAWN_TICKS = 3 * TICK_RATE;
const MATCH_END_TICKS = 15 * TICK_RATE;
const BOMB_EXPLOSION_RADIUS = 350;
const BOMB_EXPLOSION_DAMAGE = 300;
const BOMB_ARMOR_PEN = 0.6;
const DEFUSE_RADIUS = 56;

const sec = (s: number): number => Math.round(s * TICK_RATE);

/** Round timings in seconds — overridable for fast integration tests. */
export interface RoomTimings {
  freeze: number;
  round: number;
  bomb: number;
  plant: number;
  defuse: number;
  defuseKit: number;
  roundEnd: number;
}

const DEFAULT_TIMINGS: RoomTimings = {
  freeze: FREEZE_TIME,
  round: ROUND_TIME,
  bomb: BOMB_TIME,
  plant: PLANT_TIME,
  defuse: DEFUSE_TIME,
  defuseKit: DEFUSE_TIME_KIT,
  roundEnd: ROUND_END_TIME,
};

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
  hasBomb: boolean;
  hasKit: boolean;
  hasHelmet: boolean;
  primary: WeaponSlot | null;
  secondary: WeaponSlot | null;
  nades: string[]; // owned grenade ids, throw order (front = next thrown)
  activeSlot: 1 | 2 | 3 | 4;
  reloadEndTick: number;
  nextShotTick: number;
  bloom: number;
  buttons: number;
  prevButtons: number;
  lastSeq: number;
  lastSeenTick?: number;
  inputQueue: InputMsg[];
  respawnTick: number; // warmup only
  actionStartTick: number; // plant/defuse progress (0 = none)
  blindUntilTick: number; // 0 = not blinded
  kills: number;
  deaths: number;
}

interface BombState {
  mode: 'none' | 'carried' | 'dropped' | 'planted';
  pos: Vec2;
  carrierId: number;
  explodeTick: number;
}

interface ActiveNade {
  id: number;
  kind: GrenadeKind;
  pos: Vec2;
  vel: Vec2;
  fuseTick: number; // timed detonation (he / flash)
  bornTick: number; // throw tick, for rest/impact detonation windows
  ownerId: number;
  ownerTeam: TeamId;
}

// Physical detonation windows (smokes bloom at rest, fire ignites on impact)
const SMOKE_MIN_AIR_SEC = 0.5;
const SMOKE_MAX_AIR_SEC = 3.5;
const FIRE_MAX_AIR_SEC = 2;

interface SmokeZone {
  id: number;
  pos: Vec2;
  startTick: number;
  untilTick: number;
}

interface FireZone {
  id: number;
  kind: GrenadeKind; // molotov or incendiary (killfeed label)
  pos: Vec2;
  untilTick: number;
  ownerId: number;
  ownerTeam: TeamId;
}

const slotOf = (p: PlayerConn): WeaponSlot | null =>
  p.activeSlot === 1 ? p.primary : p.activeSlot === 2 ? p.secondary : null;

export const activeWeapon = (p: PlayerConn): WeaponDef => {
  const slot = slotOf(p);
  return getWeapon(slot ? slot.id : 'knife');
};

/** Helmets make armor absorb more of every hit. */
const penVs = (victim: PlayerConn, pen: number): number => (victim.hasHelmet ? pen * HELMET_PEN_MULT : pen);

export class Room {
  readonly map: CompiledMap;
  readonly players = new Map<number, PlayerConn>();
  tick = 0;

  phase: MatchPhase = 'waiting';
  phaseEndTick = 0;
  roundNumber = 0;
  score: Record<TeamId, number> = { T: 0, CT: 0 };
  private streaks: LossStreaks = { T: 0, CT: 0 };
  private bomb: BombState = { mode: 'none', pos: { x: 0, y: 0 }, carrierId: 0, explodeTick: 0 };
  private bombWasPlanted = false;
  private liveStartTick = 0;
  private groundItems = new Map<number, { weaponId: string; pos: Vec2; ammo: number; reserve: number }>();
  private nextItemId = 1;
  private activeNades = new Map<number, ActiveNade>();
  private smokes = new Map<number, SmokeZone>();
  private fires = new Map<number, FireZone>();
  private fireVersion = 0;
  private nextNadeId = 1;
  private nextZoneId = 1;
  private bots = new Map<number, BotController>();
  private nextBotName = 1;

  private nextId = 1;
  private timer: ReturnType<typeof setInterval> | null = null;
  private rng = mulberry32(0xc0ffee);
  private lagComp = new LagCompensator();
  private events: Array<{ ev: GameEvent; to?: number }> = [];

  readonly times: RoomTimings;

  constructor(mapName: string, timings: Partial<RoomTimings> = {}) {
    this.map = getMap(mapName);
    this.times = { ...DEFAULT_TIMINGS, ...timings };
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => this.step(), 1000 / TICK_RATE);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  // ── players ───────────────────────────────────────────────────────────────

  private pickTeam(requested?: TeamId): TeamId {
    if (requested === 'T' || requested === 'CT') return requested;
    let t = 0;
    let ct = 0;
    for (const p of this.players.values()) p.team === 'T' ? t++ : ct++;
    return t <= ct ? 'T' : 'CT';
  }

  private spawnPos(team: TeamId, index: number): Vec2 {
    const spawns = this.map.spawns[team];
    return { ...spawns[index % spawns.length] };
  }

  /** Assigns the team's default pistol; leaves any held primary untouched. */
  private givePistolLoadout(p: PlayerConn): void {
    const pistol = getWeapon(DEFAULT_PISTOL[p.team]);
    p.secondary = { id: pistol.id, ammo: pistol.magazine, reserve: pistol.reserve };
    p.activeSlot = 2;
  }

  addPlayer(ws: WebSocket | null, name: string, requestedTeam?: TeamId): PlayerConn {
    const team = this.pickTeam(requestedTeam);
    const player: PlayerConn = {
      id: this.nextId++,
      ws,
      name: name.slice(0, 24) || 'Player',
      team,
      pos: { x: 0, y: 0 },
      aim: 0,
      hp: MAX_HP,
      armor: 0,
      money: START_MONEY,
      alive: true,
      hasBomb: false,
      hasKit: false,
      hasHelmet: false,
      primary: null,
      secondary: null,
      nades: [],
      activeSlot: 2,
      reloadEndTick: 0,
      nextShotTick: 0,
      bloom: 0,
      buttons: 0,
      prevButtons: 0,
      lastSeq: 0,
      inputQueue: [],
      respawnTick: 0,
      actionStartTick: 0,
      blindUntilTick: 0,
      kills: 0,
      deaths: 0,
    };
    this.givePistolLoadout(player);
    const teamCount = [...this.players.values()].filter((q) => q.team === team).length;
    player.pos = this.spawnPos(team, teamCount);
    this.players.set(player.id, player);
    ws?.send(encode({ t: 'welcome', id: player.id, map: this.map.def.name, tick: this.tick }));
    this.broadcastRoster();

    // mid-round joiners wait dead until next round (except warmup)
    if (this.phase !== 'waiting' && this.phase !== 'freeze') {
      player.alive = false;
    }
    return player;
  }

  /** Returns the departing player's team (for bot-backfill decisions), or null if unknown. */
  removePlayer(id: number): TeamId | null {
    const p = this.players.get(id);
    if (p?.hasBomb) this.dropBomb(p);
    this.players.delete(id);
    this.bots.delete(id);
    this.broadcastRoster();
    return p?.team ?? null;
  }

  /** Pre-match team switch only — avoids mid-round economy/loadout weirdness. */
  setTeam(id: number, team: TeamId): void {
    if (team !== 'T' && team !== 'CT') return;
    const p = this.players.get(id);
    if (!p || p.team === team || this.phase !== 'waiting') return;
    p.team = team;
    const teamCount = this.teamPlayers(team).length - 1;
    p.pos = this.spawnPos(team, Math.max(0, teamCount));
    p.primary = null; // switching sides resets the loadout
    this.givePistolLoadout(p);
    this.broadcastRoster();
  }

  broadcastChat(from: string, team: TeamId | null, text: string): void {
    const trimmed = text.slice(0, 240).trim();
    if (!trimmed) return;
    for (const p of this.players.values()) {
      p.ws?.send(encode({ t: 'chat', from, team, text: trimmed }));
    }
  }

  /** Public read surface for bot AI (kept separate from the private simulation fields above). */
  get bombInfo(): { pos: Vec2; mode: BombState['mode'] } {
    return { pos: this.bomb.pos, mode: this.bomb.mode };
  }

  get smokeOccluders(): Occluder[] {
    return [...this.smokes.values()].map((s) => ({ pos: s.pos, radius: this.smokeRadius(s) }));
  }

  /** Active fire patches + a version counter so bots know when to repath around them. */
  get fireInfo(): { version: number; zones: Array<{ pos: Vec2; radius: number }> } {
    return {
      version: this.fireVersion,
      zones: [...this.fires.values()].map((f) => ({ pos: f.pos, radius: MOLOTOV_RADIUS })),
    };
  }

  /** CT-bot shared info: last site the bomb carrier was spotted heading toward. */
  botIntel: { site: 'A' | 'B'; tick: number } | null = null;

  addBot(team?: TeamId, difficulty: BotDifficulty = 'normal'): PlayerConn {
    const p = this.addPlayer(null, `Bot_${this.nextBotName++}`, team);
    this.bots.set(p.id, new BotController(p.id, difficulty));
    return p;
  }

  /** Fills both teams up to `perTeam` total players (humans + bots), adding bots only. */
  fillBots(perTeam: number, difficulty: BotDifficulty = 'normal'): void {
    for (const team of ['T', 'CT'] as const) {
      while (this.teamPlayers(team).length < perTeam) this.addBot(team, difficulty);
    }
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

  private teamPlayers(team: TeamId): PlayerConn[] {
    return [...this.players.values()].filter((p) => p.team === team);
  }

  private aliveCount(team: TeamId): number {
    return this.teamPlayers(team).filter((p) => p.alive).length;
  }

  // ── buy system ────────────────────────────────────────────────────────────

  private buyingAllowed(p: PlayerConn): boolean {
    if (!p.alive) return false;
    if (this.phase === 'freeze') return this.inBuyzone(p);
    if (this.phase === 'live' && this.tick < this.liveStartTick + sec(BUY_WINDOW)) return this.inBuyzone(p);
    return false;
  }

  /** Public read surface for bot AI: whether `id` may buy right now (alive, in a buyzone, within the buy window). */
  canBuy(id: number): boolean {
    const p = this.players.get(id);
    return !!p && this.buyingAllowed(p);
  }

  private inBuyzone(p: PlayerConn): boolean {
    if (this.map.def.buyzones?.length) return this.map.buyzoneAt(p.pos.x, p.pos.y) === p.team;
    // maps without authored buy areas: near own spawn counts
    const r = BUYZONE_RADIUS_TILES * TILE_SIZE;
    return this.map.spawns[p.team].some((s) => dist(s, p.pos) <= r);
  }

  handleBuy(id: number, item: string): void {
    const p = this.players.get(id);
    if (!p || !this.buyingAllowed(p)) return;

    if (item === 'kevlar') {
      if (p.money < PRICE_KEVLAR || p.armor >= 100) return;
      p.money -= PRICE_KEVLAR;
      p.armor = 100;
      return;
    }
    if (item === 'helmet') {
      if (p.hasHelmet || p.armor <= 0 || p.money < PRICE_HELMET) return;
      p.money -= PRICE_HELMET;
      p.hasHelmet = true;
      return;
    }
    if (item === 'kit') {
      if (p.team !== 'CT' || p.hasKit || p.money < PRICE_DEFUSE_KIT) return;
      p.money -= PRICE_DEFUSE_KIT;
      p.hasKit = true;
      return;
    }

    const grenadeDef = GRENADES[item as GrenadeKind];
    if (grenadeDef) {
      if (grenadeDef.team && grenadeDef.team !== p.team) return;
      if (p.nades.length >= GRENADE_MAX_TOTAL) return;
      if (p.nades.filter((n) => n === item).length >= grenadeDef.maxCarry) return;
      if (p.money < grenadeDef.price) return;
      p.money -= grenadeDef.price;
      p.nades.push(item);
      return;
    }

    if (!(item in WEAPONS)) return; // unknown item id — ignore rather than throw
    const w = getWeapon(item.replace(/[^a-z0-9]/g, ''));
    if (w.cls === 'knife') return;
    if (w.team && w.team !== p.team) return;
    if (p.money < w.price) return;

    p.money -= w.price;
    const slot: WeaponSlot = { id: w.id, ammo: w.magazine, reserve: w.reserve };
    if (w.cls === 'pistol') {
      p.secondary = slot;
      p.activeSlot = 2;
    } else {
      if (p.primary) this.dropWeapon(p, p.primary); // replace = drop old
      p.primary = slot;
      p.activeSlot = 1;
    }
    p.reloadEndTick = 0;
  }

  // ── ground items & bomb ───────────────────────────────────────────────────

  private dropWeapon(p: PlayerConn, slot: WeaponSlot): void {
    this.groundItems.set(this.nextItemId++, {
      weaponId: slot.id,
      pos: { x: p.pos.x, y: p.pos.y },
      ammo: slot.ammo,
      reserve: slot.reserve,
    });
  }

  private tryPickup(p: PlayerConn): void {
    for (const [itemId, item] of this.groundItems) {
      if (dist(item.pos, p.pos) > PICKUP_RADIUS) continue;
      const w = getWeapon(item.weaponId);
      const slot: WeaponSlot = { id: item.weaponId, ammo: item.ammo, reserve: item.reserve };
      if (w.cls === 'pistol') {
        if (p.secondary) continue;
        p.secondary = slot;
        p.activeSlot = 2;
      } else {
        if (p.primary) continue;
        p.primary = slot;
        p.activeSlot = 1;
      }
      this.groundItems.delete(itemId);
      return;
    }
  }

  /** G: drop the currently held gun (primary or secondary) at the player's feet. */
  private dropActiveWeapon(p: PlayerConn): void {
    const slot = slotOf(p);
    if (!slot) return; // knife / grenades can't be dropped
    this.dropWeapon(p, slot);
    if (p.activeSlot === 1) p.primary = null;
    else p.secondary = null;
    p.activeSlot = p.primary ? 1 : p.secondary ? 2 : 3;
    p.reloadEndTick = 0;
  }

  /** Death drop: both carried guns fall where the victim died. */
  private dropCarriedGuns(p: PlayerConn): void {
    if (p.primary) {
      this.dropWeapon(p, p.primary);
      p.primary = null;
    }
    if (p.secondary) {
      this.dropWeapon(p, p.secondary);
      p.secondary = null;
    }
  }

  private dropBomb(p: PlayerConn): void {
    if (!p.hasBomb) return;
    p.hasBomb = false;
    this.bomb = { mode: 'dropped', pos: { x: p.pos.x, y: p.pos.y }, carrierId: 0, explodeTick: 0 };
  }

  private bombPickupCheck(): void {
    if (this.bomb.mode !== 'dropped') return;
    for (const p of this.players.values()) {
      if (p.team !== 'T' || !p.alive) continue;
      if (dist(p.pos, this.bomb.pos) <= PICKUP_RADIUS) {
        p.hasBomb = true;
        this.bomb = { mode: 'carried', pos: p.pos, carrierId: p.id, explodeTick: 0 };
        return;
      }
    }
  }

  // ── plant / defuse ───────────────────────────────────────────────────────

  private updatePlantDefuse(p: PlayerConn, input: InputMsg): void {
    const using = (input.b & BTN.USE) !== 0;
    const moving = (input.b & (BTN.UP | BTN.DOWN | BTN.LEFT | BTN.RIGHT)) !== 0;

    // pick up dropped primaries with USE
    if (using && p.alive) this.tryPickup(p);

    // planting
    if (p.team === 'T' && p.hasBomb && this.phase === 'live') {
      const onSite = this.map.siteAt(p.pos.x, p.pos.y) !== null;
      if (using && onSite && !moving && p.alive) {
        if (p.actionStartTick === 0) p.actionStartTick = this.tick;
        if (this.tick - p.actionStartTick >= sec(this.times.plant)) this.plantBomb(p);
      } else {
        p.actionStartTick = 0;
      }
      return;
    }

    // defusing
    if (p.team === 'CT' && this.phase === 'planted') {
      const nearBomb = dist(p.pos, this.bomb.pos) <= DEFUSE_RADIUS;
      if (using && nearBomb && !moving && p.alive) {
        if (p.actionStartTick === 0) p.actionStartTick = this.tick;
        const needed = sec(p.hasKit ? this.times.defuseKit : this.times.defuse);
        if (this.tick - p.actionStartTick >= needed) this.defuseBomb();
      } else {
        p.actionStartTick = 0;
      }
      return;
    }

    p.actionStartTick = 0;
  }

  private plantBomb(p: PlayerConn): void {
    p.hasBomb = false;
    p.actionStartTick = 0;
    p.money = clampMoney(p.money + PLANT_REWARD);
    this.bomb = { mode: 'planted', pos: { x: p.pos.x, y: p.pos.y }, carrierId: 0, explodeTick: this.tick + sec(this.times.bomb) };
    this.bombWasPlanted = true;
    this.phase = 'planted';
    this.phaseEndTick = this.bomb.explodeTick;
    this.emit({ e: 'planted', x: this.bomb.pos.x, y: this.bomb.pos.y });
  }

  private defuseBomb(): void {
    for (const p of this.players.values()) p.actionStartTick = 0;
    this.bomb.mode = 'none';
    this.emit({ e: 'defused' });
    this.endRound('bomb_defused');
  }

  private explodeBomb(): void {
    this.emit({ e: 'exploded', x: this.bomb.pos.x, y: this.bomb.pos.y });
    for (const p of this.players.values()) {
      if (!p.alive) continue;
      const d = dist(p.pos, this.bomb.pos);
      if (d > BOMB_EXPLOSION_RADIUS) continue;
      const raw = BOMB_EXPLOSION_DAMAGE * (1 - d / BOMB_EXPLOSION_RADIUS);
      const { hpDamage, armor } = applyArmor(raw, p.armor, penVs(p, BOMB_ARMOR_PEN));
      p.armor = armor;
      p.hp -= hpDamage;
      if (p.hp <= 0) {
        p.hp = 0;
        p.alive = false;
        p.deaths++;
        this.emit({ e: 'kill', k: 0, v: p.id, w: 'c4' });
      }
    }
    this.bomb.mode = 'none';
    this.endRound('bomb_exploded');
  }

  // ── round lifecycle ───────────────────────────────────────────────────────

  private startMatch(): void {
    this.score = { T: 0, CT: 0 };
    this.streaks = { T: 0, CT: 0 };
    this.roundNumber = 0;
    for (const p of this.players.values()) {
      p.money = START_MONEY;
      p.kills = 0;
      p.deaths = 0;
      p.armor = 0;
      p.hasHelmet = false;
      p.hasKit = false;
      p.primary = null;
    }
    this.startRound();
  }

  private startRound(): void {
    this.roundNumber++;

    if (isSideSwap(this.roundNumber)) {
      for (const p of this.players.values()) {
        p.team = p.team === 'T' ? 'CT' : 'T';
      }
      const { T, CT } = this.score;
      this.score = { T: CT, CT: T };
      const s = this.streaks;
      this.streaks = { T: s.CT, CT: s.T };
      this.emit({ e: 'swap' });
      this.broadcastRoster();
    }

    const freshEconomy = isPistolRound(this.roundNumber) || isOvertimeHalfStart(this.roundNumber);
    const otMoney = isOvertimeHalfStart(this.roundNumber);
    if (freshEconomy) this.streaks = { T: 0, CT: 0 }; // loss bonus resets at halftime / OT halves (CS2)

    this.groundItems.clear();
    this.activeNades.clear();
    this.smokes.clear();
    this.fires.clear();
    this.fireVersion++;
    this.botIntel = null;
    this.bomb = { mode: 'none', pos: { x: 0, y: 0 }, carrierId: 0, explodeTick: 0 };
    this.bombWasPlanted = false;

    const byTeam: Record<TeamId, number> = { T: 0, CT: 0 };
    for (const p of this.players.values()) {
      const survived = p.alive;
      p.alive = true;
      p.hp = MAX_HP;
      p.hasBomb = false;
      p.bloom = 0;
      p.reloadEndTick = 0;
      p.actionStartTick = 0;
      p.respawnTick = 0;
      p.blindUntilTick = 0;
      p.pos = this.spawnPos(p.team, byTeam[p.team]++);
      if (freshEconomy) {
        p.money = otMoney ? OT_MONEY : START_MONEY;
        p.armor = 0;
        p.hasHelmet = false;
        p.hasKit = false;
        p.primary = null;
        p.nades = [];
        this.givePistolLoadout(p);
      } else if (!survived) {
        p.primary = null;
        p.nades = [];
        p.armor = 0; // gear does not survive death (CS2)
        p.hasHelmet = false;
        p.hasKit = false;
        this.givePistolLoadout(p);
      } else {
        // survivors keep weapons; make sure the pistol matches the (possibly swapped) side
        if (!p.secondary) this.givePistolLoadout(p);
        p.activeSlot = p.primary ? 1 : 2;
      }
      if (p.team === 'T') p.hasKit = false;
    }

    // hand the bomb to a random T
    const ts = this.teamPlayers('T');
    if (ts.length > 0) {
      const carrier = ts[Math.floor(this.rng() * ts.length)];
      carrier.hasBomb = true;
      this.bomb = { mode: 'carried', pos: carrier.pos, carrierId: carrier.id, explodeTick: 0 };
    }

    this.phase = 'freeze';
    this.phaseEndTick = this.tick + sec(this.times.freeze);
    this.emit({ e: 'round_start', rn: this.roundNumber });
    this.broadcastRoster();
  }

  private endRound(reason: RoundEndReason): void {
    const { winner, winnerMoney, loserMoney, streaks } = roundPayout(reason, this.streaks, this.bombWasPlanted);
    this.streaks = streaks;
    this.score[winner]++;

    for (const p of this.players.values()) {
      // CS2: losers alive when time expires (saving) receive no loss bonus
      const noSaveMoney = p.team !== winner && reason === 'time' && p.alive;
      p.money = clampMoney(p.money + (p.team === winner ? winnerMoney : noSaveMoney ? 0 : loserMoney));
      p.actionStartTick = 0;
    }

    this.emit({ e: 'round_end', winner, reason });
    this.phase = 'round_end';
    this.phaseEndTick = this.tick + sec(this.times.roundEnd);
    this.broadcastRoster();
  }

  private afterRoundEnd(): void {
    const winner = matchWinner(this.score);
    if (winner) {
      this.emit({ e: 'match_end', winner });
      this.phase = 'match_end';
      this.phaseEndTick = this.tick + MATCH_END_TICKS;
      return;
    }
    this.startRound();
  }

  private resetToWarmup(): void {
    this.phase = 'waiting';
    this.roundNumber = 0;
    this.score = { T: 0, CT: 0 };
    this.bomb.mode = 'none';
    this.groundItems.clear();
    this.activeNades.clear();
    this.smokes.clear();
    this.fires.clear();
    this.fireVersion++; // bots must repath now that fires were cleared out from under them
    const byTeam: Record<TeamId, number> = { T: 0, CT: 0 };
    for (const p of this.players.values()) {
      p.alive = true;
      p.hp = MAX_HP;
      p.hasBomb = false;
      p.money = START_MONEY;
      p.armor = 0;
      p.hasHelmet = false;
      p.primary = null;
      p.nades = [];
      p.blindUntilTick = 0;
      this.givePistolLoadout(p);
      p.pos = this.spawnPos(p.team, byTeam[p.team]++);
    }
    this.broadcastRoster();
  }

  private checkWinConditions(): void {
    if (this.phase === 'live') {
      if (this.teamPlayers('T').length > 0 && this.aliveCount('T') === 0) return this.endRound('elimination_ct');
      if (this.teamPlayers('CT').length > 0 && this.aliveCount('CT') === 0) return this.endRound('elimination_t');
      if (this.tick >= this.phaseEndTick) return this.endRound('time');
    } else if (this.phase === 'planted') {
      // Ts dying does NOT end the round — the bomb must be resolved
      if (this.teamPlayers('CT').length > 0 && this.aliveCount('CT') === 0) return this.endRound('elimination_t');
      if (this.tick >= this.bomb.explodeTick) return this.explodeBomb();
    }
  }

  // ── weapons (unchanged core from phase 3) ────────────────────────────────

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
    if (slot === p.activeSlot) {
      // pressing 4 while already holding a grenade cycles the carried nades
      if (slot === 4 && p.nades.length > 1) p.nades.push(p.nades.shift()!);
      return;
    }
    if (slot === 1 && !p.primary) return;
    if (slot === 2 && !p.secondary) return;
    if (slot === 4 && p.nades.length === 0) return;
    if (slot < 1 || slot > 4) return;
    p.activeSlot = slot as 1 | 2 | 3 | 4;
    p.reloadEndTick = 0;
    p.nextShotTick = Math.max(p.nextShotTick, this.tick + Math.round(0.25 * TICK_RATE));
  }

  // ── grenades ──────────────────────────────────────────────────────────────

  private throwGrenade(p: PlayerConn, input: InputMsg): void {
    if (this.phase === 'freeze') return;
    if ((p.prevButtons & BTN.ATTACK) !== 0) return; // one throw per fresh press
    if (p.nades.length === 0) return;

    const kind = p.nades.shift()! as GrenadeKind;
    const def = getGrenade(kind);
    const vel = fromAngle(input.a, GRENADE_THROW_SPEED);
    const id = this.nextNadeId++;
    this.activeNades.set(id, { id, kind, pos: { ...p.pos }, vel, fuseTick: this.tick + sec(def.fuse), bornTick: this.tick, ownerId: p.id, ownerTeam: p.team });
    this.emit({ e: 'nade_throw', kind, x: p.pos.x, y: p.pos.y });

    if (p.nades.length === 0) p.activeSlot = p.primary ? 1 : 2;
  }

  private smokeRadius(s: SmokeZone): number {
    const bloomTicks = Math.max(1, sec(SMOKE_BLOOM_TIME));
    return SMOKE_RADIUS * Math.min(1, (this.tick - s.startTick) / bloomTicks);
  }

  /** Death by grenade/fire: credits the thrower (killfeed, kills, reward) unless it was a self-kill. */
  private killByUtility(victim: PlayerConn, ownerId: number, weaponId: string): void {
    victim.hp = 0;
    victim.alive = false;
    victim.deaths++;
    victim.actionStartTick = 0;
    const owner = this.players.get(ownerId);
    const credited = owner && owner.id !== victim.id ? owner : null;
    if (credited) {
      credited.kills++;
      credited.money = clampMoney(credited.money + getGrenade(weaponId).killReward);
    }
    this.emit({ e: 'kill', k: credited?.id ?? 0, v: victim.id, w: weaponId });
    this.dropCarriedGuns(victim);
    if (victim.hasBomb) this.dropBomb(victim);
    if (this.phase === 'waiting') victim.respawnTick = this.tick + WARMUP_RESPAWN_TICKS;
    this.broadcastRoster();
  }

  private detonateNade(n: ActiveNade): void {
    switch (n.kind) {
      case 'he': {
        const targets = [...this.players.values()]
          .filter((p) => p.alive && (FRIENDLY_FIRE || p.id === n.ownerId || p.team !== n.ownerTeam))
          .map((p) => ({ id: p.id, pos: p.pos, alive: p.alive }));
        for (const hit of resolveHeDamage(n.pos, targets, this.map)) {
          const victim = this.players.get(hit.id);
          if (!victim?.alive) continue;
          const { hpDamage, armor } = applyArmor(hit.rawDamage, victim.armor, penVs(victim, HE_ARMOR_PENETRATION));
          victim.armor = armor;
          victim.hp -= hpDamage;
          this.emit({ e: 'hurt', d: hpDamage, from: n.ownerId }, victim.id);
          if (victim.hp <= 0) this.killByUtility(victim, n.ownerId, n.kind);
        }
        this.emit({ e: 'he_pop', x: n.pos.x, y: n.pos.y });
        break;
      }
      case 'flash': {
        const smokeOccluders: Occluder[] = [...this.smokes.values()].map((s) => ({ pos: s.pos, radius: this.smokeRadius(s) }));
        const targets = [...this.players.values()]
          .filter((p) => p.alive)
          .map((p) => ({ id: p.id, pos: p.pos, aim: p.aim, alive: p.alive }));
        for (const b of resolveFlashBlind(n.pos, targets, this.map, smokeOccluders)) {
          const victim = this.players.get(b.id);
          if (!victim) continue;
          victim.blindUntilTick = Math.max(victim.blindUntilTick, this.tick + sec(b.duration));
        }
        this.emit({ e: 'flash_pop', x: n.pos.x, y: n.pos.y });
        break;
      }
      case 'smoke': {
        const id = this.nextZoneId++;
        this.smokes.set(id, { id, pos: { ...n.pos }, startTick: this.tick, untilTick: this.tick + sec(SMOKE_DURATION) });
        this.emit({ e: 'smoke_pop', x: n.pos.x, y: n.pos.y });
        break;
      }
      case 'molotov':
      case 'incendiary': {
        const id = this.nextZoneId++;
        this.fires.set(id, { id, kind: n.kind, pos: { ...n.pos }, untilTick: this.tick + sec(MOLOTOV_DURATION), ownerId: n.ownerId, ownerTeam: n.ownerTeam });
        this.fireVersion++;
        this.emit({ e: 'molotov_ignite', x: n.pos.x, y: n.pos.y });
        break;
      }
    }
  }

  private updateGrenades(): void {
    for (const [id, n] of this.activeNades) {
      const stepped = stepGrenade({ pos: n.pos, vel: n.vel }, this.map, TICK_DT);
      n.pos = stepped.pos;
      n.vel = stepped.vel;

      const age = this.tick - n.bornTick;
      const atRest = n.vel.x === 0 && n.vel.y === 0;
      let detonate: boolean;
      if (n.kind === 'smoke') {
        detonate = (atRest && age >= sec(SMOKE_MIN_AIR_SEC)) || age >= sec(SMOKE_MAX_AIR_SEC);
      } else if (n.kind === 'molotov' || n.kind === 'incendiary') {
        detonate = stepped.bounced || atRest || age >= sec(FIRE_MAX_AIR_SEC);
      } else {
        detonate = this.tick >= n.fuseTick; // he / flash: timed fuse
      }
      if (detonate) {
        this.detonateNade(n);
        this.activeNades.delete(id);
      }
    }

    const burned = new Set<number>(); // overlapping fires burn once per tick
    for (const [id, f] of this.fires) {
      if (this.tick >= f.untilTick) {
        this.fires.delete(id);
        this.fireVersion++;
        continue;
      }
      for (const p of this.players.values()) {
        if (!p.alive || burned.has(p.id) || dist(p.pos, f.pos) > MOLOTOV_RADIUS) continue;
        if (!FRIENDLY_FIRE && p.id !== f.ownerId && p.team === f.ownerTeam) continue;
        burned.add(p.id);
        const d = MOLOTOV_DPS * TICK_DT;
        p.hp -= d;
        this.emit({ e: 'hurt', d, from: f.ownerId }, p.id);
        if (p.hp <= 0) this.killByUtility(p, f.ownerId, f.kind);
      }
    }

    for (const [id, s] of this.smokes) {
      if (this.tick >= s.untilTick) this.smokes.delete(id);
    }
  }

  private tryFire(p: PlayerConn, input: InputMsg): void {
    if (this.phase === 'freeze') return;
    const w = activeWeapon(p);
    const slot = slotOf(p);
    if (this.tick < p.nextShotTick || p.reloadEndTick > 0) return;
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

    const rewound = this.lagComp.rewind(p.lastSeenTick, this.tick);
    const targets: CombatTarget[] = [];
    for (const other of this.players.values()) {
      if (other.id === p.id || !other.alive) continue;
      const pos = rewound?.get(other.id) ?? other.pos;
      targets.push({ id: other.id, pos, team: other.team, alive: other.alive });
    }

    const result = traceShot(p.pos, input.a, spread, w, p.team, targets, this.map, this.rng, FRIENDLY_FIRE);
    this.emit({ e: 'shot', id: p.id, x: p.pos.x, y: p.pos.y, tx: result.end.x, ty: result.end.y, w: w.id });

    if (result.hit) {
      const victim = this.players.get(result.hit.targetId);
      if (victim?.alive) {
        const { hpDamage, armor } = applyArmor(result.hit.rawDamage, victim.armor, penVs(victim, w.armorPen));
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
    victim.actionStartTick = 0;
    killer.kills++;
    killer.money = clampMoney(killer.money + weapon.killReward);
    this.emit({ e: 'kill', k: killer.id, v: victim.id, w: weapon.id });

    // drop both guns + bomb where they died
    this.dropCarriedGuns(victim);
    if (victim.hasBomb) this.dropBomb(victim);

    if (this.phase === 'waiting') {
      victim.respawnTick = this.tick + WARMUP_RESPAWN_TICKS;
    }
    this.broadcastRoster();
  }

  // ── main loop ────────────────────────────────────────────────────────────

  private step(): void {
    this.tick++;

    // phase transitions driven by time
    if (this.phase === 'waiting') {
      if (this.teamPlayers('T').length > 0 && this.teamPlayers('CT').length > 0) {
        this.startMatch();
      }
    } else if (this.phase === 'freeze' && this.tick >= this.phaseEndTick) {
      this.phase = 'live';
      this.liveStartTick = this.tick;
      this.phaseEndTick = this.tick + sec(this.times.round);
    } else if (this.phase === 'round_end' && this.tick >= this.phaseEndTick) {
      this.afterRoundEnd();
    } else if (this.phase === 'match_end' && this.tick >= this.phaseEndTick) {
      this.resetToWarmup();
    }

    // abandoned match guard
    if (this.phase !== 'waiting' && this.phase !== 'match_end') {
      if (this.teamPlayers('T').length === 0 || this.teamPlayers('CT').length === 0) {
        this.resetToWarmup();
      }
    }

    const canMove = this.phase !== 'freeze';

    for (const bot of this.bots.values()) bot.think(this, this.tick);

    for (const p of this.players.values()) {
      if (this.phase === 'waiting' && !p.alive && p.respawnTick > 0 && this.tick >= p.respawnTick) {
        p.alive = true;
        p.hp = MAX_HP;
        p.bloom = 0;
        p.respawnTick = 0;
        p.blindUntilTick = 0;
        p.armor = 0;
        p.reloadEndTick = 0;
        p.actionStartTick = 0;
        p.nextShotTick = 0;
        p.pos = this.spawnPos(p.team, Math.floor(this.rng() * 10));
        p.primary = null; // warmup respawn = fresh pistol loadout
        this.givePistolLoadout(p);
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
        if (!Number.isFinite(input.a)) input.a = p.aim; // reject NaN/Infinity aim (would poison grenade velocity / shot tracing)
        p.aim = input.a;
        if (p.alive) {
          if (input.w) this.switchSlot(p, input.w);
          if (input.b & BTN.RELOAD) this.startReload(p);
          if ((input.b & BTN.DROP) !== 0 && (p.prevButtons & BTN.DROP) === 0) this.dropActiveWeapon(p);
          if (canMove) {
            p.pos = stepMovement(p.pos, buttonsToMove(input.b), activeWeapon(p).mobility, this.map, TICK_DT);
          }
          if (input.b & BTN.ATTACK) {
            if (p.activeSlot === 4) this.throwGrenade(p, input);
            else this.tryFire(p, input);
          }
          this.updatePlantDefuse(p, input);
        }
        p.prevButtons = input.b;
        p.buttons = input.b;
      }

      if (p.hasBomb) this.bomb.pos = p.pos;

      const w = activeWeapon(p);
      if (w.spreadDecay > 0) p.bloom = Math.max(0, p.bloom - w.spreadDecay * TICK_DT);
    }

    this.updateGrenades();
    this.bombPickupCheck();
    this.checkWinConditions();

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
      if (p.hasBomb) flags |= PFLAG.HAS_BOMB;
      if (p.actionStartTick > 0) flags |= p.team === 'T' ? PFLAG.PLANTING : PFLAG.DEFUSING;
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

  private matchSnap(p: PlayerConn): MatchSnap {
    const m: MatchSnap = {
      ph: this.phase,
      end: Math.max(0, this.phaseEndTick - this.tick),
      rn: this.roundNumber,
      st: this.score.T,
      sct: this.score.CT,
    };
    if (this.bomb.mode === 'dropped') m.bomb = [this.bomb.pos.x, this.bomb.pos.y, 0];
    if (this.bomb.mode === 'planted') m.bomb = [this.bomb.pos.x, this.bomb.pos.y, 1];
    if (p.actionStartTick > 0) {
      const total = p.team === 'T' ? sec(this.times.plant) : sec(p.hasKit ? this.times.defuseKit : this.times.defuse);
      m.prog = Math.min(1, (this.tick - p.actionStartTick) / total);
    }
    return m;
  }

  private selfState(p: PlayerConn): SelfState {
    const slot = slotOf(p);
    const s: SelfState = {
      ammo: slot?.ammo ?? 0,
      reserve: slot?.reserve ?? 0,
      armor: p.armor,
      money: p.money,
      slot: p.activeSlot,
      weapon: activeWeapon(p).id,
      reload: p.reloadEndTick > 0 ? p.reloadEndTick - this.tick : 0,
    };
    if (p.hasBomb) s.bomb = 1;
    if (p.hasKit) s.kit = 1;
    if (p.hasHelmet) s.helm = 1;
    if (this.buyingAllowed(p)) s.buy = 1;
    if (p.nades.length > 0) s.nades = p.nades;
    if (p.blindUntilTick > this.tick) s.blind = p.blindUntilTick - this.tick;
    return s;
  }

  private broadcastSnapshot(): void {
    const players = this.snapPlayers();
    const items: GroundItem[] = [...this.groundItems.entries()].map(([id, it]) => [id, it.weaponId, Math.round(it.pos.x), Math.round(it.pos.y)]);
    const nades: NadeSnap[] = [...this.activeNades.values()].map((n) => [n.id, n.kind, Math.round(n.pos.x), Math.round(n.pos.y)]);
    const zones: ZoneSnap[] = [
      ...[...this.smokes.values()].map(
        (s): ZoneSnap => [s.id, 'smoke', Math.round(s.pos.x), Math.round(s.pos.y), Math.round(this.smokeRadius(s)), Math.max(0, s.untilTick - this.tick)],
      ),
      ...[...this.fires.values()].map(
        (f): ZoneSnap => [f.id, 'fire', Math.round(f.pos.x), Math.round(f.pos.y), MOLOTOV_RADIUS, Math.max(0, f.untilTick - this.tick)],
      ),
    ];
    const events = this.events;
    this.events = [];
    for (const p of this.players.values()) {
      if (!p.ws) continue;
      const ev = events.filter((e) => e.to === undefined || e.to === p.id).map((e) => e.ev);
      p.ws.send(
        encode({
          t: 's',
          k: this.tick,
          a: p.lastSeq,
          p: players,
          m: this.matchSnap(p),
          ...(items.length ? { g: items } : {}),
          ...(nades.length ? { n: nades } : {}),
          ...(zones.length ? { z: zones } : {}),
          me: this.selfState(p),
          ...(ev.length ? { ev } : {}),
        }),
      );
    }
  }

  broadcastRoster(): void {
    const roster: RosterEntry[] = [...this.players.values()].map((p) => ({
      id: p.id,
      name: p.name,
      team: p.team,
      k: p.kills,
      d: p.deaths,
      ...(p.ws === null ? { bot: 1 as const } : {}),
    }));
    for (const p of this.players.values()) {
      p.ws?.send(encode({ t: 'roster', players: roster }));
    }
  }
}
