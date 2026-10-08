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
  MAX_PLAYERS_PER_ROOM,
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
  canSeeBody,
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
  type ShotHit,
  type TeamId,
  type Vec2,
  type WeaponDef,
  type ZoneSnap,
} from '@cs2d/shared';
import { BotController, type BotDifficulty } from './bots/bot.js';
import { LagCompensator } from './lagcomp.js';
import { VisibilityMemory } from './visibility.js';

const SNAPSHOT_EVERY = Math.round(TICK_RATE / SNAPSHOT_RATE);
const MAX_QUEUED_INPUTS = 8;
const WARMUP_RESPAWN_TICKS = 3 * TICK_RATE;
const MATCH_END_TICKS = 15 * TICK_RATE;
const BOMB_EXPLOSION_RADIUS = 350;
const BOMB_EXPLOSION_DAMAGE = 300;
const BOMB_ARMOR_PEN = 0.6;
const DEFUSE_RADIUS = 56;
/** Sub-pixel displacement below this counts as standing still (plant/defuse). */
const MOVE_EPSILON = 0.01;

/** Thrown by addPlayer when the room already holds MAX_PLAYERS_PER_ROOM (humans + bots). */
export class RoomFullError extends Error {
  constructor() {
    super('room full');
    this.name = 'RoomFullError';
  }
}

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
  spectateId?: number; // dead: teammate whose view this client shows
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

const slotOf = (p: PlayerConn): WeaponSlot | null => {
  if (p.activeSlot === 1) return p.primary;
  if (p.activeSlot === 2) return p.secondary;
  return null;
};

/** Best slot to hold after losing the current gun: primary, else secondary, else knife. */
const fallbackSlot = (p: PlayerConn): PlayerConn['activeSlot'] => {
  if (p.primary) return 1;
  if (p.secondary) return 2;
  return 3;
};

export const activeWeapon = (p: PlayerConn): WeaponDef => {
  const slot = slotOf(p);
  return getWeapon(slot ? slot.id : 'knife');
};

