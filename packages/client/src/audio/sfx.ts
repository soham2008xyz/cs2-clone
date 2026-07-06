import { play, type SynthParams } from './synth.js';
import type { Vec2 } from '@cs2d/shared';

/** A cue is one or more synth voices, optionally offset in time (seconds). */
type Layer = { p: SynthParams; at?: number };

const CUES = {
  // gunshots by weapon class: noise crack + a tonal thump
  shot_pistol: [
    { p: { type: 'noise', duration: 0.08, volume: 0.3, filterFreq: 3200 } },
    { p: { type: 'square', freq: 620, slide: 0.3, duration: 0.05, volume: 0.1 } },
  ],
  shot_smg: [
    { p: { type: 'noise', duration: 0.06, volume: 0.24, filterFreq: 4200 } },
    { p: { type: 'square', freq: 800, slide: 0.4, duration: 0.04, volume: 0.08 } },
  ],
  shot_rifle: [
    { p: { type: 'noise', duration: 0.11, volume: 0.36, filterFreq: 2400 } },
    { p: { type: 'sawtooth', freq: 320, slide: 0.25, duration: 0.09, volume: 0.14 } },
  ],
  shot_knife: [{ p: { type: 'noise', duration: 0.05, volume: 0.1, filterFreq: 6000 } }],
  reload: [
    { p: { type: 'square', freq: 950, slide: 0.7, duration: 0.05, volume: 0.1 } },
    { p: { type: 'square', freq: 700, slide: 0.8, duration: 0.05, volume: 0.1 }, at: 0.12 },
  ],
  buy: [{ p: { type: 'sine', freq: 880, slide: 1.4, duration: 0.07, volume: 0.16 } }],
  hit: [{ p: { type: 'sine', freq: 1200, slide: 0.9, duration: 0.05, volume: 0.16 } }],
  hurt: [{ p: { type: 'sawtooth', freq: 180, slide: 0.6, duration: 0.14, volume: 0.2 } }],
  kill: [
    { p: { type: 'sine', freq: 660, slide: 1, duration: 0.07, volume: 0.16 } },
    { p: { type: 'sine', freq: 990, slide: 1, duration: 0.09, volume: 0.16 }, at: 0.08 },
  ],
  he_boom: [
    { p: { type: 'noise', duration: 0.5, volume: 0.5, filterFreq: 900, attack: 0.01 } },
    { p: { type: 'sine', freq: 140, slide: 0.3, duration: 0.4, volume: 0.35 } },
  ],
  flash_pop: [
    { p: { type: 'noise', duration: 0.2, volume: 0.4, filterFreq: 8000 } },
    { p: { type: 'sine', freq: 1600, slide: 0.9, duration: 0.35, volume: 0.2 } },
  ],
  smoke_pop: [{ p: { type: 'noise', duration: 0.3, volume: 0.22, filterFreq: 1200, attack: 0.02 } }],
  molly_ignite: [
    { p: { type: 'noise', duration: 0.45, volume: 0.3, filterFreq: 1800, attack: 0.02 } },
    { p: { type: 'sawtooth', freq: 90, slide: 0.7, duration: 0.35, volume: 0.12 } },
  ],
  nade_bounce: [{ p: { type: 'square', freq: 500, slide: 0.5, duration: 0.03, volume: 0.08 } }],
  plant: [
    { p: { type: 'sine', freq: 1046, slide: 1, duration: 0.08, volume: 0.18 } },
    { p: { type: 'sine', freq: 1046, slide: 1, duration: 0.08, volume: 0.18 }, at: 0.15 },
  ],
  defused: [
    { p: { type: 'sine', freq: 523, slide: 1, duration: 0.1, volume: 0.18 } },
    { p: { type: 'sine', freq: 784, slide: 1, duration: 0.14, volume: 0.18 }, at: 0.12 },
  ],
  c4_explosion: [
    { p: { type: 'noise', duration: 1.1, volume: 0.6, filterFreq: 500, attack: 0.01 } },
    { p: { type: 'sine', freq: 90, slide: 0.25, duration: 0.9, volume: 0.45 } },
  ],
  bomb_beep: [{ p: { type: 'sine', freq: 1318, slide: 1, duration: 0.07, volume: 0.15 } }],
  round_start: [
    { p: { type: 'sine', freq: 523, slide: 1, duration: 0.08, volume: 0.14 } },
    { p: { type: 'sine', freq: 659, slide: 1, duration: 0.1, volume: 0.14 }, at: 0.1 },
  ],
  round_win: [
    { p: { type: 'sine', freq: 523, slide: 1, duration: 0.09, volume: 0.16 } },
    { p: { type: 'sine', freq: 659, slide: 1, duration: 0.09, volume: 0.16 }, at: 0.1 },
    { p: { type: 'sine', freq: 784, slide: 1, duration: 0.16, volume: 0.16 }, at: 0.2 },
  ],
  round_lose: [
    { p: { type: 'sine', freq: 392, slide: 1, duration: 0.12, volume: 0.14 } },
    { p: { type: 'sine', freq: 311, slide: 1, duration: 0.2, volume: 0.14 }, at: 0.13 },
  ],
} satisfies Record<string, Layer[]>;

export type CueName = keyof typeof CUES;

const HEARING_RANGE = 1300; // px beyond which world sounds are inaudible
const PAN_RANGE = 700; // px of horizontal offset that maps to full stereo pan

/**
 * Play a named cue. With `at` + `listener`, volume falls off with distance
 * and the sound pans toward its world position (audible through fog — by
 * design, sound is information in CS).
 */
export function sfx(name: CueName, at?: Vec2, listener?: Vec2): void {
  let gain = 1;
  let pan = 0;
  if (at && listener) {
    const dx = at.x - listener.x;
    const d = Math.hypot(dx, at.y - listener.y);
    if (d > HEARING_RANGE) return;
    gain = Math.pow(1 - d / HEARING_RANGE, 1.4);
    pan = Math.max(-1, Math.min(1, dx / PAN_RANGE));
  }
  for (const layer of CUES[name]) play(layer.p, pan, gain, layer.at ?? 0);
}
