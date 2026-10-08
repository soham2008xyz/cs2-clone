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

export type BlockedFn = (tx: number, ty: number) => boolean;

interface HeapEntry {
  key: number;
  f: number;
  seq: number;
}

/** Binary min-heap on (f, seq). Stale entries are skipped by the caller (lazy deletion). */
class OpenHeap {
  private items: HeapEntry[] = [];
  private seq = 0;

  get size(): number {
    return this.items.length;
  }

  push(key: number, f: number): void {
    const items = this.items;
    const e: HeapEntry = { key, f, seq: this.seq++ };
    let i = items.length;
    items.push(e);
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (!OpenHeap.less(e, items[parent])) break;
      items[i] = items[parent];
      i = parent;
    }
    items[i] = e;
  }

  pop(): HeapEntry | undefined {
    const items = this.items;
    const top = items[0];
    const last = items.pop();
    if (last === undefined || items.length === 0) return top;
    let i = 0;
    const n = items.length;
    for (;;) {
      let child = 2 * i + 1;
      if (child >= n) break;
      if (child + 1 < n && OpenHeap.less(items[child + 1], items[child])) child++;
      if (!OpenHeap.less(items[child], last)) break;
      items[i] = items[child];
      i = child;
    }
    items[i] = last;
    return top;
  }

  private static less(a: HeapEntry, b: HeapEntry): boolean {
    return a.f < b.f || (a.f === b.f && a.seq < b.seq);
  }
}

/** Pop the open node with the lowest f score, skipping stale heap entries. Returns -1 when empty. */
function popLowest(open: OpenHeap, nodes: Map<number, NodeRec>, closed: Set<number>): number {
  for (let e = open.pop(); e !== undefined; e = open.pop()) {
    if (!closed.has(e.key) && nodes.get(e.key)!.f === e.f) return e.key;
  }
  return -1;
}

/** Diagonal moves may not squeeze between two orthogonally adjacent blocked tiles. */
function cutsCorner(blocked: BlockedFn, cur: NodeRec, dx: number, dy: number): boolean {
  return dx !== 0 && dy !== 0 && (blocked(cur.tx + dx, cur.ty) || blocked(cur.tx, cur.ty + dy));
}

interface SearchState {
  nodes: Map<number, NodeRec>;
  open: OpenHeap;
  closed: Set<number>;
  blocked: BlockedFn;
  gtx: number;
  gty: number;
}

/** Relax every walkable neighbor of `cur`, adding improved nodes to the open set. */
function expandNeighbors(state: SearchState, cur: NodeRec, curKey: number): void {
  const { nodes, open, closed, blocked, gtx, gty } = state;
  for (const [dx, dy, cost] of NEIGHBORS) {
    const ntx = cur.tx + dx;
    const nty = cur.ty + dy;
    if (blocked(ntx, nty) || cutsCorner(blocked, cur, dx, dy)) continue;

    const nk = nodeKey(ntx, nty);
    if (closed.has(nk)) continue;
    const tentativeG = cur.g + cost;
    const existing = nodes.get(nk);
    if (!existing || tentativeG < existing.g) {
      nodes.set(nk, { tx: ntx, ty: nty, g: tentativeG, f: tentativeG + octile(ntx, nty, gtx, gty), parent: curKey });
      open.push(nk, nodes.get(nk)!.f);
    }
  }
}

/** Walk parent links back from the goal, returning tile-center waypoints (excluding the start). */
function reconstructPath(nodes: Map<number, NodeRec>, goalKey: number, startKey: number): Vec2[] {
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

/**
 * A* over the walkable tile grid (8-directional, no corner-cutting through
 * two orthogonal walls). Returns tile-center waypoints from just after the
 * start to the goal, or [] if unreachable / already on the goal tile.
 * `isBlocked` widens solidity with dynamic hazards (e.g. fire zones).
 */
export function findPath(map: CompiledMap, startPx: Vec2, goalPx: Vec2, isBlocked?: BlockedFn): Vec2[] {
  const blocked = isBlocked ?? map.isSolid;
  const stx = Math.floor(startPx.x / TILE_SIZE);
  const sty = Math.floor(startPx.y / TILE_SIZE);
  const gtx = Math.floor(goalPx.x / TILE_SIZE);
  const gty = Math.floor(goalPx.y / TILE_SIZE);
  if (blocked(gtx, gty) || (stx === gtx && sty === gty)) return [];

  const nodes = new Map<number, NodeRec>();
  const startKey = nodeKey(stx, sty);
  nodes.set(startKey, { tx: stx, ty: sty, g: 0, f: octile(stx, sty, gtx, gty), parent: null });

  const state: SearchState = { nodes, open: new OpenHeap(), closed: new Set<number>(), blocked, gtx, gty };

  state.open.push(startKey, nodes.get(startKey)!.f);

  for (let iter = 0; iter < MAX_ITERATIONS && state.open.size > 0; iter++) {
    const curKey = popLowest(state.open, nodes, state.closed);
    if (curKey === -1) break;
    const cur = nodes.get(curKey)!;
    state.closed.add(curKey);

    if (cur.tx === gtx && cur.ty === gty) return reconstructPath(nodes, curKey, startKey);
    expandNeighbors(state, cur, curKey);
  }
  return [];
}

function hasDirectLine(map: CompiledMap, a: Vec2, b: Vec2, isBlocked?: BlockedFn): boolean {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const d = Math.hypot(dx, dy);
  if (d === 0) return true;
  const dir = { x: dx / d, y: dy / d };
  return raycastGrid(a, dir, d, TILE_SIZE, isBlocked ?? map.isSolid) >= d - 1;
}

/** Shortcuts waypoints with direct LOS from the current position — cuts zigzag from grid-snapped A*. */
export function smoothPath(map: CompiledMap, fromPx: Vec2, path: Vec2[], isBlocked?: BlockedFn): Vec2[] {
  if (path.length <= 1) return path;
  const out: Vec2[] = [];
  let cursor = fromPx;
  let i = 0;
  while (i < path.length) {
    let farthest = i;
    for (let j = path.length - 1; j > i; j--) {
      if (hasDirectLine(map, cursor, path[j], isBlocked)) {
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