/** End-of-round payout for one player. CS2: losers alive when time expires (saving) receive no loss bonus. */
function roundIncome(p: PlayerConn, winner: TeamId, reason: RoundEndReason, winnerMoney: number, loserMoney: number): number {
  if (p.team === winner) return winnerMoney;
  const saving = reason === 'time' && p.alive;
  return saving ? 0 : loserMoney;
}

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
  /** `blockedFor`: id of the player who dropped it — they can't walk-over re-grab it until they step out of reach (0 = nobody). */
  private readonly groundItems = new Map<number, { weaponId: string; pos: Vec2; ammo: number; reserve: number; blockedFor: number }>();
  private nextItemId = 1;
  private readonly activeNades = new Map<number, ActiveNade>();
  private readonly smokes = new Map<number, SmokeZone>();
  private readonly fires = new Map<number, FireZone>();
  private fireVersion = 0;
  private nextNadeId = 1;
  private nextZoneId = 1;
  private readonly bots = new Map<number, BotController>();
  private nextBotName = 1;

  private nextId = 1;
  private timer: ReturnType<typeof setInterval> | null = null;
  private readonly rng = mulberry32(0xc0ffee);
  private readonly lagComp = new LagCompensator();
  private events: Array<{ ev: GameEvent; to?: number; src?: number }> = [];
  private readonly visibility = new VisibilityMemory<PlayerSnap>();

  readonly times: RoomTimings;

  constructor(mapName: string, timings: Partial<RoomTimings> = {}) {
    this.map = getMap(mapName);
    this.times = { ...DEFAULT_TIMINGS, ...timings };
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      try {
        this.step();
      } catch (err) {
        console.error('[room] tick failed:', err); // one bad tick must not kill every room
      }
    }, 1000 / TICK_RATE);
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

  /** True when humans + bots fill the room. */
  get isFull(): boolean {
    return this.players.size >= MAX_PLAYERS_PER_ROOM;
  }

  /** Throws RoomFullError at the cap; callers on the wire check `isFull` first and close with 4003. */
  addPlayer(ws: WebSocket | null, name: string, requestedTeam?: TeamId): PlayerConn {
    if (this.isFull) throw new RoomFullError();
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
    this.visibility.forget(id);
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
      while (this.teamPlayers(team).length < perTeam && !this.isFull) this.addBot(team, difficulty);
    }
  }

  handleInput(id: number, msg: InputMsg): void {
    const p = this.players.get(id);
    if (!p) return;
    if (msg.s <= p.lastSeq) return;
    if (p.inputQueue.length >= MAX_QUEUED_INPUTS) p.inputQueue.shift();
    p.inputQueue.push(msg);
  }

  /** Queue an event. `to` limits it to one player; `src` marks it as revealing that player's position. */
  private emit(ev: GameEvent, to?: number, src?: number): void {
    this.events.push({ ev, to, src });
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

    if (item === 'kevlar' || item === 'helmet' || item === 'kit') {
      this.buyEquipment(p, item);
      return;
    }
    const grenadeDef = Object.hasOwn(GRENADES, item) ? GRENADES[item as GrenadeKind] : undefined;
    if (grenadeDef) {
      this.buyGrenade(p, item, grenadeDef);
      return;
    }
    this.buyWeapon(p, item);
  }

  private buyEquipment(p: PlayerConn, item: 'kevlar' | 'helmet' | 'kit'): void {
    if (item === 'kevlar') {
      if (p.money < PRICE_KEVLAR || p.armor >= 100) return;
      p.money -= PRICE_KEVLAR;
      p.armor = 100;
    } else if (item === 'helmet') {
      if (p.hasHelmet || p.armor <= 0 || p.money < PRICE_HELMET) return;
      p.money -= PRICE_HELMET;
      p.hasHelmet = true;
    } else {
      if (p.team !== 'CT' || p.hasKit || p.money < PRICE_DEFUSE_KIT) return;
      p.money -= PRICE_DEFUSE_KIT;
      p.hasKit = true;
    }
  }

  private buyGrenade(p: PlayerConn, item: string, grenadeDef: (typeof GRENADES)[GrenadeKind]): void {
    if (grenadeDef.team && grenadeDef.team !== p.team) return;
    if (p.nades.length >= GRENADE_MAX_TOTAL) return;
    if (p.nades.filter((n) => n === item).length >= grenadeDef.maxCarry) return;
    if (p.money < grenadeDef.price) return;
    p.money -= grenadeDef.price;
    p.nades.push(item);
  }

  private buyWeapon(p: PlayerConn, item: string): void {
    if (!Object.hasOwn(WEAPONS, item)) return; // unknown item id — ignore rather than throw
    const w = getWeapon(item.replace(/[^a-z0-9]/g, ''));
    if (w.cls === 'knife') return;
    if (w.team && w.team !== p.team) return;
    if (p.money < w.price) return;

    p.money -= w.price;
    const slot: WeaponSlot = { id: w.id, ammo: w.magazine, reserve: w.reserve };
    if (w.cls === 'pistol') {
      if (p.secondary) this.dropWeapon(p, p.secondary); // replace = drop old
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
      blockedFor: p.id,
    });
  }

  /** USE pickup (`manual`) ignores the dropper block; walk-over pickup respects it. */
  private tryPickup(p: PlayerConn, manual: boolean): void {
    for (const [itemId, item] of this.groundItems) {
      if (dist(item.pos, p.pos) > PICKUP_RADIUS) continue;
      if (!manual && item.blockedFor === p.id) continue;
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
    p.activeSlot = fallbackSlot(p);
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

  /** Walk-over pickup: every live player collects guns they stand on (if the slot is free). */
  private groundPickupCheck(): void {
    for (const item of this.groundItems.values()) {
      if (item.blockedFor === 0) continue;
      const dropper = this.players.get(item.blockedFor);
      if (!dropper || !dropper.alive || dist(dropper.pos, item.pos) > PICKUP_RADIUS) item.blockedFor = 0;
    }
    for (const p of this.players.values()) {
      if (p.alive) this.tryPickup(p, false);
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

  /**
   * `moved` is actual displacement this input, not held direction keys: a player
   * pushing into a wall or crate is pinned in place and may still plant/defuse.
   */
  private updatePlantDefuse(p: PlayerConn, input: InputMsg, moved: boolean): void {
    const using = (input.b & BTN.USE) !== 0;

    // USE also picks up guns — including one you just dropped (walk-over pickup skips those)
    if (using && p.alive) this.tryPickup(p, true);

    const action = this.bombAction(p);
    if (!action?.inZone || !using || moved || !p.alive) {
      p.actionStartTick = 0;
      return;
    }
    if (p.actionStartTick === 0) p.actionStartTick = this.tick;
    if (this.tick - p.actionStartTick >= action.ticks) action.complete();
  }

  /** The plant (T carrier, live) or defuse (CT, planted) this player could perform now, if any. */
  private bombAction(p: PlayerConn): { inZone: boolean; ticks: number; complete: () => void } | null {
    if (p.team === 'T' && p.hasBomb && this.phase === 'live') {
      return {
        inZone: this.map.siteAt(p.pos.x, p.pos.y) !== null,
        ticks: sec(this.times.plant),
        complete: () => this.plantBomb(p),
      };
    }
    if (p.team === 'CT' && this.phase === 'planted') {
      return {
        inZone: dist(p.pos, this.bomb.pos) <= DEFUSE_RADIUS,
        ticks: sec(p.hasKit ? this.times.defuseKit : this.times.defuse),
        complete: () => this.defuseBomb(),
      };
    }
    return null;
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

    if (isSideSwap(this.roundNumber)) this.swapSides();

    const freshEconomy = isPistolRound(this.roundNumber) || isOvertimeHalfStart(this.roundNumber);
    const otMoney = isOvertimeHalfStart(this.roundNumber);
    if (freshEconomy) this.streaks = { T: 0, CT: 0 }; // loss bonus resets at halftime / OT halves (CS2)

    this.clearRoundWorld();
    this.visibility.clear();

    const byTeam: Record<TeamId, number> = { T: 0, CT: 0 };
    for (const p of this.players.values()) {
      this.respawnForRound(p, byTeam[p.team]++, freshEconomy, otMoney);
    }

    this.assignBomb();

    this.phase = 'freeze';
    this.phaseEndTick = this.tick + sec(this.times.freeze);
    this.emit({ e: 'round_start', rn: this.roundNumber });
    this.broadcastRoster();
  }

  private swapSides(): void {
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

  /** Wipe per-round world state: ground items, utility, intel, bomb. */
  private clearRoundWorld(): void {
    this.groundItems.clear();
    this.activeNades.clear();
    this.smokes.clear();
    this.fires.clear();
    this.fireVersion++;
    this.botIntel = null;
    this.bomb = { mode: 'none', pos: { x: 0, y: 0 }, carrierId: 0, explodeTick: 0 };
    this.bombWasPlanted = false;
  }

  /** Reset one player for a new round: spawn, vitals, and loadout per economy / survival. */
  private respawnForRound(p: PlayerConn, spawnIndex: number, freshEconomy: boolean, otMoney: boolean): void {
    const survived = p.alive;
    p.alive = true;
    p.hp = MAX_HP;
    p.hasBomb = false;
    p.bloom = 0;
    p.reloadEndTick = 0;
    p.actionStartTick = 0;
    p.respawnTick = 0;
    p.blindUntilTick = 0;
    p.pos = this.spawnPos(p.team, spawnIndex);
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

  /** Hand the bomb to a random T. */
  private assignBomb(): void {
    const ts = this.teamPlayers('T');
    if (ts.length > 0) {
      const carrier = ts[Math.floor(this.rng() * ts.length)];
      carrier.hasBomb = true;
      this.bomb = { mode: 'carried', pos: carrier.pos, carrierId: carrier.id, explodeTick: 0 };
    }
  }

  private endRound(reason: RoundEndReason): void {
    const { winner, winnerMoney, loserMoney, streaks } = roundPayout(reason, this.streaks, this.bombWasPlanted);
    this.streaks = streaks;
    this.score[winner]++;

    for (const p of this.players.values()) {
      p.money = clampMoney(p.money + roundIncome(p, winner, reason, winnerMoney, loserMoney));
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
    this.emit({ e: 'nade_throw', kind, x: p.pos.x, y: p.pos.y }, undefined, p.id);

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
      if (this.shouldDetonate(n, stepped.bounced)) {
        this.detonateNade(n);
        this.activeNades.delete(id);
      }
    }

    this.burnFires();

    for (const [id, s] of this.smokes) {
      if (this.tick >= s.untilTick) this.smokes.delete(id);
    }
  }

  private shouldDetonate(n: ActiveNade, bounced: boolean): boolean {
    const age = this.tick - n.bornTick;
    const atRest = n.vel.x === 0 && n.vel.y === 0;
    if (n.kind === 'smoke') return (atRest && age >= sec(SMOKE_MIN_AIR_SEC)) || age >= sec(SMOKE_MAX_AIR_SEC);
    if (n.kind === 'molotov' || n.kind === 'incendiary') return bounced || atRest || age >= sec(FIRE_MAX_AIR_SEC);
    return this.tick >= n.fuseTick; // he / flash: timed fuse
  }

  /** Expire finished fires and damage everyone standing in a live one. */
  private burnFires(): void {
    const burned = new Set<number>(); // overlapping fires burn once per tick
    for (const [id, f] of this.fires) {
      if (this.tick >= f.untilTick) {
        this.fires.delete(id);
        this.fireVersion++;
        continue;
      }
      for (const p of this.players.values()) {
        if (burned.has(p.id) || !this.fireReaches(f, p)) continue;
        burned.add(p.id);
        const d = MOLOTOV_DPS * TICK_DT;
        p.hp -= d;
        this.emit({ e: 'hurt', d, from: f.ownerId }, p.id);
        if (p.hp <= 0) this.killByUtility(p, f.ownerId, f.kind);
      }
    }
  }

  /** Alive, inside the fire, and not a teammate of its thrower (unless friendly fire / own fire). */
  private fireReaches(f: FireZone, p: PlayerConn): boolean {
    if (!p.alive || dist(p.pos, f.pos) > MOLOTOV_RADIUS) return false;
    return FRIENDLY_FIRE || p.id === f.ownerId || p.team !== f.ownerTeam;
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

    const result = traceShot(
      { origin: p.pos, aim: input.a, spread, weapon: w, shooterTeam: p.team },
      this.lagCompensatedTargets(p),
      this.map,
      this.rng,
      FRIENDLY_FIRE,
    );
    this.emit({ e: 'shot', id: p.id, x: p.pos.x, y: p.pos.y, tx: result.end.x, ty: result.end.y, w: w.id }, undefined, p.id);

    if (result.hit) this.applyShotHit(p, w, result.hit);
  }

  /** Everyone but the shooter, rewound to where the shooter saw them. */
  private lagCompensatedTargets(shooter: PlayerConn): CombatTarget[] {
    const rewound = this.lagComp.rewind(shooter.lastSeenTick, this.tick);
    const targets: CombatTarget[] = [];
    for (const other of this.players.values()) {
      if (other.id === shooter.id || !other.alive) continue;
      const pos = rewound?.get(other.id) ?? other.pos;
      targets.push({ id: other.id, pos, team: other.team, alive: other.alive });
    }
    return targets;
  }

  private applyShotHit(shooter: PlayerConn, w: WeaponDef, hit: ShotHit): void {
    const victim = this.players.get(hit.targetId);
    if (!victim?.alive) return;
    const { hpDamage, armor } = applyArmor(hit.rawDamage, victim.armor, penVs(victim, w.armorPen));
    victim.armor = armor;
    victim.hp -= hpDamage;
    this.emit({ e: 'hit', id: shooter.id, target: victim.id, d: hpDamage }, shooter.id);
    this.emit({ e: 'hurt', d: hpDamage, from: shooter.id }, victim.id);
    if (victim.hp <= 0) this.onKill(shooter, victim, w);
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

    this.advancePhase();
    this.guardAbandonedMatch();

    const canMove = this.phase !== 'freeze';

    for (const bot of this.bots.values()) bot.think(this, this.tick);

    for (const p of this.players.values()) this.updatePlayer(p, canMove);

    this.updateGrenades();
    this.bombPickupCheck();
    this.groundPickupCheck();
    this.checkWinConditions();

    this.lagComp.record(this.tick, this.players.values());
    if (this.tick % SNAPSHOT_EVERY === 0) this.broadcastSnapshot();
  }

  /** Phase transitions driven by time (and, in warmup, by both teams being present). */
  private advancePhase(): void {
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
  }

  private guardAbandonedMatch(): void {
    if (this.phase === 'waiting' || this.phase === 'match_end') return;
    if (this.teamPlayers('T').length === 0 || this.teamPlayers('CT').length === 0) {
      this.resetToWarmup();
    }
  }

  private updatePlayer(p: PlayerConn, canMove: boolean): void {
    if (this.phase === 'waiting' && !p.alive && p.respawnTick > 0 && this.tick >= p.respawnTick) {
      this.warmupRespawn(p);
    }

    if (p.reloadEndTick > 0 && this.tick >= p.reloadEndTick) {
      p.reloadEndTick = 0;
      this.finishReload(p);
    }

    const queue = p.inputQueue;
    p.inputQueue = [];
    for (const input of queue) this.applyInput(p, input, canMove);

    if (p.hasBomb) this.bomb.pos = p.pos;

    const w = activeWeapon(p);
    if (w.spreadDecay > 0) p.bloom = Math.max(0, p.bloom - w.spreadDecay * TICK_DT);
  }

  private warmupRespawn(p: PlayerConn): void {
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

  private applyInput(p: PlayerConn, input: InputMsg, canMove: boolean): void {
    p.lastSeq = input.s;
    if (input.k !== undefined) p.lastSeenTick = input.k;
    p.spectateId = Number.isInteger(input.sp) ? input.sp : undefined;
    if (!Number.isFinite(input.a)) input.a = p.aim; // reject NaN/Infinity aim (would poison grenade velocity / shot tracing)
    p.aim = input.a;
    if (p.alive) this.applyAliveInput(p, input, canMove);
    p.prevButtons = input.b;
    p.buttons = input.b;
  }

  private applyAliveInput(p: PlayerConn, input: InputMsg, canMove: boolean): void {
    if (input.w) this.switchSlot(p, input.w);
    if (input.b & BTN.RELOAD) this.startReload(p);
    if ((input.b & BTN.DROP) !== 0 && (p.prevButtons & BTN.DROP) === 0) this.dropActiveWeapon(p);
    const before = p.pos;
    if (canMove) {
      p.pos = stepMovement(p.pos, buttonsToMove(input.b), activeWeapon(p).mobility, this.map, TICK_DT);
    }
    const moved = dist(before, p.pos) > MOVE_EPSILON;
    if (input.b & BTN.ATTACK) {
      if (p.activeSlot === 4) this.throwGrenade(p, input);
      else this.tryFire(p, input);
    }
    this.updatePlantDefuse(p, input, moved);
  }

  // ── snapshots ────────────────────────────────────────────────────────────

  private snapPlayers(): Map<number, PlayerSnap> {
    const snaps = new Map<number, PlayerSnap>();
    for (const p of this.players.values()) {
      let flags = 0;
      if (p.alive) flags |= PFLAG.ALIVE;
      if ((p.buttons & BTN.WALK) !== 0) flags |= PFLAG.WALKING;
      if (p.reloadEndTick > 0) flags |= PFLAG.RELOADING;
      if (p.hasBomb) flags |= PFLAG.HAS_BOMB;
      if (p.actionStartTick > 0) flags |= p.team === 'T' ? PFLAG.PLANTING : PFLAG.DEFUSING;
      snaps.set(p.id, [
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

  private matchSnap(p: PlayerConn, bombVisible: boolean): MatchSnap {
    const m: MatchSnap = {
      ph: this.phase,
      end: Math.max(0, this.phaseEndTick - this.tick),
      rn: this.roundNumber,
      st: this.score.T,
      sct: this.score.CT,
    };
    if (this.bomb.mode === 'dropped' && bombVisible) m.bomb = [this.bomb.pos.x, this.bomb.pos.y, 0];
    if (this.bomb.mode === 'planted') m.bomb = [this.bomb.pos.x, this.bomb.pos.y, 1];
    if (p.actionStartTick > 0) {
      m.prog = Math.min(1, (this.tick - p.actionStartTick) / this.actionDurationTicks(p));
    }
    return m;
  }

  /** Ticks a plant (T) or defuse (CT, faster with a kit) takes. */
  private actionDurationTicks(p: PlayerConn): number {
    if (p.team === 'T') return sec(this.times.plant);
    return sec(p.hasKit ? this.times.defuseKit : this.times.defuse);
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

  /**
   * Where a recipient's eyes are. Alive: their own position. Dead: the teammate
   * they spectate (`sp` from the client), else the first living teammate.
   * Never the whole team, or a dead client could read every teammate's view.
   */
  private vantagesFor(p: PlayerConn): Vec2[] {
    if (p.alive) return [p.pos];
    const mates = [...this.players.values()].filter((q) => q.alive && q.team === p.team);
    const target = mates.find((q) => q.id === p.spectateId) ?? mates[0];
    return [target ? target.pos : p.pos];
  }

  /** Send each client only what it could see: its team, plus enemies in sight (fog of war enforced server-side). */
  private broadcastSnapshot(): void {
    const snaps = this.snapPlayers();
    const smokes = this.smokeOccluders; // one occluder list for every check this snapshot
    const allItems = [...this.groundItems.entries()];
    const allNades = [...this.activeNades.values()];
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
      const vantages = this.vantagesFor(p);
      const enemies = [...this.players.values()]
        .filter((q) => q.team !== p.team)
        .map((q) => ({ id: q.id, pos: q.pos, snap: snaps.get(q.id)! }));
      const seen = this.visibility.visible(p.id, vantages, enemies, this.map, smokes, this.tick);

      const players: PlayerSnap[] = [];
      for (const q of this.players.values()) {
        if (q.team === p.team || q.id === p.id) {
          players.push(snaps.get(q.id)!);
          continue;
        }
        const sighting = seen.get(q.id);
        if (sighting && (sighting.snap[5] & PFLAG.ALIVE) !== 0) players.push(sighting.snap);
      }
      const items: GroundItem[] = [];
      for (const [id, it] of allItems) {
        if (canSeeBody(vantages, it.pos, this.map, smokes)) items.push([id, it.weaponId, Math.round(it.pos.x), Math.round(it.pos.y)]);
      }
      const nades: NadeSnap[] = [];
      for (const n of allNades) {
        if (n.ownerTeam === p.team || canSeeBody(vantages, n.pos, this.map, smokes)) {
          nades.push([n.id, n.kind, Math.round(n.pos.x), Math.round(n.pos.y)]);
        }
      }
      const bombVisible = this.bomb.mode !== 'dropped' || p.team === 'T' || canSeeBody(vantages, this.bomb.pos, this.map, smokes);
      const ev: GameEvent[] = [];
      for (const e of events) {
        if (e.to !== undefined && e.to !== p.id) continue;
        if (e.src !== undefined) {
          const src = this.players.get(e.src);
          if (src && src.team !== p.team && !seen.get(src.id)?.live) continue; // hidden enemy's shot or throw
        }
        ev.push(e.ev);
      }
      p.ws.send(
        encode({
          t: 's',
          k: this.tick,
          a: p.lastSeq,
          p: players,
          m: this.matchSnap(p, bombVisible),
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
