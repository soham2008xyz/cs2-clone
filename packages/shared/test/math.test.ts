import { describe, expect, it } from 'vitest';
import { lerpAngle, norm, raycastGrid, rayCircle } from '../src/math.js';

describe('raycastGrid', () => {
  it('returns 0 when the ray starts inside a solid tile', () => {
    const isSolid = (tx: number, ty: number) => tx === 0 && ty === 0;
    expect(raycastGrid({ x: 10, y: 10 }, { x: 1, y: 0 }, 500, 32, isSolid)).toBe(0);
  });

  it('finds the distance to a solid tile straight ahead on the x axis', () => {
    const isSolid = (tx: number, ty: number) => tx === 5 && ty === 0;
    // tile 5 starts at x=160; origin at x=16 -> 144px to the boundary
    expect(raycastGrid({ x: 16, y: 16 }, { x: 1, y: 0 }, 1000, 32, isSolid)).toBe(144);
  });

  it('an axis-parallel ray terminates cleanly at maxDist when nothing is hit', () => {
    const t = raycastGrid({ x: 16, y: 16 }, { x: 0, y: 1 }, 500, 32, () => false);
    expect(t).toBe(500);
    expect(Number.isFinite(t)).toBe(true);
  });
});

describe('rayCircle', () => {
  it('returns null when the ray points away from the circle', () => {
    const t = rayCircle({ x: 0, y: 0 }, { x: -1, y: 0 }, { x: 100, y: 0 }, 10);
    expect(t).toBeNull();
  });

  it('returns the entry distance when the ray hits the circle', () => {
    const t = rayCircle({ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 100, y: 0 }, 10);
    expect(t).toBeCloseTo(90, 5); // circle boundary at 100 - radius 10
  });

  it('returns 0 when the origin is already inside the circle', () => {
    const t = rayCircle({ x: 100, y: 0 }, { x: 1, y: 0 }, { x: 100, y: 0 }, 10);
    expect(t).toBe(0);
  });
});

describe('lerpAngle', () => {
  it('wraps the long way forward into the short way backward (d > pi branch)', () => {
    // 0 -> 270deg the "long way" is +270deg; the shortest path is -90deg
    expect(lerpAngle(0, Math.PI * 1.5, 1)).toBeCloseTo(-Math.PI / 2, 5);
    expect(lerpAngle(0, Math.PI * 1.5, 0.5)).toBeCloseTo(-Math.PI / 4, 5);
  });

  it('wraps the long way backward into the short way forward (d < -pi branch)', () => {
    // 270deg -> 0 the "long way" is -270deg; the shortest path is +90deg (past 2*pi)
    expect(lerpAngle(Math.PI * 1.5, 0, 1)).toBeCloseTo(Math.PI * 2, 5);
  });
});

describe('norm', () => {
  it('returns the zero vector for a zero-length input instead of NaN', () => {
    expect(norm({ x: 0, y: 0 })).toEqual({ x: 0, y: 0 });
  });

  it('normalizes a non-zero vector to unit length', () => {
    const n = norm({ x: 3, y: 4 });
    expect(n.x).toBeCloseTo(0.6, 5);
    expect(n.y).toBeCloseTo(0.8, 5);
  });
});
