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
import type { PlayerConn, Room } from '../room.js';
import { decideBotBuys } from './buy.js';
import { findPath, smoothPath } from './pathfinding.js';

export type BotDifficulty = 'easy' | 'normal' | 'hard';

const DIFFICULTY_PARAMS: Record<BotDifficulty, { reactionTicks: number; aimJitter: number }> = {
  easy: { reactionTicks: 30, aimJitter: 0.18 },
  normal: { reactionTicks: 14, aimJitter: 0.08 },
  hard: { reactionTicks: 5, aimJitter: 0.02 },
};

const WAYPOINT_RADIUS = 24;
const REPATH_COOLDOWN = TICK_RATE; // don't repath more than once/sec for the same goal
const STUCK_CHECK_INTERVAL = TICK_RATE;
const STUCK_DIST = 10;

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
  private boughtRound = -1;
  private targetId: number | null = null;
  private targetSeenTick = 0;

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

    if (room.roundNumber !== this.boughtRound && (room.phase === 'freeze' || room.phase === 'live')) {
      this.boughtRound = room.roundNumber;
      this.assignedSite = Math.random() < 0.5 ? 'A' : 'B';
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

    const enemy = this.findVisibleEnemy(room, p);
    let buttons = 0;
    let aim = p.aim;
    let switchSlot: number | undefined;

    if (enemy) {
      if (this.targetId !== enemy.id) {
        this.targetId = enemy.id;
        this.targetSeenTick = tick;
      }
      aim = Math.atan2(enemy.pos.y - p.pos.y, enemy.pos.x - p.pos.x) + (Math.random() * 2 - 1) * this.params().aimJitter;
      if (tick - this.targetSeenTick >= this.params().reactionTicks) buttons |= BTN.ATTACK;
      if (p.activeSlot === 4) switchSlot = p.primary ? 1 : 2; // don't fistfight holding a grenade
    } else {
      this.targetId = null;
      const goalPx = this.computeGoal(room, p);
      if (goalPx) {
        this.ensurePath(room.map, p.pos, goalPx, tick);
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

    const input: InputMsg = { t: 'i', s: ++this.seq, b: buttons, a: aim, k: tick };
    if (switchSlot) input.w = switchSlot;
    room.handleInput(this.playerId, input);
  }

  private computeGoal(room: Room, p: PlayerConn): Vec2 | null {
    const map = room.map;
    if (p.team === 'T') return map.siteCenters[this.assignedSite];
    if (room.phase === 'planted') return room.bombInfo.pos;
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

  private ensurePath(map: CompiledMap, pos: Vec2, goal: Vec2, tick: number): void {
    const goalChanged = !this.goal || dist(this.goal, goal) > TILE_SIZE;
    const stale = this.pathIndex >= this.path.length;
    if (goalChanged || (stale && tick - this.lastRepathTick > REPATH_COOLDOWN)) {
      this.goal = goal;
      this.path = smoothPath(map, pos, findPath(map, pos, goal));
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
