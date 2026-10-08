import { TILE_SIZE } from '../constants.js';
import type { Vec2 } from '../math.js';
import type { CompiledMap } from '../map/types.js';

const EPS = 0.01;

function circleOverlapsTile(cx: number, cy: number, r: number, tx: number, ty: number): boolean {
  const left = tx * TILE_SIZE;
  const top = ty * TILE_SIZE;
  const nx = Math.max(left, Math.min(cx, left + TILE_SIZE));
  const ny = Math.max(top, Math.min(cy, top + TILE_SIZE));
  const dx = cx - nx;
  const dy = cy - ny;
  return dx * dx + dy * dy < r * r;
}

function collides(map: CompiledMap, cx: number, cy: number, r: number): boolean {
  const minTx = Math.floor((cx - r) / TILE_SIZE);
  const maxTx = Math.floor((cx + r) / TILE_SIZE);
  const minTy = Math.floor((cy - r) / TILE_SIZE);
  const maxTy = Math.floor((cy + r) / TILE_SIZE);
  for (let ty = minTy; ty <= maxTy; ty++) {
    for (let tx = minTx; tx <= maxTx; tx++) {
      if (map.isSolid(tx, ty) && circleOverlapsTile(cx, cy, r, tx, ty)) return true;
    }
  }
  return false;
}

/**
 * Resolve movement along one axis: take the full step if it's free, otherwise
 * snap flush against the blocking tile boundary (or stay put in corner cases).
 */
function resolveAxis(start: number, delta: number, radius: number, blocked: (v: number) => boolean): number {
  if (delta === 0) return start;
  const next = start + delta;
  if (!blocked(next)) return next;
  const snapped =
    delta > 0
      ? Math.floor((next + radius) / TILE_SIZE) * TILE_SIZE - radius - EPS
      : (Math.floor((next - radius) / TILE_SIZE) + 1) * TILE_SIZE + radius + EPS;
  return blocked(snapped) ? start : snapped; // corner case: keep old position
}

/**
 * Move a circle through the tile grid with axis-separated resolution
 * (produces natural wall sliding). Returns the resolved position.
 */
export function moveCircle(pos: Vec2, delta: Vec2, radius: number, map: CompiledMap): Vec2 {
  const x = resolveAxis(pos.x, delta.x, radius, (v) => collides(map, v, pos.y, radius));
  const y = resolveAxis(pos.y, delta.y, radius, (v) => collides(map, x, v, radius));
  return { x, y };
}

export { collides as circleCollidesMap };
