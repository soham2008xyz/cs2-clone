import { listMaps } from '@cs2d/shared';
import type { KeyedRateLimiter } from './rateLimit.js';
import { RoomCapError, type RoomManager } from './roomManager.js';
import type { RoomTimings } from './room.js';
import { validDifficulty } from './serverUtils.js';

export interface CreateRoomResult {
  status: number;
  headers: Record<string, string>;
  body: unknown;
}

export interface CreateRoomDeps {
  ip: string;
  manager: RoomManager;
  limiter: KeyedRateLimiter;
  timings: Partial<RoomTimings>;
  readBody: () => Promise<unknown>;
}

const SERVER_FULL_RETRY_SEC = 30;

/**
 * POST /rooms: per-IP rate limit first (before reading the body), then the
 * global room cap. 429 and 503 carry Retry-After; a bad body is a 400.
 */
export async function createRoomResponse({ ip, manager, limiter, timings, readBody }: CreateRoomDeps): Promise<CreateRoomResult> {
  if (!limiter.take(ip)) {
    return { status: 429, headers: { 'retry-after': String(limiter.retryAfterSec(ip)) }, body: { error: 'too many requests' } };
  }
  try {
    const body = (await readBody()) as { map?: string; backfillBots?: boolean; botDifficulty?: string };
    const map = listMaps().includes(body.map ?? '') ? (body.map as string) : 'dust2';
    const meta = manager.create(map, Boolean(body.backfillBots), timings, validDifficulty(body.botDifficulty));
    return { status: 200, headers: {}, body: { code: meta.code, map: meta.map } };
  } catch (err) {
    if (err instanceof RoomCapError) {
      return { status: 503, headers: { 'retry-after': String(SERVER_FULL_RETRY_SEC) }, body: { error: 'server full' } };
    }
    return { status: 400, headers: {}, body: { error: 'bad request' } };
  }
}
