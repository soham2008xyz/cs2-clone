import { TILE_SIZE } from '../constants.js';
import { dist, fromAngle, raycastGrid, rayCircle, type Vec2 } from '../math.js';
import type { CompiledMap } from '../map/types.js';

export interface Occluder {
  pos: Vec2;
  radius: number;
}

const VISION_RAYS = 240;
export const VISION_RANGE = 900;

function rayDistance(origin: Vec2, angle: number, map: CompiledMap, smokes: readonly Occluder[], maxDist: number): number {
  const d = fromAngle(angle);
  let t = raycastGrid(origin, d, maxDist, TILE_SIZE, map.isSolid);
  for (const s of smokes) {
    const st = rayCircle(origin, d, s.pos, s.radius);
    if (st !== null && st < t) t = st;
  }
  return t;
}

/**
 * Visibility polygon by uniform ray fan. Smoke circles occlude like walls.
 * Returns a closed point list around the origin (world px).
 */
export function visibilityPolygon(
  origin: Vec2,
  map: CompiledMap,
  smokes: readonly Occluder[] = [],
  maxDist: number = VISION_RANGE,
): Vec2[] {
  const pts: Vec2[] = [];
  for (let i = 0; i < VISION_RAYS; i++) {
    const a = (i / VISION_RAYS) * Math.PI * 2;
    const t = rayDistance(origin, a, map, smokes, maxDist);
    const d = fromAngle(a);
    pts.push({ x: origin.x + d.x * t, y: origin.y + d.y * t });
  }
  return pts;
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
