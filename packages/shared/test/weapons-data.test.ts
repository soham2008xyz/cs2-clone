import { describe, expect, it } from 'vitest';
import { WEAPONS } from '../src/sim/weapons.data.js';

describe('weapon data sanity', () => {
  for (const w of Object.values(WEAPONS)) {
    it(`${w.id}: fields are within sane bounds`, () => {
      expect(w.price).toBeGreaterThanOrEqual(0);
      expect(w.damage).toBeGreaterThan(0);
      expect(w.magazine).toBeGreaterThanOrEqual(0);
      expect(w.rangeMod).toBeGreaterThan(0);
      expect(w.rangeMod).toBeLessThanOrEqual(1);
      expect(w.armorPen).toBeGreaterThan(0);
      expect(w.armorPen).toBeLessThan(1);
      expect(w.mobility).toBeGreaterThan(0);
      expect(w.mobility).toBeLessThanOrEqual(1);
      expect(w.range).toBeGreaterThan(0);
      expect(w.rpm).toBeGreaterThan(0);
    });
  }

  it('pistols are semi-auto', () => {
    for (const w of Object.values(WEAPONS).filter((w) => w.cls === 'pistol')) {
      expect(w.auto, w.id).toBe(false);
    }
  });

  it('smgs and rifles are full-auto', () => {
    for (const w of Object.values(WEAPONS).filter((w) => w.cls === 'smg' || w.cls === 'rifle')) {
      expect(w.auto, w.id).toBe(true);
    }
  });

  it('the knife has no magazine or reserve', () => {
    expect(WEAPONS.knife.magazine).toBe(0);
    expect(WEAPONS.knife.reserve).toBe(0);
  });
});
