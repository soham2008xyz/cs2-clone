import { INTERP_DELAY_MS, TICK_RATE, type Vec2 } from '@cs2d/shared';

const HISTORY_TICKS = TICK_RATE; // 1 second
export const INTERP_DELAY_TICKS = Math.round((INTERP_DELAY_MS / 1000) * TICK_RATE);

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
  private frames: Frame[] = [];

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
    const target = clientSeenTick === undefined
      ? currentTick
      : Math.max(this.frames[0].tick, Math.min(currentTick, clientSeenTick - INTERP_DELAY_TICKS));
    // find nearest recorded frame ≤ target
    for (let i = this.frames.length - 1; i >= 0; i--) {
      if (this.frames[i].tick <= target) return this.frames[i].positions;
    }
    return this.frames[0].positions;
  }
}
