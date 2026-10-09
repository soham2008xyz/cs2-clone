import { afterEach, describe, expect, it, vi } from 'vitest';
import { CreateRoomError, createRoom, listRooms } from '../src/net/api.js';

afterEach(() => {
  vi.unstubAllGlobals();
});

function stub(status: number, body: unknown = {}): void {
  vi.stubGlobal('location', { port: '', hostname: 'h', protocol: 'http:', host: 'h', origin: 'http://h' });
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: status >= 200 && status < 300, status, json: async () => body })));
}

describe('createRoom', () => {
  it('returns the room code on success', async () => {
    stub(200, { code: 'ABCD', map: 'dust2' });
    await expect(createRoom('dust2', false)).resolves.toEqual({ code: 'ABCD', map: 'dust2' });
  });

  it.each([429, 503])('throws a CreateRoomError carrying status %i', async (status) => {
    stub(status);
    const err = await createRoom('dust2', false).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(CreateRoomError);
    expect((err as CreateRoomError).status).toBe(status);
  });
});

describe('listRooms', () => {
  it('returns the maps and rooms from the server', async () => {
    stub(200, { maps: ['dust2'], rooms: [] });
    await expect(listRooms()).resolves.toEqual({ maps: ['dust2'], rooms: [] });
    expect(fetch).toHaveBeenCalledWith('http://h/rooms');
  });

  it('throws with the status on a non-2xx response', async () => {
    stub(500);
    await expect(listRooms()).rejects.toThrow('list rooms failed: 500');
  });
});
