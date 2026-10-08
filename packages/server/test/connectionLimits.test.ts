import { describe, expect, it } from 'vitest';
import type { ClientMsg } from '@cs2d/shared';
import { ConnectionLimiter, MESSAGE_LIMITS } from '../src/connectionLimits.js';

const input = (s: number): ClientMsg => ({ t: 'i', s, b: 0, a: 0, k: 0 });
const chat: ClientMsg = { t: 'chat', text: 'hi' };
const ping: ClientMsg = { t: 'ping', t0: 0 };

describe('ConnectionLimiter', () => {
  it('never throttles a client sending inputs at 60 Hz', () => {
    const l = new ConnectionLimiter(0);
    for (let i = 0; i < 60 * 30; i++) expect(l.check(input(i), (i * 1000) / 60)).toBe('ok');
  });

  it('absorbs the burst a stalled tab flushes after a 250 ms hitch', () => {
    const l = new ConnectionLimiter(0);
    for (let t = 0; t < 1000; t += 1000 / 60) l.check(input(0), t); // steady state
    const verdicts = Array.from({ length: 16 }, (_, i) => l.check(input(i), 1250));
    expect(verdicts.every((v) => v === 'ok')).toBe(true);
  });

  it('drops inputs sent far above the steady rate', () => {
    const l = new ConnectionLimiter(0);
    const verdicts = Array.from({ length: 500 }, (_, i) => l.check(input(i), 0));
    expect(verdicts.filter((v) => v === 'ok')).toHaveLength(MESSAGE_LIMITS.input.burst);
    expect(verdicts[MESSAGE_LIMITS.input.burst]).toBe('drop');
  });

  it('limits chat to a few messages per second without touching inputs', () => {
    const l = new ConnectionLimiter(0);
    const ok = Array.from({ length: 20 }, () => l.check(chat, 0)).filter((v) => v === 'ok');
    expect(ok).toHaveLength(MESSAGE_LIMITS.chat.burst);
    expect(l.check(chat, 1000)).toBe('ok'); // ~3/s refill
    expect(l.check(input(1), 1000)).toBe('ok');
  });

  it('limits other message types separately from chat', () => {
    const l = new ConnectionLimiter(0);
    for (let i = 0; i < MESSAGE_LIMITS.other.burst; i++) expect(l.check(ping, 0)).toBe('ok');
    expect(l.check(ping, 0)).toBe('drop');
    expect(l.check(chat, 0)).toBe('ok');
  });

  it('charges unparseable frames to the other-message budget and kicks a garbage flood', () => {
    const l = new ConnectionLimiter(0, 50);
    const verdicts = Array.from({ length: 200 }, () => l.check(null, 0));
    expect(verdicts.filter((v) => v === 'ok')).toHaveLength(MESSAGE_LIMITS.other.burst);
    expect(verdicts).toContain('kick');
    expect(l.check(input(1), 0)).toBe('ok'); // inputs keep their own budget
  });

  it('kicks a connection that keeps flooding, but not one that briefly overshoots', () => {
    const brief = new ConnectionLimiter(0, 50);
    for (let i = 0; i < 60 + 10; i++) brief.check(input(i), 0);
    expect(brief.check(input(99), 0)).toBe('drop');

    const flood = new ConnectionLimiter(0, 50);
    const verdicts = Array.from({ length: 200 }, (_, i) => flood.check(input(i), 0));
    expect(verdicts).toContain('kick');
  });

  it('forgets old drops after the window passes', () => {
    const l = new ConnectionLimiter(0, 50);
    for (let i = 0; i < 60 + 40; i++) l.check(input(i), 0); // 40 drops
    for (let i = 0; i < 60 + 40; i++) expect(l.check(input(i), 20000)).not.toBe('kick');
  });
});
