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

  it('near-depleted armor only mitigates the portion it can cover, not the whole shot', () => {
    // 1 armor can't fully absorb a 36-damage rifle hit (0.775 pen) — the fix carries
    // the depletion over: armor covers a sliver, the rest hits hp unmitigated. Before
    // the fix this returned hpDamage: 28 (full mitigation) — as if armor were plentiful.
    const r = applyArmor(36, 1, 0.775);
    expect(r.armor).toBe(0);
    expect(r.hpDamage).toBeGreaterThan(28);
    expect(r.hpDamage).toBeLessThanOrEqual(36);
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

  it('hits teammates when friendly fire is enabled', () => {
    const shooter = at(2, 2);
    const mate = { id: 1, pos: at(8, 2), team: 'T' as const, alive: true };
    const r = traceShot(shooter, 0, 0, ak, 'T', [mate], map, mulberry32(1), true);
    expect(r.hit?.targetId).toBe(1);
  });

  it('a target overlapping the shooter is not hit (dist<=0 guard)', () => {
    const shooter = at(2, 2);
    const onTopOfShooter = { id: 1, pos: { ...shooter }, team: 'CT' as const, alive: true };
    const r = traceShot(shooter, 0, 0, ak, 'T', [onTopOfShooter], map, mulberry32(1));
    expect(r.hit).toBeNull();
  });

  it('a target directly behind the shooter is not hit', () => {
    const shooter = at(10, 2);
    const behind = { id: 1, pos: at(2, 2), team: 'CT' as const, alive: true }; // aim faces +x, target is to the west
    const r = traceShot(shooter, 0, 0, ak, 'T', [behind], map, mulberry32(1));
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
    const origin = at(2, 6);
    const poly = visibilityPolygon(origin, map);
    expect(poly.length).toBeGreaterThan(100);
    for (const p of poly) {
      // whole polygon stays within the compiled map bounds on both axes
      expect(p.x).toBeGreaterThanOrEqual(-1);
      expect(p.x).toBeLessThanOrEqual(30 * TILE_SIZE + 1);
      expect(p.y).toBeGreaterThanOrEqual(-1);
      expect(p.y).toBeLessThanOrEqual(10 * TILE_SIZE + 1);
      // pull back 2px from the vertex toward the origin before checking
      // solidity: vertices sit exactly on a wall boundary by construction
      // (raycast hit points), so testing the boundary itself is flaky by
      // rounding direction — testing just inside it catches a vertex that
      // sits deep inside a solid tile without false-failing on the boundary
      const dx = p.x - origin.x;
      const dy = p.y - origin.y;
      const t = Math.hypot(dx, dy);
      if (t > 2) {
        const shrink = (t - 2) / t;
        expect(map.isSolidAt(origin.x + dx * shrink, origin.y + dy * shrink)).toBe(false);
      }
    }
  });
});
