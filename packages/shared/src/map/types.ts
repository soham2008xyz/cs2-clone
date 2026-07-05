import type { Vec2 } from '../math.js';

export type TeamId = 'T' | 'CT';

/** Grid cell characters used in MapDef.grid rows. */
export const CH = {
  WALL: '#',
  BOX: 'x', // crate: blocks movement and vision, rendered distinctly
  FLOOR: '.',
  SITE_A: 'A', // walkable, bomb plantable (A)
  SITE_B: 'B', // walkable, bomb plantable (B)
  T_SPAWN: 't',
  CT_SPAWN: 'c',
} as const;

export interface Callout {
  name: string;
  /** tile coords (center of the region) */
  tx: number;
  ty: number;
}

export interface MapDef {
  name: string;
  displayName: string;
  /** rows of equal-length strings using CH characters */
  grid: string[];
  callouts: Callout[];
}

/** Precomputed, gameplay-ready form of a MapDef. */
export interface CompiledMap {
  def: MapDef;
  width: number; // tiles
  height: number;
  widthPx: number;
  heightPx: number;
  solid: Uint8Array; // 1 = blocks movement + vision
  isSolid(tx: number, ty: number): boolean;
  isSolidAt(x: number, y: number): boolean; // px coords
  charAt(tx: number, ty: number): string;
  /** world-px spawn positions per team, in authoring order */
  spawns: Record<TeamId, Vec2[]>;
  /** which bombsite (if any) covers a px position */
  siteAt(x: number, y: number): 'A' | 'B' | null;
  siteCenters: Record<'A' | 'B', Vec2>;
}
