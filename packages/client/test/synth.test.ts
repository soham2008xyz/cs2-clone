import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type Node = { connect: ReturnType<typeof vi.fn>; [k: string]: unknown };

const created: { gains: Node[]; oscs: Node[]; sources: Node[]; filters: Node[]; panners: Array<{ pan: number }> } = { gains: [], oscs: [], sources: [], filters: [], panners: [] };
let state: 'running' | 'suspended' = 'running';
let resume: ReturnType<typeof vi.fn>;
let ctxCount = 0;

function node(extra: Record<string, unknown> = {}): Node {
  return { connect: vi.fn(), ...extra };
}

class FakeAudioContext {
  currentTime = 10;
  sampleRate = 100;
  destination = node();
  get state() {
    return state;
  }
  constructor() {
    ctxCount++;
    resume = vi.fn();
    this.resume = resume;
  }
  resume: ReturnType<typeof vi.fn>;
  createGain() {
    const g = node({ gain: { value: 1, setValueAtTime: vi.fn(), linearRampToValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() } });
    created.gains.push(g);
    return g;
  }
  createOscillator() {
    const o = node({ type: '', frequency: { setValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() }, start: vi.fn(), stop: vi.fn() });
    created.oscs.push(o);
    return o;
  }
  createBuffer(_ch: number, len: number) {
    const data = new Float32Array(len);
    return { getChannelData: () => data, data };
  }
  createBufferSource() {
    const s = node({ start: vi.fn(), stop: vi.fn(), buffer: null });
    created.sources.push(s);
    return s;
  }
  createBiquadFilter() {
    const f = node({ type: '', frequency: { value: 0 } });
    created.filters.push(f);
    return f;
  }
}

class FakePanner {
  connect = vi.fn();
  constructor(_c: unknown, opts: { pan: number }) {
    created.panners.push(opts);
  }
}

async function load() {
  vi.resetModules();
  return import('../src/audio/synth.js');
}

beforeEach(() => {
  state = 'running';
  ctxCount = 0;
  created.gains.length = created.oscs.length = created.sources.length = created.filters.length = created.panners.length = 0;
  vi.stubGlobal('AudioContext', FakeAudioContext);
  vi.stubGlobal('StereoPannerNode', FakePanner);
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe('synth.play', () => {
  it('stays silent until the audio context is running', async () => {
    const synth = await load();
    state = 'suspended';
    synth.play({ type: 'sine' });
    expect(created.oscs).toHaveLength(0);
  });

  it('builds an oscillator voice with a frequency slide and delayed start', async () => {
    const synth = await load();
    synth.play({ type: 'sawtooth', freq: 200, slide: 0.5, duration: 0.2, volume: 0.4, attack: 0.01 }, 0.5, 0.5, 0.3);
    const osc = created.oscs[0] as Node & { frequency: Record<string, ReturnType<typeof vi.fn>>; start: ReturnType<typeof vi.fn>; stop: ReturnType<typeof vi.fn> };
    expect(osc.type).toBe('sawtooth');
    expect(osc.frequency.setValueAtTime).toHaveBeenCalledWith(200, 10.3);
    expect(osc.frequency.exponentialRampToValueAtTime).toHaveBeenCalledWith(100, 10.3 + 0.2);
    expect(osc.start).toHaveBeenCalledWith(10.3);
    expect(osc.stop).toHaveBeenCalledWith(10.3 + 0.2);
    expect(created.panners[0].pan).toBe(0.5);
    const env = (created.gains[1] as Node & { gain: Record<string, ReturnType<typeof vi.fn>> }).gain; // [0] is the master gain
    expect(env.linearRampToValueAtTime).toHaveBeenCalledWith(0.4 * 0.5, 10.3 + 0.01);
  });

  it('applies defaults and never ramps the frequency below 1 Hz', async () => {
    const synth = await load();
    synth.play({ freq: 1, slide: 0.001 });
    const osc = created.oscs[0] as Node & { type: string; frequency: Record<string, ReturnType<typeof vi.fn>> };
    expect(osc.type).toBe('square');
    expect(osc.frequency.exponentialRampToValueAtTime.mock.calls[0][0]).toBe(1);
  });

  it('builds a white-noise voice, low-passed when a filter frequency is given', async () => {
    const synth = await load();
    synth.play({ type: 'noise', duration: 0.5, filterFreq: 900 });
    const src = created.sources[0] as Node & { buffer: { data: Float32Array }; start: ReturnType<typeof vi.fn>; stop: ReturnType<typeof vi.fn> };
    expect(src.buffer.data).toHaveLength(50); // sampleRate 100 × 0.5 s
    expect([...src.buffer.data].some((v) => v !== 0)).toBe(true);
    expect(created.filters).toHaveLength(1);
    expect((created.filters[0] as Node & { frequency: { value: number }; type: string }).frequency.value).toBe(900);
    expect((created.filters[0] as Node & { type: string }).type).toBe('lowpass');
    expect(src.connect).toHaveBeenCalledWith(created.filters[0]);
    expect(src.start).toHaveBeenCalledWith(10);
    expect(src.stop).toHaveBeenCalledWith(10.5);
  });

  it('connects noise straight to the envelope when unfiltered', async () => {
    const synth = await load();
    synth.play({ type: 'noise', duration: 0.1 });
    expect(created.filters).toHaveLength(0);
    expect(created.sources[0].connect).toHaveBeenCalledWith(created.gains[1]);
  });

  it('skips silent voices (gainScale <= 0)', async () => {
    const synth = await load();
    synth.play({ type: 'sine' }, 0, 0);
    expect(created.oscs).toHaveLength(0);
  });
});

describe('synth mute and unlock', () => {
  it('toggleMute flips the flag and the master gain, and mutes playback', async () => {
    const synth = await load();
    synth.unlockAudio(); // creates the context and master gain
    const master = created.gains[0] as Node & { gain: { value: number } };
    expect(master.gain.value).toBe(0.5);
    expect(synth.isMuted()).toBe(false);
    expect(synth.toggleMute()).toBe(true);
    expect(synth.isMuted()).toBe(true);
    expect(master.gain.value).toBe(0);
    synth.play({ type: 'sine' });
    expect(created.oscs).toHaveLength(0);
    expect(synth.toggleMute()).toBe(false);
    expect(master.gain.value).toBe(0.5);
  });

  it('toggleMute before any audio exists only flips the flag', async () => {
    const synth = await load();
    expect(synth.toggleMute()).toBe(true);
    expect(ctxCount).toBe(0);
  });

  it('unlockAudio resumes a suspended context and reuses one context', async () => {
    const synth = await load();
    state = 'suspended';
    synth.unlockAudio();
    expect(resume).toHaveBeenCalledTimes(1);
    state = 'running';
    synth.unlockAudio();
    expect(resume).toHaveBeenCalledTimes(1);
    expect(ctxCount).toBe(1);
  });

  it('stays silent, without throwing, when AudioContext is unavailable', async () => {
    vi.stubGlobal(
      'AudioContext',
      class {
        constructor() {
          throw new Error('unsupported');
        }
      },
    );
    const synth = await load();
    expect(() => synth.unlockAudio()).not.toThrow();
    expect(() => synth.play({ type: 'sine' })).not.toThrow();
  });
});
