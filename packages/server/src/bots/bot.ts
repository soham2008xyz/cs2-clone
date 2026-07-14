import {
  BTN,
  dist,
  hasLineOfSight,
  sub,
  TICK_RATE,
  TILE_SIZE,
  VISION_RANGE,
  type CompiledMap,
  type InputMsg,
  type Vec2,
} from '@cs2d/shared';
import { activeWeapon, type PlayerConn, type Room } from '../room.js';
import { decideBotBuys } from './buy.js';
import { findPath, smoothPath, type BlockedFn } from './pathfinding.js';

export type BotDifficulty = 'easy' | 'normal' | 'hard';

interface DifficultyParams {
  reactionTicks: number;
  aimJitter: number;
  /** spray control: ticks of full-auto fire before easing off the trigger */
  burstTicks: number;
  /** ticks of trigger release between bursts (lets recoil bloom decay) */
  pauseTicks: number;
}

const DIFFICULTY_PARAMS: Record<BotDifficulty, DifficultyParams> = {
  easy: { reactionTicks: 30, aimJitter: 0.18, burstTicks: 9999, pauseTicks: 0 }, // holds the trigger, sprays wild
  normal: { reactionTicks: 14, aimJitter: 0.08, burstTicks: 14, pauseTicks: 10 },
  hard: { reactionTicks: 5, aimJitter: 0.02, burstTicks: 8, pauseTicks: 6 },
};

/** Semi-autos need a fresh trigger press per shot: 2 ticks down, 2 up. */
const TAP_CYCLE = 4;

const WAYPOINT_RADIUS = 24;
const REPATH_COOLDOWN = TICK_RATE; // don't repath more than once/sec for the same goal
const STUCK_CHECK_INTERVAL = TICK_RATE;
const STUCK_DIST = 10;
const SAVE_HP = 35; // below this (and with no fight on), back off toward spawn
const INTEL_TTL_TICKS = 15 * TICK_RATE; // how long a bomb-carrier sighting drives CT rotation
const THROW_BAND_MIN = 200; // utility throws land ~330px out; only throw from a sane range
const THROW_BAND_MAX = 450;
const THROW_COOLDOWN_TICKS = 3 * TICK_RATE;
const MAX_THROWS_PER_ROUND = 2;

const nearestSite = (map: CompiledMap, pos: Vec2): 'A' | 'B' => {
  const { A, B } = map.siteCenters;
  if (!B) return 'A';
  if (!A) return 'B';
  return dist(pos, A) <= dist(pos, B) ? 'A' : 'B';
};

/** Solidity widened by active fire patches (goal tile stays reachable). */
function fireBlocked(map: CompiledMap, zones: Array<{ pos: Vec2; radius: number }>, goal: Vec2): BlockedFn | undefined {
  if (zones.length === 0) return undefined;
  const gtx = Math.floor(goal.x / TILE_SIZE);
  const gty = Math.floor(goal.y / TILE_SIZE);
  return (tx, ty) => {
    if (map.isSolid(tx, ty)) return true;
    if (tx === gtx && ty === gty) return false;
    const cx = (tx + 0.5) * TILE_SIZE;
    const cy = (ty + 0.5) * TILE_SIZE;
    return zones.some((z) => Math.hypot(cx - z.pos.x, cy - z.pos.y) < z.radius + TILE_SIZE / 2);
  };
}

/**
 * Server-side bot AI. Drives its player through the exact same input path a
 * networked client uses (room.handleInput), so movement/combat/plant/defuse
 * all run through one code path regardless of who's behind the player.
 */
export class BotController {
  readonly playerId: number;
  private difficulty: BotDifficulty;
  private seq = 0;
  private path: Vec2[] = [];
  private pathIndex = 0;
  private goal: Vec2 | null = null;
  private lastRepathTick = -Infinity;
  private lastPos: Vec2 = { x: 0, y: 0 };
  private lastStuckCheckTick = 0;
  private assignedSite: 'A' | 'B' = 'A';
  private setupRound = -1;
  private boughtRound = -1;
  private targetId: number | null = null;
  private targetSeenTick = 0;
  private throwsThisRound = 0;
  private lastThrowTick = -Infinity;
  private fireVersionSeen = -1;

  constructor(playerId: number, difficulty: BotDifficulty = 'normal') {
    this.playerId = playerId;
    this.difficulty = difficulty;
  }

