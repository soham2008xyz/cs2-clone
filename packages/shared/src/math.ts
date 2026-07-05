export interface Vec2 {
  x: number;
  y: number;
}

export const vec = (x = 0, y = 0): Vec2 => ({ x, y });
export const add = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x + b.x, y: a.y + b.y });
export const sub = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x - b.x, y: a.y - b.y });
export const scale = (a: Vec2, s: number): Vec2 => ({ x: a.x * s, y: a.y * s });
export const len = (a: Vec2): number => Math.hypot(a.x, a.y);
export const dist = (a: Vec2, b: Vec2): number => Math.hypot(a.x - b.x, a.y - b.y);
export const norm = (a: Vec2): Vec2 => {
  const l = len(a);
  return l > 0 ? { x: a.x / l, y: a.y / l } : { x: 0, y: 0 };
};
export const dot = (a: Vec2, b: Vec2): number => a.x * b.x + a.y * b.y;
export const angleOf = (a: Vec2): number => Math.atan2(a.y, a.x);
export const fromAngle = (rad: number, mag = 1): Vec2 => ({ x: Math.cos(rad) * mag, y: Math.sin(rad) * mag });

export const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));
export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
export const lerpVec = (a: Vec2, b: Vec2, t: number): Vec2 => ({ x: lerp(a.x, b.x, t), y: lerp(a.y, b.y, t) });

/** Shortest-path angular interpolation (radians). */
export function lerpAngle(a: number, b: number, t: number): number {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}

/** Absolute smallest difference between two angles (radians). */
export function angleDiff(a: number, b: number): number {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return Math.abs(d);
}

/**
 * DDA raycast over a tile grid. Returns the distance to the first solid tile
 * boundary, or maxDist if nothing was hit.
 */
export function raycastGrid(
  origin: Vec2,
  dir: Vec2, // must be normalized
  maxDist: number,
  tileSize: number,
  isSolid: (tx: number, ty: number) => boolean,
): number {
  let tx = Math.floor(origin.x / tileSize);
  let ty = Math.floor(origin.y / tileSize);
  if (isSolid(tx, ty)) return 0;

  const stepX = dir.x > 0 ? 1 : -1;
  const stepY = dir.y > 0 ? 1 : -1;
  const tDeltaX = dir.x !== 0 ? Math.abs(tileSize / dir.x) : Infinity;
  const tDeltaY = dir.y !== 0 ? Math.abs(tileSize / dir.y) : Infinity;

  const nextBoundaryX = (tx + (stepX > 0 ? 1 : 0)) * tileSize;
  const nextBoundaryY = (ty + (stepY > 0 ? 1 : 0)) * tileSize;
  let tMaxX = dir.x !== 0 ? (nextBoundaryX - origin.x) / dir.x : Infinity;
  let tMaxY = dir.y !== 0 ? (nextBoundaryY - origin.y) / dir.y : Infinity;

  let t = 0;
  while (t <= maxDist) {
    if (tMaxX < tMaxY) {
      t = tMaxX;
      tMaxX += tDeltaX;
      tx += stepX;
    } else {
      t = tMaxY;
      tMaxY += tDeltaY;
      ty += stepY;
    }
    if (t > maxDist) break;
    if (isSolid(tx, ty)) return t;
  }
  return maxDist;
}

/** Distance along a ray at which it enters a circle, or null if it misses. */
export function rayCircle(origin: Vec2, dir: Vec2, center: Vec2, radius: number): number | null {
  const oc = sub(origin, center);
  const b = dot(oc, dir);
  const c = dot(oc, oc) - radius * radius;
  const disc = b * b - c;
  if (disc < 0) return null;
  const t = -b - Math.sqrt(disc);
  return t >= 0 ? t : c <= 0 ? 0 : null; // inside the circle counts as 0
}

/** Deterministic-enough PRNG (mulberry32) for spread patterns etc. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
