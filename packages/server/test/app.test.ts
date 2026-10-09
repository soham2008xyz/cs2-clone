import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WebSocket } from 'ws';
import { MAX_PLAYERS_PER_ROOM, type ServerMsg } from '@cs2d/shared';
import { startServer, type ServerHandle } from '../src/app.js';

let server: ServerHandle;
let clientDist: string;
const sockets: WebSocket[] = [];

beforeEach(async () => {
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  clientDist = mkdtempSync(join(tmpdir(), 'cs2d-dist-'));
  server = await startServer({ port: 0, env: { CS2D_FAST: '1' }, clientDist });
});

afterEach(async () => {
  for (const s of sockets) s.terminate();
  sockets.length = 0;
  await server.close();
  rmSync(clientDist, { recursive: true, force: true });
  vi.restoreAllMocks();
});

const base = () => `http://127.0.0.1:${server.port}`;

async function createRoom(body: unknown = { map: 'testarena' }): Promise<string> {
  const res = await fetch(`${base()}/rooms`, { method: 'POST', body: JSON.stringify(body) });
  return ((await res.json()) as { code: string }).code;
}

/** A client that records every JSON message and the close event. */
function connect(code: string) {
  const ws = new WebSocket(`ws://127.0.0.1:${server.port}/?room=${code}`);
  sockets.push(ws);
  const msgs: ServerMsg[] = [];
  const closed = new Promise<{ code: number; reason: string }>((resolve) => ws.on('close', (c, r) => resolve({ code: c, reason: r.toString() })));
  ws.on('message', (d) => msgs.push(JSON.parse(d.toString()) as ServerMsg));
  const opened = new Promise<void>((resolve) => ws.on('open', () => resolve()));
  const send = (m: unknown) => ws.send(typeof m === 'string' ? m : JSON.stringify(m));
  const next = (t: ServerMsg['t']) => vi.waitFor(() => expect(msgs.some((m) => m.t === t)).toBe(true));
  return { ws, msgs, closed, opened, send, next };
}

