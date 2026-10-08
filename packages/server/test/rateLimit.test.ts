import { describe, expect, it } from 'vitest';
import { KeyedRateLimiter, TokenBucket } from '../src/rateLimit.js';

describe('TokenBucket', () => {
  it('allows a burst up to capacity, then refuses', () => {
    const b = new TokenBucket(3, 1, 0);
    expect([b.take(0), b.take(0), b.take(0), b.take(0)]).toEqual([true, true, true, false]);
  });

  it('refills at the sustained rate and never past capacity', () => {
    const b = new TokenBucket(2, 2, 0); // 2 tokens/s
    b.take(0);
    b.take(0);
    expect(b.take(0)).toBe(false);
    expect(b.take(500)).toBe(true); // +1 token
    expect(b.take(500)).toBe(false);
    expect(b.isFull(60000)).toBe(true);
    expect([b.take(60000), b.take(60000), b.take(60000)]).toEqual([true, true, false]);
  });

  it('ignores a clock that goes backwards', () => {
    const b = new TokenBucket(1, 1, 1000);
    expect(b.take(1000)).toBe(true);
    expect(b.take(0)).toBe(false);
  });

  it('does not refill extra when the clock steps back and then corrects', () => {
    const b = new TokenBucket(1, 1, 10000);
    expect(b.take(10000)).toBe(true);
    expect(b.take(0)).toBe(false); // clock jumped back
    expect(b.take(10000)).toBe(false); // corrected: no real time has passed
    expect(b.take(11000)).toBe(true);
  });

  it('reports the wait until the next token', () => {
    const b = new TokenBucket(1, 2, 0);
    b.take(0);
    expect(b.msUntilToken(0)).toBe(500);
    expect(b.msUntilToken(500)).toBe(0);
  });
});

describe('KeyedRateLimiter', () => {
  it('limits each key on its own', () => {
    const l = new KeyedRateLimiter(2, 0.1);
    expect([l.take('a', 0), l.take('a', 0), l.take('a', 0)]).toEqual([true, true, false]);
    expect(l.take('b', 0)).toBe(true);
  });

  it('gives a retry delay of at least one second', () => {
    const l = new KeyedRateLimiter(1, 1 / 10); // 1 token per 10 s
    l.take('a', 0);
    expect(l.take('a', 0)).toBe(false);
    expect(l.retryAfterSec('a', 0)).toBe(10);
    expect(l.retryAfterSec('a', 9900)).toBe(1);
    expect(l.retryAfterSec('unknown', 0)).toBe(1);
  });

  it('prunes keys whose bucket has refilled', () => {
    const l = new KeyedRateLimiter(2, 1);
    l.take('a', 0);
    l.take('b', 0);
    l.prune(100);
    expect(l.size).toBe(2);
    l.prune(5000);
    expect(l.size).toBe(0);
  });
});
