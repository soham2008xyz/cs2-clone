import { describe, expect, it } from 'vitest';
import { INTERP_DELAY_TICKS, LagCompensator, MAX_REWIND_TICKS } from '../src/lagcomp.js';

/** Player whose x position equals the tick it was recorded at — easy to assert. */
const movingPlayer = (id: number, tick: number, alive = true) => ({ id, pos: { x: tick, y: 0 }, alive });

function recordedComp(fromTick: number, toTick: number): LagCompensator {
  const comp = new LagCompensator();
  for (let t = fromTick; t <= toTick; t++) comp.record(t, [movingPlayer(1, t)]);
  return comp;
}

describe('LagCompensator.rewind', () => {
  it('returns null with no history', () => {
    expect(new LagCompensator().rewind(50, 60)).toBeNull();
  });

  it('rewinds to the client-seen tick minus the interpolation delay', () => {
    const comp = recordedComp(1, 60);
    const rewound = comp.rewind(50, 60);
    expect(rewound?.get(1)?.x).toBe(50 - INTERP_DELAY_TICKS);
  });

  it('clamps to the oldest recorded frame when history is shorter than the cap', () => {
    const comp = recordedComp(100, 104);
    expect(comp.rewind(2, 104)?.get(1)?.x).toBe(100);
  });

  it('caps the rewind at MAX_REWIND_TICKS for a far-past seen tick', () => {
    const comp = recordedComp(100, 160);
    const rewound = comp.rewind(110, 160); // forged: claims to have seen tick 110
    expect(rewound?.get(1)?.x).toBe(160 - MAX_REWIND_TICKS);
  });

  it.each([NaN, Infinity, -Infinity])('treats seen tick %s like undefined', (bad) => {
    const comp = recordedComp(1, 60);
    expect(comp.rewind(bad, 60)?.get(1)?.x).toBe(60);
  });

  it('never rewinds past the current tick', () => {
    const comp = recordedComp(1, 60);
    const rewound = comp.rewind(999, 60); // bogus future ack
    expect(rewound?.get(1)?.x).toBeLessThanOrEqual(60);
  });

  it('falls back to current positions when the seen tick is unknown (bots)', () => {
    const comp = recordedComp(1, 60);
    expect(comp.rewind(undefined, 60)?.get(1)?.x).toBe(60);
  });

  it('does not record dead players', () => {
    const comp = new LagCompensator();
    comp.record(1, [movingPlayer(1, 1), movingPlayer(2, 1, false)]);
    const rewound = comp.rewind(undefined, 1);
    expect(rewound?.has(1)).toBe(true);
    expect(rewound?.has(2)).toBe(false);
  });
});
