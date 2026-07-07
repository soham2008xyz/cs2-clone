import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SnapshotMsg } from '@cs2d/shared';
import { SnapshotBuffer } from '../src/net/interpolation.js';

const snap = (recvTick: number, id: number, x: number, y: number, aim = 0): SnapshotMsg => ({
  t: 's',
  k: recvTick,
  a: 0,
  p: [[id, x, y, aim, 100, 1, 'knife']],
});

describe('SnapshotBuffer.sample', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns nothing before any snapshot arrives', () => {
    expect(new SnapshotBuffer().sample().size).toBe(0);
  });

  it('interpolates between the two snapshots bracketing the render time', () => {
    const buf = new SnapshotBuffer();
    const now = vi.spyOn(performance, 'now');

    now.mockReturnValue(1000);
    buf.push(snap(1, 1, 0, 0));
    now.mockReturnValue(1100);
    buf.push(snap(2, 1, 100, 0));

    // INTERP_DELAY_MS is 100ms, so a mocked "now" of 1150 renders at t=1050 —
    // exactly halfway between the two pushed frames (1000 and 1100)
    now.mockReturnValue(1150);
    const state = buf.sample().get(1);
    expect(state).toBeDefined();
    expect(state!.x).toBeCloseTo(50, 5);
    expect(state!.y).toBe(0);
  });

  it('holds at the single available frame when only one snapshot exists', () => {
    const buf = new SnapshotBuffer();
    const now = vi.spyOn(performance, 'now');
    now.mockReturnValue(1000);
    buf.push(snap(1, 1, 42, 7));

    now.mockReturnValue(5000); // long after that one frame
    const state = buf.sample().get(1);
    expect(state).toEqual({ x: 42, y: 7, aim: 0, hp: 100, flags: 1 });
  });

  it('holds at the newest frame when the render time is past every pushed snapshot', () => {
    const buf = new SnapshotBuffer();
    const now = vi.spyOn(performance, 'now');
    now.mockReturnValue(1000);
    buf.push(snap(1, 1, 0, 0));
    now.mockReturnValue(1100);
    buf.push(snap(2, 1, 100, 0));

    now.mockReturnValue(50000); // far beyond both frames, no extrapolation
    const state = buf.sample().get(1);
    expect(state).toEqual({ x: 100, y: 0, aim: 0, hp: 100, flags: 1 });
  });
});

describe('SnapshotBuffer.latestFor', () => {
  it('returns the raw (non-interpolated) latest state for a known id, undefined otherwise', () => {
    const buf = new SnapshotBuffer();
    expect(buf.latestFor(1)).toBeUndefined();

    buf.push(snap(1, 1, 5, 9));
    expect(buf.latestFor(1)).toEqual({ x: 5, y: 9, aim: 0, hp: 100, flags: 1 });
    expect(buf.latestFor(2)).toBeUndefined();
  });
});
