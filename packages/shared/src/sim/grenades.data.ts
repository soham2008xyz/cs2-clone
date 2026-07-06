import { HE_FUSE, MAX_FLASH_CARRY, MOLOTOV_FUSE, SMOKE_FUSE } from '../constants.js';
import type { TeamId } from '../map/types.js';

export type GrenadeKind = 'he' | 'flash' | 'smoke' | 'molotov' | 'incendiary';

export interface GrenadeDef {
  id: GrenadeKind;
  name: string;
  price: number;
  team?: TeamId;
  fuse: number; // seconds from throw to detonation
  maxCarry: number;
  /** money paid to the thrower per kill with this grenade */
  killReward: number;
  /** true for the two fire-grenade skins (same behavior, team-flavored id) */
  fire?: boolean;
}

export const GRENADES: Record<GrenadeKind, GrenadeDef> = {
  he: { id: 'he', name: 'HE Grenade', price: 300, fuse: HE_FUSE, maxCarry: 1, killReward: 300 },
  flash: { id: 'flash', name: 'Flashbang', price: 200, fuse: 1.6, maxCarry: MAX_FLASH_CARRY, killReward: 300 },
  smoke: { id: 'smoke', name: 'Smoke Grenade', price: 300, fuse: SMOKE_FUSE, maxCarry: 1, killReward: 300 },
  molotov: { id: 'molotov', name: 'Molotov', price: 400, team: 'T', fuse: MOLOTOV_FUSE, maxCarry: 1, killReward: 300, fire: true },
  incendiary: { id: 'incendiary', name: 'Incendiary Grenade', price: 500, team: 'CT', fuse: MOLOTOV_FUSE, maxCarry: 1, killReward: 300, fire: true },
};

export const getGrenade = (id: string): GrenadeDef => {
  const g = GRENADES[id as GrenadeKind];
  if (!g) throw new Error(`unknown grenade: ${id}`);
  return g;
};

export const isFireGrenade = (id: string): boolean => id === 'molotov' || id === 'incendiary';