  private params() {
    return DIFFICULTY_PARAMS[this.difficulty];
  }

  /** Called once per server tick; synthesizes and submits this bot's input for the tick. */
  think(room: Room, tick: number): void {
    const p = room.players.get(this.playerId);
    if (!p) return;

    if (room.roundNumber !== this.setupRound && (room.phase === 'freeze' || room.phase === 'live')) {
      this.setupRound = room.roundNumber;
      const { A, B } = room.map.siteCenters;
      this.assignedSite = A && B ? (Math.random() < 0.5 ? 'A' : 'B') : A ? 'A' : 'B'; // single-site maps only have one to pick
      this.throwsThisRound = 0;
      this.lastThrowTick = -Infinity;
    }
    // separate from setup: a backfill bot can join after its buy window has already
    // closed, so don't latch boughtRound until a buy attempt was actually possible —
    // otherwise it plays the whole round pistol-only and never retries.
    if (room.roundNumber !== this.boughtRound && room.canBuy(this.playerId)) {
      this.boughtRound = room.roundNumber;
      for (const item of decideBotBuys(p.money, p.team, p.hasKit)) room.handleBuy(this.playerId, item);
    }

    if (!p.alive || room.phase === 'freeze' || room.phase === 'waiting' || room.phase === 'round_end' || room.phase === 'match_end') {
      return;
    }

    if (tick - this.lastStuckCheckTick > STUCK_CHECK_INTERVAL) {
      if (this.path.length > 0 && dist(this.lastPos, p.pos) < STUCK_DIST) {
        this.path = [];
        this.pathIndex = 0;
      }
      this.lastPos = { ...p.pos };
      this.lastStuckCheckTick = tick;
    }

    // flashed: no target acquisition, no shooting — keep stumbling along the path
    const blind = p.blindUntilTick > tick;
    if (blind) this.targetId = null;
    const enemy = blind ? null : this.findVisibleEnemy(room, p);
    let buttons = 0;
    let aim = p.aim;
    let switchSlot: number | undefined;

    if (enemy) {
      if (this.targetId !== enemy.id) {
        this.targetId = enemy.id;
        this.targetSeenTick = tick;
      }
      if (p.team === 'CT' && enemy.hasBomb) {
        room.botIntel = { site: nearestSite(room.map, enemy.pos), tick }; // share the sighting
      }
      aim = Math.atan2(enemy.pos.y - p.pos.y, enemy.pos.x - p.pos.x) + (Math.random() * 2 - 1) * this.params().aimJitter;
      const engagingTicks = tick - this.targetSeenTick - this.params().reactionTicks;
      if (engagingTicks >= 0 && this.wantsToFire(activeWeapon(p).auto, engagingTicks)) buttons |= BTN.ATTACK;
      if (p.activeSlot === 4) switchSlot = p.primary ? 1 : 2; // don't fistfight holding a grenade
    } else {
      this.targetId = null;
      const toss = blind ? null : this.utilityThrow(room, p, tick);
      if (toss !== null) {
        aim = toss;
        buttons |= BTN.ATTACK;
        switchSlot = 4; // slot switch and throw resolve in the same input
      } else {
        if (p.activeSlot === 4) switchSlot = p.primary ? 1 : 2; // back to a gun after throwing
        const goalPx = this.computeGoal(room, p, tick);
        if (goalPx) {
          this.ensurePath(room, p.pos, goalPx, tick);
          const next = this.currentWaypoint(p.pos);
          if (next) {
            const d = sub(next, p.pos);
            aim = Math.atan2(d.y, d.x);
            if (Math.abs(d.x) > 6) buttons |= d.x > 0 ? BTN.RIGHT : BTN.LEFT;
            if (Math.abs(d.y) > 6) buttons |= d.y > 0 ? BTN.DOWN : BTN.UP;
          } else if ((p.hasBomb && room.map.siteAt(p.pos.x, p.pos.y) !== null && room.phase === 'live') || (p.team === 'CT' && room.phase === 'planted')) {
            buttons |= BTN.USE;
          }
        }
      }
    }

    const input: InputMsg = { t: 'i', s: ++this.seq, b: buttons, a: aim, k: tick };
    if (switchSlot) input.w = switchSlot;
    room.handleInput(this.playerId, input);
  }

