import { INTERP_DELAY_MS, TICK_RATE, type Vec2 } from '@cs2d/shared';

const HISTORY_TICKS = TICK_RATE; // 1 second
export const INTERP_DELAY_TICKS = Math.round((INTERP_DELAY_MS / 1000) * TICK_RATE);
/** Furthest back a shot may be checked: 200 ms of latency plus the interpolation delay. */
export const MAX_REWIND_TICKS = Math.round(0.2 * TICK_RATE) + INTERP_DELAY_TICKS;

interface Frame {
  tick: number;
  positions: Map<number, Vec2>;
}

/**
 * Ring buffer of past player positions. When a client fires, we rewind
 * targets to (last tick the client had seen − interpolation delay), so hits
 * land where the shooter actually saw enemies on their screen.
 */
export class LagCompensator {
  private readonly frames: Frame[] = [];

  record(tick: number, players: Iterable<{ id: number; pos: Vec2; alive: boolean }>): void {
    const positions = new Map<number, Vec2>();
    for (const p of players) {
      if (p.alive) positions.set(p.id, { x: p.pos.x, y: p.pos.y });
    }
    this.frames.push({ tick, positions });
    if (this.frames.length > HISTORY_TICKS) this.frames.shift();
  }

  /**
   * Positions as the shooting client saw them. `clientSeenTick` is the latest
   * server tick the client acknowledged; falls back to current positions when
   * history is unavailable.
   */
  rewind(clientSeenTick: number | undefined, currentTick: number): Map<number, Vec2> | null {
    if (this.frames.length === 0) return null;
    // the client picks `clientSeenTick`, so ignore non-finite values and cap how far back it can reach
    const target = clientSeenTick === undefined || !Number.isFinite(clientSeenTick)
      ? currentTick
      : Math.max(
          this.frames[0].tick,
          currentTick - MAX_REWIND_TICKS,
          Math.min(currentTick, clientSeenTick - INTERP_DELAY_TICKS),
        );
    // find nearest recorded frame ≤ target
    for (let i = this.frames.length - 1; i >= 0; i--) {
      if (this.frames[i].tick <= target) return this.frames[i].positions;
    }
    return this.frames[0].positions;
  }
}
