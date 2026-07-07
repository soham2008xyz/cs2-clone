import { describe, expect, it } from 'vitest';
import { raycastGrid, rayCircle } from '../src/math.js';

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
