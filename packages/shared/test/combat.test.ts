import { describe, expect, it } from 'vitest';
import { applyArmor, falloff, traceShot } from '../src/sim/combat.js';
import { getWeapon } from '../src/sim/weapons.data.js';
import { hasLineOfSight, visibilityPolygon } from '../src/sim/vision.js';
import { compileMap } from '../src/map/compile.js';
import { MapBuilder } from '../src/map/builder.js';
import { TILE_SIZE } from '../src/constants.js';
import { mulberry32 } from '../src/math.js';

// 30×10 corridor with a wall segment in the middle (gap at the top)
function corridor() {
  const b = new MapBuilder(30, 10);
  b.carve(1, 1, 28, 8);
  b.wall(15, 4, 1, 5); // wall from y=4 down; y=1..3 stays open
  b.spawn('T', 2, 2);
  b.spawn('CT', 27, 2);
  return compileMap(b.build('corridor', 'Corridor'));
}

const at = (tx: number, ty: number) => ({ x: (tx + 0.5) * TILE_SIZE, y: (ty + 0.5) * TILE_SIZE });

describe('damage math', () => {
  it('falloff decreases with distance', () => {
    const ak = getWeapon('ak47');
    expect(falloff(ak, 0)).toBe(1);
    expect(falloff(ak, 512)).toBeCloseTo(0.98, 5);
    expect(falloff(ak, 2048)).toBeLessThan(falloff(ak, 512));
  });

  it('armor absorbs damage and degrades', () => {
    // 100 damage, 0.775 pen: hp takes 78, armor loses (100-77.5)/2 ≈ 11
    const r = applyArmor(100, 100, 0.775);
    expect(r.hpDamage).toBe(78);
    expect(r.armor).toBe(89);
  });

  it('no armor takes full damage', () => {
    expect(applyArmor(36, 0, 0.775)).toEqual({ hpDamage: 36, armor: 0 });
  });
});

describe('traceShot', () => {
  const map = corridor();
  const ak = getWeapon('ak47');

  it('hits an enemy in the open', () => {
    const shooter = at(2, 2);
    const target = { id: 9, pos: at(10, 2), team: 'CT' as const, alive: true };
    const r = traceShot(shooter, 0, 0, ak, 'T', [target], map, mulberry32(1));
    expect(r.hit?.targetId).toBe(9);
    expect(r.hit!.rawDamage).toBeLessThanOrEqual(ak.damage);
    expect(r.hit!.rawDamage).toBeGreaterThan(ak.damage * 0.9);
  });

  it('wall blocks the shot', () => {
    const shooter = at(2, 6);
    const target = { id: 9, pos: at(27, 6), team: 'CT' as const, alive: true };
    const r = traceShot(shooter, 0, 0, ak, 'T', [target], map, mulberry32(1));
    expect(r.hit).toBeNull();
    // tracer stops at the wall (x=15*32=480)
    expect(r.end.x).toBeLessThanOrEqual(15 * TILE_SIZE + 1);
  });

  it('hits the nearest of two targets', () => {
    const shooter = at(2, 2);
    const near = { id: 1, pos: at(8, 2), team: 'CT' as const, alive: true };
    const far = { id: 2, pos: at(12, 2), team: 'CT' as const, alive: true };
    const r = traceShot(shooter, 0, 0, ak, 'T', [far, near], map, mulberry32(1));
    expect(r.hit?.targetId).toBe(1);
  });

  it('ignores teammates without friendly fire', () => {
    const shooter = at(2, 2);
    const mate = { id: 1, pos: at(8, 2), team: 'T' as const, alive: true };
    const r = traceShot(shooter, 0, 0, ak, 'T', [mate], map, mulberry32(1));
    expect(r.hit).toBeNull();
  });

  it('knife cannot reach across the room', () => {
    const knife = getWeapon('knife');
    const shooter = at(2, 2);
    const target = { id: 9, pos: at(10, 2), team: 'CT' as const, alive: true };
    const r = traceShot(shooter, 0, 0, knife, 'T', [target], map, mulberry32(1));
    expect(r.hit).toBeNull();
  });
});

describe('vision', () => {
  const map = corridor();

  it('LOS through open space, blocked by wall', () => {
    expect(hasLineOfSight(at(2, 2), at(10, 2), map)).toBe(true);
    expect(hasLineOfSight(at(2, 6), at(27, 6), map)).toBe(false);
    // through the gap above the wall
    expect(hasLineOfSight(at(2, 2), at(27, 2), map)).toBe(true);
  });

  it('smoke blocks LOS', () => {
    const smoke = { pos: at(8, 2), radius: 60 };
    expect(hasLineOfSight(at(2, 2), at(14, 2), map, [smoke])).toBe(false);
    // but not lines that miss the smoke
    expect(hasLineOfSight(at(2, 7), at(10, 7), map, [smoke])).toBe(true);
  });

  it('visibility polygon stays within walls', () => {
    const poly = visibilityPolygon(at(2, 6), map);
    expect(poly.length).toBeGreaterThan(100);
    for (const p of poly) {
      // no vertex may sit deep inside a solid tile (small epsilon for boundary points)
      expect(p.x).toBeGreaterThanOrEqual(TILE_SIZE - 1);
      expect(p.x).toBeLessThanOrEqual(29 * TILE_SIZE + 1);
    }
  });
});
