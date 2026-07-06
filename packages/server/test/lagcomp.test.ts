import { describe, expect, it } from 'vitest';
import { INTERP_DELAY_TICKS, LagCompensator } from '../src/lagcomp.js';

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

  it('clamps to the oldest recorded frame for very stale clients', () => {
    const comp = recordedComp(100, 160); // ring buffer holds 1s; oldest = 101 after shift
    const rewound = comp.rewind(2, 160);
    const oldestKept = 160 - 60 + 1;
    expect(rewound?.get(1)?.x).toBe(oldestKept);
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
