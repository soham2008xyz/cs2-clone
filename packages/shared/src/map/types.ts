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

/** Rectangle of tiles where a team may buy (x/y/w/h in tile coords). */
export interface BuyZone {
  team: TeamId;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface MapDef {
  name: string;
  displayName: string;
  /** rows of equal-length strings using CH characters */
  grid: string[];
  callouts: Callout[];
  /** authored buy areas; maps without them fall back to a spawn-radius rule */
  buyzones?: BuyZone[];
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
  /** which team may buy at a px position (null = nobody; see MapDef.buyzones) */
  buyzoneAt(x: number, y: number): TeamId | null;
}
