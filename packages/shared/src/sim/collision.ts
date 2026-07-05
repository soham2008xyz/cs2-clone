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
 * Move a circle through the tile grid with axis-separated resolution
 * (produces natural wall sliding). Returns the resolved position.
 */
export function moveCircle(pos: Vec2, delta: Vec2, radius: number, map: CompiledMap): Vec2 {
  let x = pos.x;
  let y = pos.y;

  // X axis: snap to the tile boundary on collision
  if (delta.x !== 0) {
    const nx = x + delta.x;
    if (!collides(map, nx, y, radius)) {
      x = nx;
    } else {
      const tile = delta.x > 0 ? Math.floor((nx + radius) / TILE_SIZE) : Math.floor((nx - radius) / TILE_SIZE);
      x = delta.x > 0 ? tile * TILE_SIZE - radius - EPS : (tile + 1) * TILE_SIZE + radius + EPS;
      if (collides(map, x, y, radius)) x = pos.x; // corner case: keep old x
    }
  }

  // Y axis
  if (delta.y !== 0) {
    const ny = y + delta.y;
    if (!collides(map, x, ny, radius)) {
      y = ny;
    } else {
      const tile = delta.y > 0 ? Math.floor((ny + radius) / TILE_SIZE) : Math.floor((ny - radius) / TILE_SIZE);
      y = delta.y > 0 ? tile * TILE_SIZE - radius - EPS : (tile + 1) * TILE_SIZE + radius + EPS;
      if (collides(map, x, y, radius)) y = pos.y;
    }
  }

  return { x, y };
}

export { collides as circleCollidesMap };
