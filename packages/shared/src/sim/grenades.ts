import {
  FLASH_MAX_BLIND,
  FLASH_RANGE,
  GRENADE_DRAG,
  GRENADE_FRICTION,
  GRENADE_RADIUS,
  HE_ARMOR_PEN,
  HE_MAX_DAMAGE,
  HE_RADIUS,
} from '../constants.js';
import { angleDiff, clamp, dist, lerp, type Vec2 } from '../math.js';
import type { CompiledMap } from '../map/types.js';
import { circleCollidesMap } from './collision.js';
import { hasLineOfSight, type Occluder } from './vision.js';

export interface GrenadeBody {
  pos: Vec2;
  vel: Vec2;
}

export interface GrenadeStep extends GrenadeBody {
  /** true when the grenade reflected off a wall this tick (impact detonation). */
  bounced: boolean;
}

const REST_SPEED = 4; // px/s below which we stop bouncing (fuse timer still runs)

/**
 * One physics tick for a thrown grenade: axis-separated wall bounce
 * (reflect + lose energy) plus isotropic drag, mirroring the movement
 * collision style so both share the same wall-solidity source of truth.
 */
export function stepGrenade(body: GrenadeBody, map: CompiledMap, dt: number): GrenadeStep {
  let { x, y } = body.pos;
  let { x: vx, y: vy } = body.vel;
  let bounced = false;

  if (Math.hypot(vx, vy) > REST_SPEED) {
    const nx = x + vx * dt;
    if (circleCollidesMap(map, nx, y, GRENADE_RADIUS)) {
      vx = -vx * GRENADE_FRICTION;
      bounced = true;
    } else {
      x = nx;
    }
    const ny = y + vy * dt;
    if (circleCollidesMap(map, x, ny, GRENADE_RADIUS)) {
      vy = -vy * GRENADE_FRICTION;
      bounced = true;
    } else {
      y = ny;
    }
    const drag = Math.exp(-GRENADE_DRAG * dt);
    vx *= drag;
    vy *= drag;
    if (Math.hypot(vx, vy) < REST_SPEED) {
      vx = 0;
      vy = 0;
    }
  }

  return { pos: { x, y }, vel: { x: vx, y: vy }, bounced };
}

export interface DamageResult {
  id: number;
  rawDamage: number;
}

/** HE grenade: radial damage with falloff, blocked by walls/smoke (LOS). */
export function resolveHeDamage(
  center: Vec2,
  targets: Iterable<{ id: number; pos: Vec2; alive: boolean }>,
  map: CompiledMap,
  smokes: readonly Occluder[] = [],
): DamageResult[] {
  const out: DamageResult[] = [];
  for (const t of targets) {
    if (!t.alive) continue;
    const d = dist(center, t.pos);
    if (d > HE_RADIUS) continue;
    if (!hasLineOfSight(center, t.pos, map, smokes, HE_RADIUS)) continue;
    out.push({ id: t.id, rawDamage: HE_MAX_DAMAGE * (1 - d / HE_RADIUS) });
  }
  return out;
}

export const HE_ARMOR_PENETRATION = HE_ARMOR_PEN;

export interface BlindResult {
  id: number;
  duration: number; // seconds of blindness
}

/**
 * Flashbang: blinds anyone with LOS to the pop point, scaled by distance and
 * by how directly they were looking toward it (facing away still blinds a
 * little via peripheral vision, matching CS behavior).
 */
export function resolveFlashBlind(
  popPos: Vec2,
  targets: Iterable<{ id: number; pos: Vec2; aim: number; alive: boolean }>,
  map: CompiledMap,
  smokes: readonly Occluder[] = [],
): BlindResult[] {
  const out: BlindResult[] = [];
  for (const t of targets) {
    if (!t.alive) continue;
    const d = dist(popPos, t.pos);
    if (d > FLASH_RANGE) continue;
    if (!hasLineOfSight(popPos, t.pos, map, smokes, FLASH_RANGE)) continue;

    const distFactor = 1 - d / FLASH_RANGE;
    const dirToFlash = Math.atan2(popPos.y - t.pos.y, popPos.x - t.pos.x);
    const diff = angleDiff(t.aim, dirToFlash); // 0 = looking straight at it, PI = looking away
    const angleFactor = lerp(1, 0.15, diff / Math.PI);

    const duration = FLASH_MAX_BLIND * distFactor * angleFactor;
    if (duration > 0.05) out.push({ id: t.id, duration: clamp(duration, 0, FLASH_MAX_BLIND) });
  }
  return out;
}
