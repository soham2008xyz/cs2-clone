import { INTERP_DELAY_MS, lerp, lerpAngle, type SnapshotMsg } from '@cs2d/shared';

export interface RemoteState {
  x: number;
  y: number;
  aim: number;
  hp: number;
  flags: number;
}

interface Frame {
  time: number; // local receive time (performance.now())
  players: Map<number, RemoteState>;
}

/**
 * Renders remote entities ~INTERP_DELAY_MS in the past, interpolating between
 * the two snapshots that bracket the render time. Receive-time domain avoids
 * needing clock sync with the server.
 */
export class SnapshotBuffer {
  private frames: Frame[] = [];

  push(snap: SnapshotMsg): void {
    const players = new Map<number, RemoteState>();
    for (const [id, x, y, aim, hp, flags] of snap.p) {
      players.set(id, { x, y, aim, hp, flags });
    }
    this.frames.push({ time: performance.now(), players });
    const cutoff = performance.now() - 2000;
    while (this.frames.length > 2 && this.frames[0].time < cutoff) this.frames.shift();
  }

  sample(): Map<number, RemoteState> {
    const out = new Map<number, RemoteState>();
    if (this.frames.length === 0) return out;

    const renderTime = performance.now() - INTERP_DELAY_MS;
    let older = this.frames[0];
    let newer = this.frames[this.frames.length - 1];
    for (let i = this.frames.length - 1; i >= 0; i--) {
      if (this.frames[i].time <= renderTime) {
        older = this.frames[i];
        newer = this.frames[Math.min(i + 1, this.frames.length - 1)];
        break;
      }
    }

    const span = newer.time - older.time;
    const t = span > 0 ? Math.min(1, Math.max(0, (renderTime - older.time) / span)) : 1;

    for (const [id, b] of newer.players) {
      const a = older.players.get(id);
      if (!a) {
        out.set(id, b);
        continue;
      }
      out.set(id, {
        x: lerp(a.x, b.x, t),
        y: lerp(a.y, b.y, t),
        aim: lerpAngle(a.aim, b.aim, t),
        hp: b.hp,
        flags: b.flags,
      });
    }
    return out;
  }

  latestFor(id: number): RemoteState | undefined {
    return this.frames.at(-1)?.players.get(id);
  }
}
