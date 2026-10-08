import { describe, expect, it } from 'vitest';
import type { SelfState } from '@cs2d/shared';
import { hpLabel, killfeedColor, nadeColor, teamChatColor, weaponLines } from '../src/scenes/presentation.js';

const self = (over: Partial<SelfState> = {}): SelfState => ({
  ammo: 20,
  reserve: 120,
  armor: 0,
  money: 800,
  slot: 2,
  weapon: 'glock',
  reload: 0,
  ...over,
});

describe('hpLabel', () => {
  it('is blank while dead', () => {
    expect(hpLabel(100, false, self())).toBe('');
  });

  it('shows health alone without armor', () => {
    expect(hpLabel(87, true, self())).toBe('♥ 87');
    expect(hpLabel(87, true, null)).toBe('♥ 87');
  });

  it('clamps negative health to 0', () => {
    expect(hpLabel(-5, true, null)).toBe('♥ 0');
  });

  it('appends armor, with + for a helmet', () => {
    expect(hpLabel(100, true, self({ armor: 64 }))).toBe('♥ 100  ⛨ 64');
    expect(hpLabel(100, true, self({ armor: 100, helm: 1 }))).toBe('♥ 100  ⛨ 100+');
  });
});

describe('weaponLines', () => {
  it('shows THROW and the front grenade name in the grenade slot', () => {
    expect(weaponLines(self({ slot: 4, nades: ['smoke', 'flash'] }))).toEqual({ ammo: 'THROW', weapon: 'SMOKE GRENADE' });
  });

  it('falls through to the gun when the grenade slot is empty', () => {
    expect(weaponLines(self({ slot: 4, nades: [] }))).toEqual({ ammo: '20 / 120', weapon: 'GLOCK' });
  });

  it('shows a dash for the knife', () => {
    expect(weaponLines(self({ slot: 3, weapon: 'knife' }))).toEqual({ ammo: '—', weapon: 'KNIFE' });
  });

  it('shows RELOADING while a reload is in progress', () => {
    expect(weaponLines(self({ reload: 12 }))).toEqual({ ammo: 'RELOADING', weapon: 'GLOCK' });
  });

  it('shows magazine / reserve and the kit marker', () => {
    expect(weaponLines(self({ weapon: 'm4a4', ammo: 30, reserve: 90, kit: 1 }))).toEqual({ ammo: '30 / 90', weapon: 'M4A4  +KIT' });
  });
});

describe('killfeedColor', () => {
  it('highlights our kills, then our deaths, else neutral', () => {
    expect(killfeedColor({ meKiller: true, meVictim: false })).toBe('#ffd76b');
    expect(killfeedColor({ meKiller: false, meVictim: true })).toBe('#ff6b6b');
    expect(killfeedColor({ meKiller: false, meVictim: false })).toBe('#dddddd');
  });
});

describe('teamChatColor', () => {
  it('colors by team, grey for no team', () => {
    expect(teamChatColor('T')).toBe('#ffd280');
    expect(teamChatColor('CT')).toBe('#9cc4ff');
    expect(teamChatColor(null)).toBe('#aaaaaa');
    expect(teamChatColor(undefined)).toBe('#aaaaaa');
  });
});

describe('nadeColor', () => {
  it('maps utility kinds, with fire grenades sharing the fallback', () => {
    expect(nadeColor('flash')).toBe(0xdddddd);
    expect(nadeColor('smoke')).toBe(0x999999);
    expect(nadeColor('he')).toBe(0x556b2f);
    expect(nadeColor('molotov')).toBe(0x8b3a1a);
    expect(nadeColor('incendiary')).toBe(0x8b3a1a);
  });
});