describe('HTTP', () => {
  it('answers CORS preflight with 204', async () => {
    const res = await fetch(`${base()}/rooms`, { method: 'OPTIONS' });
    expect(res.status).toBe(204);
    expect(res.headers.get('access-control-allow-origin')).toBe('*');
  });

  it('lists maps and joinable rooms on GET /rooms', async () => {
    const res = await fetch(`${base()}/rooms`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { maps: unknown[]; rooms: unknown[] };
    expect(body.maps.length).toBeGreaterThan(0);
    expect(body.rooms).toEqual([]);
  });

  it('creates a room on POST /rooms, using short timings under CS2D_FAST', async () => {
    const res = await fetch(`${base()}/rooms`, { method: 'POST', body: JSON.stringify({ map: 'testarena' }) });
    expect(res.status).toBe(200);
    const { code, map } = (await res.json()) as { code: string; map: string };
    expect(map).toBe('testarena');
    expect(server.manager.get(code)).toBeDefined();
  });

  it('accepts an empty POST body (defaults apply)', async () => {
    const res = await fetch(`${base()}/rooms`, { method: 'POST' });
    expect(res.status).toBe(200);
  });

  it('rejects malformed JSON and oversized bodies with 400', async () => {
    const bad = await fetch(`${base()}/rooms`, { method: 'POST', body: '{nope' });
    expect(bad.status).toBe(400);
    const big = await fetch(`${base()}/rooms`, { method: 'POST', body: JSON.stringify({ pad: 'x'.repeat(20 * 1024) }) }).catch(() => null);
    // the server destroys the request once it exceeds the cap, so the client may see a reset instead of a response
    if (big) expect(big.status).toBe(400);
  });

  it('rate-limits room creation per IP', async () => {
    const limited = await startServer({ port: 0, env: { CS2D_CREATE_BURST: '1', CS2D_CREATE_PER_MIN: '1' }, clientDist });
    try {
      const url = `http://127.0.0.1:${limited.port}/rooms`;
      expect((await fetch(url, { method: 'POST' })).status).toBe(200);
      expect((await fetch(url, { method: 'POST' })).status).toBe(429);
    } finally {
      await limited.close();
    }
  });

  it('answers 503 once the room cap is reached', async () => {
    const capped = await startServer({ port: 0, env: { CS2D_MAX_ROOMS: '1' }, clientDist });
    try {
      const url = `http://127.0.0.1:${capped.port}/rooms`;
      expect((await fetch(url, { method: 'POST' })).status).toBe(200);
      expect((await fetch(url, { method: 'POST' })).status).toBe(503);
    } finally {
      await capped.close();
    }
  });
});

describe('static client', () => {
  it('reports "client not built" when the dist directory is missing', async () => {
    const missing = await startServer({ port: 0, env: {}, clientDist: join(clientDist, 'nope') });
    try {
      const res = await fetch(`http://127.0.0.1:${missing.port}/`);
      expect(((await res.json()) as { note: string }).note).toMatch(/client not built/);
    } finally {
      await missing.close();
    }
  });

  it('serves files with their MIME type and falls back to index.html for unknown paths', async () => {
    writeFileSync(join(clientDist, 'index.html'), '<h1>home</h1>');
    mkdirSync(join(clientDist, 'assets'));
    writeFileSync(join(clientDist, 'assets', 'app.js'), 'console.log(1)');
    writeFileSync(join(clientDist, 'blob.xyz'), 'data');

    const js = await fetch(`${base()}/assets/app.js`);
    expect(js.headers.get('content-type')).toBe('text/javascript');
    expect(await js.text()).toBe('console.log(1)');

    expect((await fetch(`${base()}/blob.xyz`)).headers.get('content-type')).toBe('application/octet-stream');
    expect(await (await fetch(`${base()}/`)).text()).toBe('<h1>home</h1>');
    expect(await (await fetch(`${base()}/some/spa/route`)).text()).toBe('<h1>home</h1>');
    expect(await (await fetch(`${base()}/assets`)).text()).toBe('<h1>home</h1>'); // a directory is not a file
  });

  it('answers a ../ request line with the SPA index rather than a file outside dist', async () => {
    writeFileSync(join(clientDist, 'index.html'), '<h1>home</h1>');
    writeFileSync(join(clientDist, '..', 'cs2d-secret.txt'), 'secret');
    try {
      // fetch normalises ../, so send the traversal as a raw request line
      const net = await import('node:net');
      const body = await new Promise<string>((resolve) => {
        const sock = net.connect(server.port, '127.0.0.1', () => sock.write('GET /../cs2d-secret.txt HTTP/1.0\r\n\r\n'));
        let data = '';
        sock.on('data', (d) => (data += d.toString()));
        sock.on('close', () => resolve(data));
      });
      expect(body).not.toContain('secret');
      expect(body).toContain('<h1>home</h1>');
    } finally {
      rmSync(join(clientDist, '..', 'cs2d-secret.txt'), { force: true });
    }
  });
});

describe('WebSocket', () => {
  it('closes 4004 for an unknown room', async () => {
    const c = connect('ZZZZ');
    expect((await c.closed).code).toBe(4004);
  });

  it('closes 4003 when the room is full', async () => {
    const code = await createRoom();
    const { room } = server.manager.get(code)!;
    for (let i = 0; i < MAX_PLAYERS_PER_ROOM; i++) room.addPlayer(null, `B${i}`);
    const c = connect(code);
    await c.opened;
    c.send({ t: 'join', name: 'late' });
    expect((await c.closed).code).toBe(4003);
  });

  it('ignores everything but join until the client has joined', async () => {
    const code = await createRoom();
    const c = connect(code);
    await c.opened;
    c.send({ t: 'ping', t0: 1 });
    c.send({ t: 'chat', text: 'hi' });
    c.send({ t: 'join', name: 'Ann' });
    await c.next('welcome');
    expect(c.msgs.some((m) => m.t === 'pong')).toBe(false);
    expect(c.msgs.some((m) => m.t === 'chat')).toBe(false);
  });

  it('handles join, ping, chat, team, buy, input and bots messages', async () => {
    const code = await createRoom();
    const { room } = server.manager.get(code)!;
    const c = connect(code);
    await c.opened;
    c.send({ t: 'join', name: 'Ann', team: 'T' });
    await c.next('welcome');
    expect(room.players.size).toBe(1);
    const id = [...room.players.keys()][0];

    c.send({ t: 'ping', t0: 42 });
    await vi.waitFor(() => expect(c.msgs).toContainEqual({ t: 'pong', t0: 42 }));

    c.send({ t: 'chat', text: 'gl hf' });
    await vi.waitFor(() => expect(c.msgs).toContainEqual(expect.objectContaining({ t: 'chat', from: 'Ann', text: 'gl hf' })));

    c.send({ t: 'team', team: 'CT' });
    await vi.waitFor(() => expect(room.players.get(id)!.team).toBe('CT'));

    const buy = vi.spyOn(room, 'handleBuy');
    c.send({ t: 'buy', item: 'ak47' });
    await vi.waitFor(() => expect(buy).toHaveBeenCalledWith(id, 'ak47'));

    const input = vi.spyOn(room, 'handleInput');
    c.send({ t: 'i', s: 1, b: 0, a: 0 });
    await vi.waitFor(() => expect(input).toHaveBeenCalled());

    c.send({ t: 'bots', perTeam: 2, difficulty: 'bogus' });
    // the wire validator rejects an unknown difficulty, so nothing is added
    c.send({ t: 'bots', perTeam: 2 });
    await vi.waitFor(() => expect(room.players.size).toBe(4)); // 2 per side, Ann counts toward CT
  });

  it('adds bots only while the room is still waiting', async () => {
    const code = await createRoom();
    const { room } = server.manager.get(code)!;
    const c = connect(code);
    await c.opened;
    c.send({ t: 'join', name: 'Ann' });
    await c.next('welcome');
    const fill = vi.spyOn(room, 'fillBots');
    vi.spyOn(room, 'phase', 'get').mockReturnValue('live');
    c.send({ t: 'bots', perTeam: 3 });
    c.send({ t: 'ping', t0: 1 });
    await vi.waitFor(() => expect(c.msgs.some((m) => m.t === 'pong')).toBe(true)); // the bots message was processed before this
    expect(fill).not.toHaveBeenCalled();
  });

  it('clamps the requested bots per team to 1..5', async () => {
    const code = await createRoom();
    const { room } = server.manager.get(code)!;
    const c = connect(code);
    await c.opened;
    c.send({ t: 'join', name: 'Ann' });
    await c.next('welcome');
    const fill = vi.spyOn(room, 'fillBots').mockImplementation(() => {});
    c.send({ t: 'bots', perTeam: 99 });
    c.send({ t: 'bots', perTeam: 0 });
    c.send({ t: 'bots' });
    await vi.waitFor(() => expect(fill).toHaveBeenCalledTimes(3));
    expect(fill.mock.calls.map((a) => a[0])).toEqual([5, 1, 5]);
  });

  it('drops malformed frames without closing the socket', async () => {
    const code = await createRoom();
    const c = connect(code);
    await c.opened;
    c.send('not json');
    c.send({ t: 'nope' });
    c.send({ t: 'join', name: 'Ann' });
    await c.next('welcome');
    expect(c.ws.readyState).toBe(WebSocket.OPEN);
  });

  it('closes 1008 when a client floods past its rate limit', async () => {
    const code = await createRoom();
    const c = connect(code);
    await c.opened;
    c.send({ t: 'join', name: 'Ann' });
    await c.next('welcome');
    for (let i = 0; i < 2000 && c.ws.readyState === WebSocket.OPEN; i++) c.send({ t: 'ping', t0: i });
    expect((await c.closed).code).toBe(1008);
  });

  it('keeps serving when a message handler throws', async () => {
    const code = await createRoom();
    const { room } = server.manager.get(code)!;
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const c = connect(code);
    await c.opened;
    c.send({ t: 'join', name: 'Ann' });
    await c.next('welcome');
    vi.spyOn(room, 'handleBuy').mockImplementation(() => {
      throw new Error('boom');
    });
    c.send({ t: 'buy', item: 'ak47' });
    c.send({ t: 'ping', t0: 7 });
    await vi.waitFor(() => expect(c.msgs).toContainEqual({ t: 'pong', t0: 7 }));
    expect(err).toHaveBeenCalled();
  });

  it('terminates a socket that errors (e.g. oversized payload) instead of crashing', async () => {
    const code = await createRoom();
    const c = connect(code);
    await c.opened;
    c.send({ t: 'join', name: 'Ann' });
    await c.next('welcome');
    c.send({ t: 'chat', text: 'x'.repeat(20 * 1024) });
    await c.closed;
    expect(console.warn).toHaveBeenCalled();
  });

  it('removes the player on disconnect and backfills a bot mid-match when the room asks for it', async () => {
    const code = await createRoom({ map: 'testarena', backfillBots: true });
    const { room } = server.manager.get(code)!;
    const c = connect(code);
    await c.opened;
    c.send({ t: 'join', name: 'Ann', team: 'T' });
    await c.next('welcome');
    vi.spyOn(room, 'phase', 'get').mockReturnValue('live');
    c.ws.close();
    await c.closed;
    await vi.waitFor(() => expect([...room.players.values()].filter((p) => p.ws === null && p.name.startsWith('Bot_')).length).toBe(1));
  });

  it('does not backfill when the room is still waiting', async () => {
    const code = await createRoom({ map: 'testarena', backfillBots: true });
    const { room } = server.manager.get(code)!;
    const c = connect(code);
    await c.opened;
    c.send({ t: 'join', name: 'Ann' });
    await c.next('welcome');
    c.ws.close();
    await c.closed;
    await vi.waitFor(() => expect(room.players.size).toBe(0));
  });
});

describe('startServer', () => {
  it('rejects when the port is already taken', async () => {
    await expect(startServer({ port: server.port, env: {}, clientDist })).rejects.toThrow(/EADDRINUSE/);
  });

  it('reads the port from env when none is passed', async () => {
    const s = await startServer({ env: { PORT: '0' }, clientDist });
    try {
      expect(s.port).toBeGreaterThan(0);
    } finally {
      await s.close();
    }
  });
});
