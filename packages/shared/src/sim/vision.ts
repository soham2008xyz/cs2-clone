import { PLAYER_RADIUS, TILE_SIZE } from '../constants.js';
import { dist, fromAngle, raycastGrid, rayCircle, type Vec2 } from '../math.js';
import type { CompiledMap } from '../map/types.js';

export interface Occluder {
  pos: Vec2;
  radius: number;
}

const VISION_RAYS = 240;
export const VISION_RANGE = 900;

function rayDistanceDir(origin: Vec2, d: Vec2, map: CompiledMap, smokes: readonly Occluder[], maxDist: number): number {
  let t = raycastGrid(origin, d, maxDist, TILE_SIZE, map.isSolid);
  for (const s of smokes) {
    const st = rayCircle(origin, d, s.pos, s.radius);
    if (st !== null && st < t) t = st;
  }
  return t;
}

function rayDistance(origin: Vec2, angle: number, map: CompiledMap, smokes: readonly Occluder[], maxDist: number): number {
  return rayDistanceDir(origin, fromAngle(angle), map, smokes, maxDist);
}

/**
 * Visibility polygon by uniform ray fan. Smoke circles occlude like walls.
 * Returns a closed point list around the origin (world px). Pass `out` to
 * reuse a previous result's array and points instead of allocating.
 */
export function visibilityPolygon(
  origin: Vec2,
  map: CompiledMap,
  smokes: readonly Occluder[] = [],
  maxDist: number = VISION_RANGE,
  out?: Vec2[],
): Vec2[] {
  const pts = out ?? [];
  pts.length = VISION_RAYS;
  for (let i = 0; i < VISION_RAYS; i++) {
    const a = (i / VISION_RAYS) * Math.PI * 2;
    const d = fromAngle(a);
    const t = rayDistanceDir(origin, d, map, smokes, maxDist);
    const x = origin.x + d.x * t;
    const y = origin.y + d.y * t;
    const pt = pts[i];
    if (pt) {
      pt.x = x;
      pt.y = y;
    } else {
      pts[i] = { x, y };
    }
  }
  return pts;
}

/** Vision range plus the body radius: a body whose edge is in range still counts as seen. */
export const SEE_RANGE = VISION_RANGE + PLAYER_RADIUS;

/**
 * Can any vantage see a body at `target`? The one rule for what a player may
 * know about: the server filters snapshots with it. Tests the body's center and
 * both sides (perpendicular, one radius out) against walls and smoke.
 */
export function canSeeBody(vantages: readonly Vec2[], target: Vec2, map: CompiledMap, smokes: readonly Occluder[] = []): boolean {
  for (const v of vantages) {
    const d = dist(v, target);
    if (d > SEE_RANGE) continue;
    if (d === 0 || hasLineOfSight(v, target, map, smokes, SEE_RANGE)) return true;
    const nx = (-(target.y - v.y) / d) * PLAYER_RADIUS;
    const ny = ((target.x - v.x) / d) * PLAYER_RADIUS;
    if (hasLineOfSight(v, { x: target.x + nx, y: target.y + ny }, map, smokes, SEE_RANGE)) return true;
    if (hasLineOfSight(v, { x: target.x - nx, y: target.y - ny }, map, smokes, SEE_RANGE)) return true;
  }
  return false;
}

/** Line-of-sight between two points, blocked by walls and smoke. */
export function hasLineOfSight(
  from: Vec2,
  to: Vec2,
  map: CompiledMap,
  smokes: readonly Occluder[] = [],
  maxDist: number = Infinity,
): boolean {
  const d = dist(from, to);
  if (d > maxDist) return false;
  if (d === 0) return true;
  const angle = Math.atan2(to.y - from.y, to.x - from.x);
  return rayDistance(from, angle, map, smokes, d) >= d - 0.5;
}