  /**
   * Spray control: automatics burst-fire (params-tuned on/off cycle so bloom
   * can decay between bursts); semi-autos need a fresh trigger press per shot
   * since a held ATTACK only fires once (tryFire's fresh-press check).
   */
  private wantsToFire(auto: boolean, engagingTicks: number): boolean {
    if (!auto) return engagingTicks % TAP_CYCLE < TAP_CYCLE / 2;
    const { burstTicks, pauseTicks } = this.params();
    return engagingTicks % (burstTicks + pauseTicks) < burstTicks;
  }

  /**
   * Throw the next carried smoke/flash at a matching map anchor for the site
   * we're executing toward. Returns the throw aim angle, or null to pass.
   */
  private utilityThrow(room: Room, p: PlayerConn, tick: number): number | null {
    if (room.phase !== 'live' || this.throwsThisRound >= MAX_THROWS_PER_ROUND) return null;
    if (tick - this.lastThrowTick < THROW_COOLDOWN_TICKS) return null;
    if ((p.prevButtons & BTN.ATTACK) !== 0) return null; // room requires a fresh press too
    const kind = p.nades[0]; // room always throws the front grenade
    if (kind !== 'smoke' && kind !== 'flash') return null;
    for (const spot of room.map.utilitySpots) {
      if (spot.kind !== kind || spot.site !== this.assignedSite) continue;
      const d = dist(p.pos, spot.pos);
      if (d < THROW_BAND_MIN || d > THROW_BAND_MAX) continue;
      if (!hasLineOfSight(p.pos, spot.pos, room.map, [], THROW_BAND_MAX + 100)) continue;
      this.throwsThisRound++;
      this.lastThrowTick = tick;
      return Math.atan2(spot.pos.y - p.pos.y, spot.pos.x - p.pos.x);
    }
    return null;
  }

  private computeGoal(room: Room, p: PlayerConn, tick: number): Vec2 | null {
    const map = room.map;
    if (room.phase === 'planted') {
      // post-plant: CTs converge on the bomb, Ts hold their site
      return p.team === 'CT' ? room.bombInfo.pos : map.siteCenters[this.assignedSite];
    }
    if (p.hp < SAVE_HP && !p.hasBomb) return map.spawns[p.team][0]; // save the gun
    if (p.team === 'T' && !p.hasBomb && room.bombInfo.mode === 'dropped') return room.bombInfo.pos; // retrieve it — don't strand the objective
    if (p.team === 'CT' && room.botIntel && tick - room.botIntel.tick < INTEL_TTL_TICKS) {
      return map.siteCenters[room.botIntel.site]; // rotate on a teammate's sighting
    }
    return map.siteCenters[this.assignedSite];
  }

  private findVisibleEnemy(room: Room, p: PlayerConn): PlayerConn | null {
    let best: PlayerConn | null = null;
    let bestDist = Infinity;
    for (const other of room.players.values()) {
      if (other.team === p.team || !other.alive) continue;
      const d = dist(p.pos, other.pos);
      if (d > VISION_RANGE || d >= bestDist) continue;
      if (!hasLineOfSight(p.pos, other.pos, room.map, room.smokeOccluders, VISION_RANGE)) continue;
      bestDist = d;
      best = other;
    }
    return best;
  }

  private ensurePath(room: Room, pos: Vec2, goal: Vec2, tick: number): void {
    const map = room.map;
    const fire = room.fireInfo;
    const goalChanged = !this.goal || dist(this.goal, goal) > TILE_SIZE;
    const stale = this.pathIndex >= this.path.length;
    const fireChanged = fire.version !== this.fireVersionSeen;
    if (goalChanged || fireChanged || (stale && tick - this.lastRepathTick > REPATH_COOLDOWN)) {
      this.goal = goal;
      this.fireVersionSeen = fire.version;
      const blocked = fireBlocked(map, fire.zones, goal);
      this.path = smoothPath(map, pos, findPath(map, pos, goal, blocked), blocked);
      this.pathIndex = 0;
      this.lastRepathTick = tick;
    }
  }

  private currentWaypoint(pos: Vec2): Vec2 | null {
    while (this.pathIndex < this.path.length && dist(this.path[this.pathIndex], pos) < WAYPOINT_RADIUS) {
      this.pathIndex++;
    }
    return this.pathIndex < this.path.length ? this.path[this.pathIndex] : null;
  }
}
