import { raycastGrid, TILE_SIZE, type CompiledMap, type Vec2 } from '@cs2d/shared';

interface NodeRec {
  tx: number;
  ty: number;
  g: number;
  f: number;
  parent: number | null;
}

const nodeKey = (tx: number, ty: number): number => ty * 100000 + tx;

function octile(ax: number, ay: number, bx: number, by: number): number {
  const dx = Math.abs(ax - bx);
  const dy = Math.abs(ay - by);
  return Math.SQRT2 * Math.min(dx, dy) + Math.abs(dx - dy);
}

const NEIGHBORS: Array<[number, number, number]> = [
  [1, 0, 1],
  [-1, 0, 1],
  [0, 1, 1],
  [0, -1, 1],
  [1, 1, Math.SQRT2],
  [1, -1, Math.SQRT2],
  [-1, 1, Math.SQRT2],
  [-1, -1, Math.SQRT2],
];

const MAX_ITERATIONS = 20000;

/**
 * A* over the walkable tile grid (8-directional, no corner-cutting through
 * two orthogonal walls). Returns tile-center waypoints from just after the
 * start to the goal, or [] if unreachable / already on the goal tile.
 */
export function findPath(map: CompiledMap, startPx: Vec2, goalPx: Vec2): Vec2[] {
  const stx = Math.floor(startPx.x / TILE_SIZE);
  const sty = Math.floor(startPx.y / TILE_SIZE);
  const gtx = Math.floor(goalPx.x / TILE_SIZE);
  const gty = Math.floor(goalPx.y / TILE_SIZE);
  if (map.isSolid(gtx, gty) || (stx === gtx && sty === gty)) return [];

  const nodes = new Map<number, NodeRec>();
  const startKey = nodeKey(stx, sty);
  nodes.set(startKey, { tx: stx, ty: sty, g: 0, f: octile(stx, sty, gtx, gty), parent: null });

  const open = new Set<number>([startKey]);
  const closed = new Set<number>();
  let goalKey: number | null = null;

  for (let iter = 0; iter < MAX_ITERATIONS && open.size > 0; iter++) {
    let curKey = -1;
    let bestF = Infinity;
    for (const k of open) {
      const f = nodes.get(k)!.f;
      if (f < bestF) {
        bestF = f;
        curKey = k;
      }
    }
    const cur = nodes.get(curKey)!;
    open.delete(curKey);
    closed.add(curKey);

    if (cur.tx === gtx && cur.ty === gty) {
      goalKey = curKey;
      break;
    }

    for (const [dx, dy, cost] of NEIGHBORS) {
      const ntx = cur.tx + dx;
      const nty = cur.ty + dy;
      if (map.isSolid(ntx, nty)) continue;
      if (dx !== 0 && dy !== 0 && (map.isSolid(cur.tx + dx, cur.ty) || map.isSolid(cur.tx, cur.ty + dy))) continue;

      const nk = nodeKey(ntx, nty);
      if (closed.has(nk)) continue;
      const tentativeG = cur.g + cost;
      const existing = nodes.get(nk);
      if (!existing || tentativeG < existing.g) {
        nodes.set(nk, { tx: ntx, ty: nty, g: tentativeG, f: tentativeG + octile(ntx, nty, gtx, gty), parent: curKey });
        open.add(nk);
      }
    }
  }

  if (goalKey === null) return [];

  const path: Vec2[] = [];
  let k: number | null = goalKey;
  while (k !== null && k !== startKey) {
    const n: NodeRec = nodes.get(k)!;
    path.push({ x: (n.tx + 0.5) * TILE_SIZE, y: (n.ty + 0.5) * TILE_SIZE });
    k = n.parent;
  }
  path.reverse();
  return path;
}

function hasDirectLine(map: CompiledMap, a: Vec2, b: Vec2): boolean {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const d = Math.hypot(dx, dy);
  if (d === 0) return true;
  const dir = { x: dx / d, y: dy / d };
  return raycastGrid(a, dir, d, TILE_SIZE, map.isSolid) >= d - 1;
}

/** Shortcuts waypoints with direct LOS from the current position — cuts zigzag from grid-snapped A*. */
export function smoothPath(map: CompiledMap, fromPx: Vec2, path: Vec2[]): Vec2[] {
  if (path.length <= 1) return path;
  const out: Vec2[] = [];
  let cursor = fromPx;
  let i = 0;
  while (i < path.length) {
    let farthest = i;
    for (let j = path.length - 1; j > i; j--) {
      if (hasDirectLine(map, cursor, path[j])) {
        farthest = j;
        break;
      }
    }
    out.push(path[farthest]);
    cursor = path[farthest];
    i = farthest + 1;
  }
  return out;
}
