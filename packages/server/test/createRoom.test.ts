import { afterEach, describe, expect, it } from 'vitest';
import { createRoomResponse } from '../src/createRoom.js';
import { KeyedRateLimiter } from '../src/rateLimit.js';
import { RoomManager } from '../src/roomManager.js';

describe('createRoomResponse', () => {
  const managers: RoomManager[] = [];
  const setup = (maxRooms: number, burst: number) => {
    const manager = new RoomManager(maxRooms);
    managers.push(manager);
    const limiter = new KeyedRateLimiter(burst, 0.001);
    const call = (ip: string, body: unknown = {}) => createRoomResponse({ ip, manager, limiter, timings: {}, readBody: async () => body });
    return { manager, call };
  };
  afterEach(() => {
    for (const m of managers) for (const code of m.codes()) m.get(code)?.room.stop();
    managers.length = 0;
  });

  it('creates a room and falls back to dust2 for an unknown map', async () => {
    const { call } = setup(5, 5);
    const ok = await call('1.1.1.1', { map: 'testarena' });
    expect(ok).toMatchObject({ status: 200, body: { map: 'testarena' } });
    expect(await call('1.1.1.1', { map: 'nope' })).toMatchObject({ status: 200, body: { map: 'dust2' } });
  });

  it('returns 429 with Retry-After once an IP is over its create budget, without affecting other IPs', async () => {
    const { call } = setup(50, 2);
    await call('1.1.1.1');
    await call('1.1.1.1');
    const limited = await call('1.1.1.1');
    expect(limited.status).toBe(429);
    expect(Number(limited.headers['retry-after'])).toBeGreaterThanOrEqual(1);
    expect((await call('2.2.2.2')).status).toBe(200);
  });

  it('returns 503 with Retry-After at the room cap', async () => {
    const { call, manager } = setup(1, 10);
    expect((await call('1.1.1.1')).status).toBe(200);
    const full = await call('2.2.2.2');
    expect(full).toMatchObject({ status: 503, headers: { 'retry-after': '30' } });
    expect(manager.size).toBe(1);
  });

  it('returns 400 when the body cannot be read', async () => {
    const manager = new RoomManager(5);
    const res = await createRoomResponse({
      ip: 'x',
      manager,
      limiter: new KeyedRateLimiter(5, 1),
      timings: {},
      readBody: async () => {
        throw new Error('bad json');
      },
    });
    expect(res.status).toBe(400);
    expect(manager.size).toBe(0);
  });
});
