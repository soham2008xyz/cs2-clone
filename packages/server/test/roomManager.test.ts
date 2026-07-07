import { afterEach, describe, expect, it, vi } from 'vitest';
import type { WebSocket } from 'ws';
import { RoomManager } from '../src/roomManager.js';

describe('RoomManager', () => {
  const manager = new RoomManager();
  const createdCodes: string[] = [];

  // create() starts a real setInterval on the underlying Room; stop every
  // room we made so no leftover timers keep firing across the vitest process
  function create(map = 'testarena') {
    const meta = manager.create(map, false);
    createdCodes.push(meta.code);
    return meta;
  }

  afterEach(() => {
    for (const code of createdCodes) manager.get(code)?.room.stop();
    createdCodes.length = 0;
    vi.restoreAllMocks();
  });

  it('generates unique join codes', () => {
    const codes = new Set<string>();
    for (let i = 0; i < 50; i++) codes.add(create().code);
    expect(codes.size).toBe(50);
  });

  it('get() looks up rooms case-insensitively', () => {
    const meta = create();
    expect(manager.get(meta.code.toLowerCase())?.meta.code).toBe(meta.code);
    expect(manager.get(meta.code.toUpperCase())?.meta.code).toBe(meta.code);
  });

  it('list() excludes rooms with no players', () => {
    const meta = create();
    expect(manager.list().some((r) => r.code === meta.code)).toBe(false);

    const { room } = manager.get(meta.code)!;
    room.addPlayer(null, 'A', 'T');
    expect(manager.list().some((r) => r.code === meta.code)).toBe(true);
  });

  it('reap() leaves a fresh human-less room alone within the grace window', () => {
    const meta = create();
    manager.reap(); // real Date.now(): still inside REAP_GRACE_MS (60s)
    expect(manager.get(meta.code)).toBeDefined();
  });

  it('reap() drops a human-less room once REAP_GRACE_MS has elapsed', () => {
    const meta = create();
    manager.reap(); // real Date.now(), asserted before installing any spy
    expect(manager.get(meta.code)).toBeDefined();

    const realNow = Date.now();
    vi.spyOn(Date, 'now').mockReturnValue(realNow + 61_000); // past the 60s grace window
    manager.reap();
    expect(manager.get(meta.code)).toBeUndefined();
  });

  it('never drops a room with a connected human, regardless of age', () => {
    const meta = create();
    const { room } = manager.get(meta.code)!;
    const humanWs = { send: () => {} } as unknown as WebSocket;
    room.addPlayer(humanWs, 'Human', 'T');

    const realNow = Date.now();
    vi.spyOn(Date, 'now').mockReturnValue(realNow + 61_000);
    manager.reap();
    expect(manager.get(meta.code)).toBeDefined();
  });
});
