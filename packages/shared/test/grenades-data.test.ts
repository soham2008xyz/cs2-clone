import { describe, expect, it } from 'vitest';
import { getGrenade, GRENADES, isFireGrenade } from '../src/sim/grenades.data.js';

describe('grenade data sanity', () => {
  for (const g of Object.values(GRENADES)) {
    it(`${g.id}: fields are within sane bounds`, () => {
      expect(g.price).toBeGreaterThanOrEqual(0);
      expect(g.fuse).toBeGreaterThan(0);
      expect(g.maxCarry).toBeGreaterThanOrEqual(1);
      expect(g.killReward).toBeGreaterThanOrEqual(0);
    });
  }

  it('molotov is T-only and incendiary is CT-only (same fire behavior, team-flavored id)', () => {
    expect(GRENADES.molotov.team).toBe('T');
    expect(GRENADES.incendiary.team).toBe('CT');
    expect(GRENADES.molotov.fire).toBe(true);
    expect(GRENADES.incendiary.fire).toBe(true);
  });

  it('he/flash/smoke are team-neutral', () => {
    expect(GRENADES.he.team).toBeUndefined();
    expect(GRENADES.flash.team).toBeUndefined();
    expect(GRENADES.smoke.team).toBeUndefined();
  });

  it('isFireGrenade is true only for molotov/incendiary', () => {
    for (const g of Object.values(GRENADES)) {
      expect(isFireGrenade(g.id)).toBe(g.fire === true);
    }
  });

  it('getGrenade resolves every known id and throws on an unknown one', () => {
    for (const g of Object.values(GRENADES)) {
      expect(getGrenade(g.id)).toBe(g);
    }
    expect(() => getGrenade('nonexistent')).toThrow(/unknown grenade/);
  });
});
