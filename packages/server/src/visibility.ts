import { dist, hasLineOfSight, PLAYER_RADIUS, VISION_RANGE, type CompiledMap, type Occluder, type Vec2 } from '@cs2d/shared';

/** Keep sending an enemy this long after line of sight breaks, so interpolation never pops them at corners. */
export const VIS_GRACE_TICKS = 12; // 200 ms

/** Vision range plus the body radius: an enemy whose edge is in range still counts. */
const SEE_RANGE = VISION_RANGE + PLAYER_RADIUS;

export interface Viewable {
  id: number;
  pos: Vec2;
}

/** Can any vantage see a body at `target`? Tests the center and both sides (perpendicular, one radius out). */
export function canSeeBody(vantages: readonly Vec2[], target: Vec2, map: CompiledMap, smokes: readonly Occluder[]): boolean {
  for (const v of vantages) {
    const d = dist(v, target);
    if (d > SEE_RANGE) continue;
    if (d === 0 || hasLineOfSight(v, target, map, smokes, SEE_RANGE)) return true;
    const nx = (-(target.y - v.y) / d) * PLAYER_RADIUS;
    const ny = ((target.x - v.x) / d) * PLAYER_RADIUS;
    if (hasLineOfSight(v, { x: target.x + nx, y: target.y + ny }, map, smokes, SEE_RANGE)) return true;
    if (hasLineOfSight(v, { x: target.x - nx, y: target.y - ny }, map, smokes, SEE_RANGE)) return true;
  }
  return false;
}

/** Per-viewer record of when each target was last in sight, for the grace window. */
export class VisibilityMemory {
  private readonly lastSeen = new Map<number, Map<number, number>>();

  /** Ids from `targets` the viewer may know about this tick: in sight now, or within the grace window. */
  visible(
    viewerId: number,
    vantages: readonly Vec2[],
    targets: Iterable<Viewable>,
    map: CompiledMap,
    smokes: readonly Occluder[],
    tick: number,
  ): Set<number> {
    let seen = this.lastSeen.get(viewerId);
    if (!seen) {
      seen = new Map();
      this.lastSeen.set(viewerId, seen);
    }
    const out = new Set<number>();
    for (const t of targets) {
      if (canSeeBody(vantages, t.pos, map, smokes)) {
        seen.set(t.id, tick);
        out.add(t.id);
      } else if (tick - (seen.get(t.id) ?? -Infinity) <= VIS_GRACE_TICKS) {
        out.add(t.id);
      }
    }
    return out;
  }

  /** Forget a player who left (as viewer and as target). */
  forget(id: number): void {
    this.lastSeen.delete(id);
    for (const seen of this.lastSeen.values()) seen.delete(id);
  }

  /** Round reset: respawns teleport everyone, so old sightings mean nothing. */
  clear(): void {
    this.lastSeen.clear();
  }
}
