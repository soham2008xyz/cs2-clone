import { PLAYER_RADIUS } from '../constants.js';
import { fromAngle, rayCircle, raycastGrid, type Vec2 } from '../math.js';
import type { CompiledMap, TeamId } from '../map/types.js';
import { TILE_SIZE } from '../constants.js';
import type { WeaponDef } from './weapons.data.js';

export interface CombatTarget {
  id: number;
  pos: Vec2;
  team: TeamId;
  alive: boolean;
}

export interface ShotHit {
  targetId: number;
  distance: number;
  rawDamage: number;
}

export interface ShotResult {
  dir: number; // actual direction after spread
  end: Vec2; // tracer endpoint
  hit: ShotHit | null;
}

/** Damage multiplier at a distance (rangeMod applied per 512px). */
export function falloff(weapon: WeaponDef, distance: number): number {
  return Math.pow(weapon.rangeMod, distance / 512);
}

/**
 * Armor absorption (CS-style): armored targets take damage*armorPen; armor
 * durability loses half of what it absorbed. Returns final hp damage and
 * armor remaining.
 */
export function applyArmor(damage: number, armor: number, armorPen: number): { hpDamage: number; armor: number } {
  if (armor <= 0) return { hpDamage: Math.round(damage), armor: 0 };
  const hpDamage = damage * armorPen;
  const absorbed = damage - hpDamage;
  const newArmor = Math.max(0, Math.round(armor - absorbed / 2));
  return { hpDamage: Math.round(hpDamage), armor: newArmor };
}

/**
 * Resolve one hitscan shot: apply spread, trace against walls, hit the
 * nearest enemy circle in front of the wall. Pure — the caller applies damage.
 */
export function traceShot(
  origin: Vec2,
  aim: number,
  spread: number,
  weapon: WeaponDef,
  shooterTeam: TeamId,
  targets: Iterable<CombatTarget>,
  map: CompiledMap,
  rng: () => number,
  friendlyFire = false,
): ShotResult {
  // triangular distribution approximates gaussian spread
  const dir = aim + (rng() + rng() - 1) * spread;
  const d = fromAngle(dir);

  const wallDist = raycastGrid(origin, d, weapon.range, TILE_SIZE, map.isSolid);

  let best: ShotHit | null = null;
  for (const t of targets) {
    if (!t.alive) continue;
    if (!friendlyFire && t.team === shooterTeam) continue;
    const dist = rayCircle(origin, d, t.pos, PLAYER_RADIUS);
    if (dist === null || dist <= 0 || dist >= wallDist || dist > weapon.range) continue;
    if (!best || dist < best.distance) {
      best = { targetId: t.id, distance: dist, rawDamage: weapon.damage * falloff(weapon, dist) };
    }
  }

  const endDist = best ? best.distance : wallDist;
  return { dir, end: { x: origin.x + d.x * endDist, y: origin.y + d.y * endDist }, hit: best };
}
