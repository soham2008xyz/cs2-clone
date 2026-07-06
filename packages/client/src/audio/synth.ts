/**
 * Zero-asset WebAudio synth (ZzFX-style): every sound is a handful of
 * parameters driving an oscillator or noise burst through a gain envelope.
 * The AudioContext is created lazily and resumed on the first user gesture.
 */

export interface SynthParams {
  type?: OscillatorType | 'noise';
  freq?: number; // start frequency (oscillator types)
  slide?: number; // frequency multiplier reached at the end of the sound
  duration?: number; // seconds
  attack?: number; // seconds to full volume
  volume?: number; // 0..1 pre-master
  filterFreq?: number; // lowpass cutoff for noise
}

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let muted = false;

const MASTER_VOLUME = 0.5;

function ensureCtx(): AudioContext | null {
  if (ctx) return ctx;
  try {
    ctx = new AudioContext();
    master = ctx.createGain();
    master.gain.value = MASTER_VOLUME;
    master.connect(ctx.destination);
  } catch {
    ctx = null; // no audio support — stay silent
  }
  return ctx;
}

/** Call from a user gesture; browsers keep contexts suspended until then. */
export function unlockAudio(): void {
  const c = ensureCtx();
  if (c && c.state === 'suspended') void c.resume();
}

export function toggleMute(): boolean {
  muted = !muted;
  if (master) master.gain.value = muted ? 0 : MASTER_VOLUME;
  return muted;
}

export function isMuted(): boolean {
  return muted;
}

/** Fire one synth voice. `pan` −1..1, `gainScale` 0..1, `delay` seconds. */
export function play(params: SynthParams, pan = 0, gainScale = 1, delay = 0): void {
  const c = ensureCtx();
  if (!c || c.state !== 'running' || muted || gainScale <= 0) return;
  const { type = 'square', freq = 440, slide = 1, duration = 0.1, attack = 0.005, volume = 0.3 } = params;
  const t0 = c.currentTime + delay;

  const g = c.createGain();
  g.gain.setValueAtTime(0, t0);
  g.gain.linearRampToValueAtTime(volume * gainScale, t0 + attack);
  g.gain.exponentialRampToValueAtTime(0.001, t0 + duration);
  const panner = new StereoPannerNode(c, { pan });
  g.connect(panner);
  panner.connect(master!);

  if (type === 'noise') {
    const len = Math.max(1, Math.ceil(c.sampleRate * duration));
    const buf = c.createBuffer(1, len, c.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    const src = c.createBufferSource();
    src.buffer = buf;
    if (params.filterFreq) {
      const f = c.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.value = params.filterFreq;
      src.connect(f);
      f.connect(g);
    } else {
      src.connect(g);
    }
    src.start(t0);
    src.stop(t0 + duration);
  } else {
    const osc = c.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    osc.frequency.exponentialRampToValueAtTime(Math.max(1, freq * slide), t0 + duration);
    osc.connect(g);
    osc.start(t0);
    osc.stop(t0 + duration);
  }
}
