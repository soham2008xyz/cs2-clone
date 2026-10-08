import { canSeeBody, type CompiledMap, type Occluder, type Vec2 } from '@cs2d/shared';

/** Keep sending an enemy this long after line of sight breaks, so interpolation never pops them at corners. */
export const VIS_GRACE_TICKS = 12; // 200 ms

export interface Viewable<S> {
  id: number;
  pos: Vec2;
  /** What the viewer receives for this target while it is in sight. */
  snap: S;
}

export interface Sighting<S> {
  snap: S;
  /** In sight this tick. False while only the grace window keeps it: `snap` is then the last one seen. */
  live: boolean;
}

/** Per-viewer record of each target's last sighting, for the grace window. */
export class VisibilityMemory<S> {
  private readonly last = new Map<number, Map<number, { tick: number; snap: S }>>();

  /**
   * What the viewer may know about `targets` this tick. A target that just left
   * sight is replayed from its last seen snapshot until the grace window ends,
   * so hidden movement never leaks.
   */
  visible(
    viewerId: number,
    vantages: readonly Vec2[],
    targets: Iterable<Viewable<S>>,
    map: CompiledMap,
    smokes: readonly Occluder[],
    tick: number,
  ): Map<number, Sighting<S>> {
    let seen = this.last.get(viewerId);
    if (!seen) {
      seen = new Map();
      this.last.set(viewerId, seen);
    }
    const out = new Map<number, Sighting<S>>();
    for (const t of targets) {
      if (canSeeBody(vantages, t.pos, map, smokes)) {
        seen.set(t.id, { tick, snap: t.snap });
        out.set(t.id, { snap: t.snap, live: true });
        continue;
      }
      const prev = seen.get(t.id);
      if (prev && tick - prev.tick <= VIS_GRACE_TICKS) out.set(t.id, { snap: prev.snap, live: false });
      else seen.delete(t.id);
    }
    return out;
  }

  /** Forget a player who left (as viewer and as target). */
  forget(id: number): void {
    this.last.delete(id);
    for (const seen of this.last.values()) seen.delete(id);
  }

  /** Round reset: respawns teleport everyone, so old sightings mean nothing. */
  clear(): void {
    this.last.clear();
  }
}
