import { describe, expect, it } from 'vitest';
import { lerpAngle, mulberry32, norm, raycastGrid, rayCircle } from '../src/math.js';

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

describe('mulberry32', () => {
  // Golden values: the sequence must stay bit-identical so client and server
  // agree on spread patterns. Covers int32 / uint32 boundaries and non-integers.
  const GOLDEN: Record<string, number[]> = {
    '0': [0.26642920868471265, 0.0003297457005828619, 0.2232720274478197, 0.1462021479383111, 0.46732782293111086],
    '1': [0.6270739405881613, 0.002735721180215478, 0.5274470399599522, 0.9810509674716741, 0.9683778982143849],
    '42': [0.6011037519201636, 0.44829055899754167, 0.8524657934904099, 0.6697340414393693, 0.17481389874592423],
    '2147483647': [0.4290980885270983, 0.12713524978607893, 0.3852774982806295, 0.39639189024455845, 0.11962746665813029],
    '2147483648': [0.8205775609239936, 0.4481089550536126, 0.7836112855002284, 0.5120457962621003, 0.8388098266441375],
    '4294967295': [0.8964226141106337, 0.189478256739676, 0.7156526781618595, 0.9440599093213677, 0.8452364315744489],
    '-1': [0.8964226141106337, 0.189478256739676, 0.7156526781618595, 0.9440599093213677, 0.8452364315744489],
    '-123456789': [0.9335711891762912, 0.2907314267940819, 0.865351774264127, 0.04375693411566317, 0.5729067635256797],
    '1099511627783': [0.011704753153026104, 0.06195825757458806, 0.97690763277933, 0.6990287057124078, 0.5214452685322613],
    '1.5': [0.6270739405881613, 0.002735721180215478, 0.5274470399599522, 0.9810509674716741, 0.9683778982143849],
  };

  it.each(Object.entries(GOLDEN))('seed %s produces the golden sequence', (seed, expected) => {
    const rng = mulberry32(Number(seed));
    expect(Array.from({ length: expected.length }, () => rng())).toEqual(expected);
  });

  it('long-run checksum is stable', () => {
    let h = 0;
    for (let s = 0; s < 200; s++) {
      const rng = mulberry32(s * 2654435761);
      for (let i = 0; i < 50; i++) h = (h * 31 + Math.floor(rng() * 1e9)) % 1e15;
    }
    expect(h).toBe(377190222050848);
  });
});
