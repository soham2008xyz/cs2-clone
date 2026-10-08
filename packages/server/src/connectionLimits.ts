import type { ClientMsg } from '@cs2d/shared';
import { TokenBucket } from './rateLimit.js';

type MsgClass = 'input' | 'chat' | 'other';

interface Limit {
  burst: number;
  perSec: number;
}

/**
 * Per-connection budgets. The client sends one input per 60 Hz tick and can
 * flush ~15 queued ticks at once after a stall, so inputs get 2x the steady
 * rate and a burst of 60. Chat is a few messages a second; everything else
 * (buy, team, bots, ping, join) is rare.
 */
export const MESSAGE_LIMITS: Record<MsgClass, Limit> = {
  input: { burst: 60, perSec: 120 },
  chat: { burst: 5, perSec: 3 },
  other: { burst: 20, perSec: 10 },
};

/** A connection that racks up this many over-budget messages within one window is flooding and gets closed. */
const KICK_AFTER_DROPS = 600;
const DROP_WINDOW_MS = 10000;

export type LimitVerdict = 'ok' | 'drop' | 'kick';

function classOf(msg: ClientMsg): MsgClass {
  if (msg.t === 'i') return 'input';
  if (msg.t === 'chat') return 'chat';
  return 'other';
}

/** Rate limiter for one websocket connection. Pure: callers pass the clock. */
export class ConnectionLimiter {
  private readonly buckets: Record<MsgClass, TokenBucket>;
  private drops = 0;
  private windowStart: number;

  constructor(
    now: number,
    private readonly kickAfterDrops = KICK_AFTER_DROPS,
    limits: Record<MsgClass, Limit> = MESSAGE_LIMITS,
  ) {
    this.windowStart = now;
    this.buckets = {
      input: new TokenBucket(limits.input.burst, limits.input.perSec, now),
      chat: new TokenBucket(limits.chat.burst, limits.chat.perSec, now),
      other: new TokenBucket(limits.other.burst, limits.other.perSec, now),
    };
  }

  /** 'drop' discards the message; 'kick' means the peer is flooding and should be disconnected. */
  check(msg: ClientMsg | null, now: number): LimitVerdict {
    // frames that fail to parse cost decode + parse time, so they draw from the 'other' budget
    const cls = msg ? classOf(msg) : 'other';
    if (this.buckets[cls].take(now)) return 'ok';
    if (now - this.windowStart > DROP_WINDOW_MS) {
      this.windowStart = now;
      this.drops = 0;
    }
    this.drops += 1;
    return this.drops >= this.kickAfterDrops ? 'kick' : 'drop';
  }
}
