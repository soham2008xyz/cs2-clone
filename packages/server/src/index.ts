import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer, type ServerResponse } from 'node:http';
import { extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer, type WebSocket } from 'ws';
import { listMaps, parseClientMsg, type ClientMsg } from '@cs2d/shared';
import { ConnectionLimiter } from './connectionLimits.js';
import { KeyedRateLimiter } from './rateLimit.js';
import { DEFAULT_MAX_ROOMS, RoomCapError, RoomManager } from './roomManager.js';
import { clientIp, parseRequestUrl, rawDataToString, resolveStaticFile, validDifficulty } from './serverUtils.js';

function envInt(name: string, fallback: number): number {
  const n = Number.parseInt(process.env[name] ?? '', 10);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

const PORT = Number(process.env.PORT ?? 8090);
// CS2D_FAST=1 shrinks round timings for integration tests
const FAST_TIMINGS = process.env.CS2D_FAST === '1' ? { freeze: 1, round: 20, bomb: 4, plant: 0.5, defuse: 1, defuseKit: 0.5, roundEnd: 1 } : {};
const REAP_INTERVAL_MS = 30000;
const MAX_WS_BYTES = 16 * 1024; // largest valid client message is ~1 KB of chat; ws closes the socket on anything bigger
const MAX_BODY_BYTES = 16 * 1024; // POST /rooms bodies are tiny; reject anything larger

const MAX_ROOMS = envInt('CS2D_MAX_ROOMS', DEFAULT_MAX_ROOMS);
const CREATE_BURST = envInt('CS2D_CREATE_BURST', 10); // rooms one IP can create back to back
const CREATE_PER_MIN = envInt('CS2D_CREATE_PER_MIN', 6); // sustained rooms per minute per IP
// Render terminates TLS at its proxy, which appends the peer address to x-forwarded-for. Elsewhere the header is forgeable, so ignore it.
const TRUSTED_PROXY_HOPS = envInt('CS2D_TRUSTED_PROXY_HOPS', process.env.RENDER ? 1 : 0);

const manager = new RoomManager(MAX_ROOMS);
const createLimiter = new KeyedRateLimiter(CREATE_BURST, CREATE_PER_MIN / 60);
setInterval(() => {
  manager.reap();
  createLimiter.prune();
}, REAP_INTERVAL_MS);

function readJsonBody(req: import('node:http').IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let bytes = 0;
    let settled = false;
    req.on('data', (chunk: Buffer) => {
      if (settled) return;
      bytes += chunk.length; // Buffer.length is bytes; body.length on a decoded string would be UTF-16 units
      if (bytes > MAX_BODY_BYTES) {
        settled = true;
        reject(new Error('body too large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (settled) return;
      settled = true;
      try {
        const body = Buffer.concat(chunks).toString('utf8');
        resolve(body ? JSON.parse(body) : {});
      } catch (e) {
        reject(e);
      }
    });
    req.on('error', (e) => {
      if (settled) return;
      settled = true;
      reject(e);
    });
  });
}

const cors = { 'access-control-allow-origin': '*', 'access-control-allow-methods': 'GET,POST,OPTIONS', 'access-control-allow-headers': 'content-type' };

// Built client (vite output) served for any non-API GET — one process runs the whole game.
const CLIENT_DIST = resolve(fileURLToPath(new URL('.', import.meta.url)), '../../client/dist');
const MIME: Record<string, string> = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.json': 'application/json',
  '.map': 'application/json',
  '.ico': 'image/x-icon',
};

function serveClient(pathname: string, res: ServerResponse): void {
  if (!existsSync(CLIENT_DIST)) {
    res.writeHead(200, { 'content-type': 'application/json', ...cors });
    res.end(JSON.stringify({ ok: true, maps: listMaps(), note: 'client not built — run: npm run build' }));
    return;
  }
  const candidate = resolveStaticFile(CLIENT_DIST, pathname); // null if it escapes CLIENT_DIST
  const isFile = candidate !== null && statSync(candidate, { throwIfNoEntry: false })?.isFile() === true;
  const file = isFile ? candidate : join(CLIENT_DIST, 'index.html'); // SPA fallback
  res.writeHead(200, { 'content-type': MIME[extname(file)] ?? 'application/octet-stream' });
  createReadStream(file).pipe(res);
}

const http = createServer(async (req, res) => {
  const url = parseRequestUrl(req.url);

  if (req.method === 'OPTIONS') {
    res.writeHead(204, cors);
    res.end();
    return;
  }

  if (url.pathname === '/rooms' && req.method === 'GET') {
    res.writeHead(200, { 'content-type': 'application/json', ...cors });
    res.end(JSON.stringify({ maps: listMaps(), rooms: manager.list() }));
    return;
  }

  if (url.pathname === '/rooms' && req.method === 'POST') {
    const ip = clientIp(req, TRUSTED_PROXY_HOPS);
    if (!createLimiter.take(ip)) {
      res.writeHead(429, { 'content-type': 'application/json', 'retry-after': String(createLimiter.retryAfterSec(ip)), ...cors });
      res.end(JSON.stringify({ error: 'too many requests' }));
      return;
    }
    try {
      const body = (await readJsonBody(req)) as { map?: string; backfillBots?: boolean; botDifficulty?: string };
      const map = listMaps().includes(body.map ?? '') ? (body.map as string) : 'dust2';
      const botDifficulty = validDifficulty(body.botDifficulty);
      const meta = manager.create(map, Boolean(body.backfillBots), FAST_TIMINGS, botDifficulty);
      res.writeHead(200, { 'content-type': 'application/json', ...cors });
      res.end(JSON.stringify({ code: meta.code, map: meta.map }));
    } catch (err) {
      if (err instanceof RoomCapError) {
        res.writeHead(503, { 'content-type': 'application/json', 'retry-after': '30', ...cors });
        res.end(JSON.stringify({ error: 'server full' }));
        return;
      }
      res.writeHead(400, { 'content-type': 'application/json', ...cors });
      res.end(JSON.stringify({ error: 'bad request' }));
    }
    return;
  }

  serveClient(url.pathname, res);
});

const wss = new WebSocketServer({ server: http, maxPayload: MAX_WS_BYTES });

wss.on('connection', (ws: WebSocket, req) => {
  // Register first: a protocol error (bad frame, oversized payload) must close this socket, not crash the process.
  ws.on('error', (err) => {
    console.warn(`[ws] socket error: ${err.message}`);
    ws.terminate();
  });

  const code = parseRequestUrl(req.url).searchParams.get('room') ?? '';
  const entry = manager.get(code);
  if (!entry) {
    ws.close(4004, 'room not found');
    return;
  }
  const { room, meta } = entry;
  let playerId: number | null = null;
  let playerTeam: import('@cs2d/shared').TeamId | null = null;

  const dispatch = (msg: ClientMsg): void => {
    if (msg.t === 'join' && playerId === null) {
      if (room.isFull) {
        ws.close(4003, 'room full');
        return;
      }
      const p = room.addPlayer(ws, msg.name, msg.team);
      playerId = p.id;
      playerTeam = p.team;
      console.log(`[room ${meta.code}] ${p.name} joined as ${p.team} (#${p.id}), ${room.players.size} online`);
    } else if (playerId === null) {
      return; // must join before anything else
    } else if (msg.t === 'i') {
      room.handleInput(playerId, msg);
    } else if (msg.t === 'buy') {
      room.handleBuy(playerId, msg.item);
    } else if (msg.t === 'bots') {
      if (room.phase === 'waiting') {
        room.fillBots(Math.min(5, Math.max(1, msg.perTeam ?? 5)), validDifficulty(msg.difficulty));
      }
    } else if (msg.t === 'team') {
      room.setTeam(playerId, msg.team);
      playerTeam = room.players.get(playerId)?.team ?? playerTeam; // setTeam may reject (wrong phase/team) — trust the room, not the wire
    } else if (msg.t === 'chat') {
      const name = room.players.get(playerId)?.name ?? 'Player';
      room.broadcastChat(name, playerTeam, msg.text);
    } else if (msg.t === 'ping') {
      ws.send(JSON.stringify({ t: 'pong', t0: msg.t0 }));
    }
  };

  const limiter = new ConnectionLimiter(Date.now());

  ws.on('message', (raw) => {
    const msg = parseClientMsg(rawDataToString(raw));
    if (!msg) return; // drop malformed messages
    const verdict = limiter.check(msg, Date.now());
    if (verdict === 'kick') {
      ws.close(1008, 'rate limit exceeded');
      return;
    }
    if (verdict === 'drop') return;
    try {
      dispatch(msg);
    } catch (err) {
      console.error(`[room ${meta.code}] message handler failed:`, err);
    }
  });

  ws.on('close', () => {
    if (playerId !== null) {
      const departedTeam = room.removePlayer(playerId);
      console.log(`[room ${meta.code}] #${playerId} left, ${room.players.size} online`);
      if (meta.backfillBots && departedTeam && room.phase !== 'waiting') {
        if (!room.isFull) room.addBot(departedTeam, meta.botDifficulty);
      }
    }
  });
});

http.listen(PORT, () => {
  console.log(`[server] http/ws listening on :${PORT}`);
});
