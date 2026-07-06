import type { TeamId } from '../map/types.js';

export type WeaponClass = 'pistol' | 'smg' | 'rifle' | 'knife';

export interface WeaponDef {
  id: string;
  name: string;
  cls: WeaponClass;
  /** buy restriction; undefined = both teams */
  team?: TeamId;
  price: number;
  killReward: number;
  damage: number;
  /** armor penetration 0..1 — fraction of damage kept vs armored targets */
  armorPen: number;
  rpm: number;
  magazine: number;
  reserve: number;
  reloadSec: number;
  /** movement speed multiplier while equipped */
  mobility: number;
  /** base inaccuracy, radians */
  spreadBase: number;
  /** additional spread while moving faster than walk */
  spreadMove: number;
  /** recoil bloom added per shot, radians */
  spreadPerShot: number;
  /** bloom decay per second */
  spreadDecay: number;
  /** damage falloff: multiplier applied per 512px of distance */
  rangeMod: number;
  /** max hitscan distance in px */
  range: number;
  auto: boolean;
}

const def = (d: WeaponDef): WeaponDef => d;

export const WEAPONS: Record<string, WeaponDef> = {
  knife: def({
    id: 'knife', name: 'Knife', cls: 'knife', price: 0, killReward: 1500,
    damage: 55, armorPen: 0.85, rpm: 110, magazine: 0, reserve: 0, reloadSec: 0,
    mobility: 1.0, spreadBase: 0, spreadMove: 0, spreadPerShot: 0, spreadDecay: 0,
    rangeMod: 1, range: 48, auto: false,
  }),
  glock: def({
    id: 'glock', name: 'Glock-18', cls: 'pistol', team: 'T', price: 200, killReward: 300,
    damage: 30, armorPen: 0.47, rpm: 400, magazine: 20, reserve: 120, reloadSec: 2.3,
    mobility: 0.97, spreadBase: 0.012, spreadMove: 0.05, spreadPerShot: 0.012, spreadDecay: 0.35,
    rangeMod: 0.9, range: 1400, auto: false,
  }),
  usp: def({
    id: 'usp', name: 'USP-S', cls: 'pistol', team: 'CT', price: 200, killReward: 300,
    damage: 35, armorPen: 0.505, rpm: 352, magazine: 12, reserve: 24, reloadSec: 2.2,
    mobility: 0.97, spreadBase: 0.009, spreadMove: 0.05, spreadPerShot: 0.013, spreadDecay: 0.35,
    rangeMod: 0.9, range: 1500, auto: false,
  }),
  deagle: def({
    id: 'deagle', name: 'Desert Eagle', cls: 'pistol', price: 700, killReward: 300,
    damage: 53, armorPen: 0.93, rpm: 267, magazine: 7, reserve: 35, reloadSec: 2.2,
    mobility: 0.94, spreadBase: 0.014, spreadMove: 0.09, spreadPerShot: 0.05, spreadDecay: 0.5,
    rangeMod: 0.94, range: 1800, auto: false,
  }),
  mac10: def({
    id: 'mac10', name: 'MAC-10', cls: 'smg', team: 'T', price: 1050, killReward: 600,
    damage: 29, armorPen: 0.575, rpm: 800, magazine: 30, reserve: 100, reloadSec: 2.6,
    mobility: 0.96, spreadBase: 0.02, spreadMove: 0.035, spreadPerShot: 0.008, spreadDecay: 0.55,
    rangeMod: 0.82, range: 1100, auto: true,
  }),
  mp9: def({
    id: 'mp9', name: 'MP9', cls: 'smg', team: 'CT', price: 1250, killReward: 600,
    damage: 26, armorPen: 0.6, rpm: 857, magazine: 30, reserve: 120, reloadSec: 2.1,
    mobility: 0.97, spreadBase: 0.018, spreadMove: 0.032, spreadPerShot: 0.007, spreadDecay: 0.55,
    rangeMod: 0.83, range: 1100, auto: true,
  }),
  galil: def({
    id: 'galil', name: 'Galil AR', cls: 'rifle', team: 'T', price: 1800, killReward: 300,
    damage: 30, armorPen: 0.775, rpm: 666, magazine: 35, reserve: 90, reloadSec: 2.9,
    mobility: 0.88, spreadBase: 0.011, spreadMove: 0.07, spreadPerShot: 0.011, spreadDecay: 0.45,
    rangeMod: 0.97, range: 2200, auto: true,
  }),
  famas: def({
    id: 'famas', name: 'FAMAS', cls: 'rifle', team: 'CT', price: 2050, killReward: 300,
    damage: 30, armorPen: 0.7, rpm: 666, magazine: 25, reserve: 90, reloadSec: 3.3,
    mobility: 0.88, spreadBase: 0.011, spreadMove: 0.07, spreadPerShot: 0.011, spreadDecay: 0.45,
    rangeMod: 0.96, range: 2200, auto: true,
  }),
  ak47: def({
    id: 'ak47', name: 'AK-47', cls: 'rifle', team: 'T', price: 2700, killReward: 300,
    damage: 36, armorPen: 0.775, rpm: 600, magazine: 30, reserve: 90, reloadSec: 2.4,
    mobility: 0.86, spreadBase: 0.01, spreadMove: 0.085, spreadPerShot: 0.014, spreadDecay: 0.42,
    rangeMod: 0.98, range: 2600, auto: true,
  }),
  m4a4: def({
    id: 'm4a4', name: 'M4A4', cls: 'rifle', team: 'CT', price: 3100, killReward: 300,
    damage: 33, armorPen: 0.7, rpm: 666, magazine: 30, reserve: 90, reloadSec: 3.1,
    mobility: 0.87, spreadBase: 0.009, spreadMove: 0.078, spreadPerShot: 0.012, spreadDecay: 0.45,
    rangeMod: 0.97, range: 2600, auto: true,
  }),
};

export const getWeapon = (id: string): WeaponDef => {
  const w = WEAPONS[id];
  if (!w) throw new Error(`unknown weapon: ${id}`);
  return w;
};

export const DEFAULT_PISTOL: Record<TeamId, string> = { T: 'glock', CT: 'usp' };
