import { visibilityPolygon, type CompiledMap, type Occluder, type Vec2 } from '@cs2d/shared';

/** Origin moves smaller than this (world px) reuse the last polygon. */
export const VISION_MOVE_EPSILON = 1;

/**
 * Caches the visibility polygon between frames. `update` returns the polygon
 * and whether it was recomputed, so callers can skip redrawing when it was not.
 */
export class VisionCache {
  private readonly poly: Vec2[] = [];
  private origin: Vec2 | null = null;
  private smokes: Occluder[] = [];
  private map: CompiledMap | null = null;

  update(origin: Vec2, map: CompiledMap, smokes: readonly Occluder[]): { poly: Vec2[]; changed: boolean } {
    if (this.isFresh(origin, map, smokes)) return { poly: this.poly, changed: false };
    visibilityPolygon(origin, map, smokes, undefined, this.poly);
    this.origin = { x: origin.x, y: origin.y };
    this.map = map;
    this.smokes = smokes.map((s) => ({ pos: { x: s.pos.x, y: s.pos.y }, radius: s.radius }));
    return { poly: this.poly, changed: true };
  }

  private isFresh(origin: Vec2, map: CompiledMap, smokes: readonly Occluder[]): boolean {
    if (!this.origin || map !== this.map) return false;
    if (Math.hypot(origin.x - this.origin.x, origin.y - this.origin.y) >= VISION_MOVE_EPSILON) return false;
    if (smokes.length !== this.smokes.length) return false;
    return smokes.every((s, i) => {
      const c = this.smokes[i];
      return s.radius === c.radius && s.pos.x === c.pos.x && s.pos.y === c.pos.y;
    });
  }
}
