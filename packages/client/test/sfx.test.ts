import { beforeEach, describe, expect, it, vi } from 'vitest';

const play = vi.fn();
vi.mock('../src/audio/synth.js', () => ({ play: (...a: unknown[]) => play(...a) }));

const { sfx } = await import('../src/audio/sfx.js');

beforeEach(() => play.mockClear());

describe('sfx', () => {
  it('plays every layer of a cue at full volume and centre pan when no position is given', () => {
    sfx('shot_rifle');
    expect(play).toHaveBeenCalledTimes(2);
    for (const call of play.mock.calls) expect(call.slice(1, 3)).toEqual([0, 1]);
  });

  it('passes each layer its time offset, defaulting to 0', () => {
    sfx('reload');
    expect(play.mock.calls.map((c) => c[3])).toEqual([0, 0.12]);
  });

  it('is inaudible beyond hearing range', () => {
    sfx('shot_pistol', { x: 2000, y: 0 }, { x: 0, y: 0 });
    expect(play).not.toHaveBeenCalled();
  });

  it('is full volume at the listener and louder nearby than far away', () => {
    sfx('hit', { x: 0, y: 0 }, { x: 0, y: 0 });
    sfx('hit', { x: 650, y: 0 }, { x: 0, y: 0 });
    const [near, far] = play.mock.calls.map((c) => c[2] as number);
    expect(near).toBe(1);
    expect(far).toBeGreaterThan(0);
    expect(far).toBeLessThan(near);
  });

  it('pans toward the source and clamps at full stereo', () => {
    sfx('hit', { x: 350, y: 0 }, { x: 0, y: 0 });
    sfx('hit', { x: -1000, y: 0 }, { x: 0, y: 0 });
    expect(play.mock.calls[0][1]).toBeCloseTo(0.5);
    expect(play.mock.calls[1][1]).toBe(-1);
  });

  it('plays world sounds only when a listener is known', () => {
    sfx('plant', { x: 5000, y: 5000 }); // no listener → no distance cull
    expect(play).toHaveBeenCalledTimes(2);
  });
});
