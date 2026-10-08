/** Token bucket: `capacity` is the burst size, `refillPerSec` the sustained rate. Time is passed in so tests stay deterministic. */
export class TokenBucket {
  private tokens: number;
  private last: number;

  constructor(
    readonly capacity: number,
    readonly refillPerSec: number,
    now: number,
  ) {
    this.tokens = capacity;
    this.last = now;
  }

  private refill(now: number): void {
    if (now <= this.last) return; // clock stepped back: keep the later stamp so a correction cannot refill tokens
    this.tokens = Math.min(this.capacity, this.tokens + ((now - this.last) / 1000) * this.refillPerSec);
    this.last = now;
  }

  /** Takes one token if available. */
  take(now: number): boolean {
    this.refill(now);
    if (this.tokens < 1) return false;
    this.tokens -= 1;
    return true;
  }

  /** Whole milliseconds until one token is available (0 if one is now). */
  msUntilToken(now: number): number {
    this.refill(now);
    return this.tokens >= 1 ? 0 : Math.ceil(((1 - this.tokens) / this.refillPerSec) * 1000);
  }

  /** True once the bucket is back at full capacity (safe to forget). */
  isFull(now: number): boolean {
    this.refill(now);
    return this.tokens >= this.capacity;
  }
}

/** One token bucket per key (e.g. client IP). Idle full buckets are pruned so the map cannot grow without bound. */
export class KeyedRateLimiter {
  private readonly buckets = new Map<string, TokenBucket>();

  constructor(
    private readonly capacity: number,
    private readonly refillPerSec: number,
  ) {}

  take(key: string, now = Date.now()): boolean {
    let bucket = this.buckets.get(key);
    if (!bucket) {
      bucket = new TokenBucket(this.capacity, this.refillPerSec, now);
      this.buckets.set(key, bucket);
    }
    return bucket.take(now);
  }

  /** Seconds a caller denied for `key` should wait before retrying (at least 1). */
  retryAfterSec(key: string, now = Date.now()): number {
    const ms = this.buckets.get(key)?.msUntilToken(now) ?? 0;
    return Math.max(1, Math.ceil(ms / 1000));
  }

  prune(now = Date.now()): void {
    for (const [key, bucket] of this.buckets) if (bucket.isFull(now)) this.buckets.delete(key);
  }

  get size(): number {
    return this.buckets.size;
  }
}
