import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer, type WebSocket } from 'ws';
import { listMaps, parseClientMsg, type ClientMsg, type TeamId } from '@cs2d/shared';
import { createRoomResponse } from './createRoom.js';
import { ConnectionLimiter } from './connectionLimits.js';
import { KeyedRateLimiter } from './rateLimit.js';
import { loadLimitsConfig } from './limitsConfig.js';
import { RoomManager } from './roomManager.js';
import { clientIp, parseRequestUrl, rawDataToString, resolveStaticFile, validDifficulty } from './serverUtils.js';

const REAP_INTERVAL_MS = 30000;
const MAX_WS_BYTES = 16 * 1024; // largest valid client message is ~1 KB of chat; ws closes the socket on anything bigger
const MAX_BODY_BYTES = 16 * 1024; // POST /rooms bodies are tiny; reject anything larger

// Built client (vite output) served for any non-API GET — one process runs the whole game.
const DEFAULT_CLIENT_DIST = resolve(fileURLToPath(new URL('.', import.meta.url)), '../../client/dist');

const cors = { 'access-control-allow-origin': '*', 'access-control-allow-methods': 'GET,POST,OPTIONS', 'access-control-allow-headers': 'content-type' };

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

export interface ServerOptions {
  /** Listen port; 0 picks a free one (see `ServerHandle.port`). */
  port?: number;
  /** Environment the config is read from (CS2D_FAST, CS2D_* limits, RENDER). */
  env?: Record<string, string | undefined>;
  /** Directory holding the built client; defaults to packages/client/dist. */
  clientDist?: string;
}

export interface ServerHandle {
  http: Server;
  wss: WebSocketServer;
  manager: RoomManager;
  port: number;
  close(): Promise<void>;
}

function readJsonBody(req: IncomingMessage): Promise<unknown> {
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

function serveClient(clientDist: string, pathname: string, res: ServerResponse): void {
  if (!existsSync(clientDist)) {
    res.writeHead(200, { 'content-type': 'application/json', ...cors });
    res.end(JSON.stringify({ ok: true, maps: listMaps(), note: 'client not built — run: npm run build' }));
    return;
  }
  const candidate = resolveStaticFile(clientDist, pathname); // null if it escapes clientDist
  const isFile = candidate !== null && statSync(candidate, { throwIfNoEntry: false })?.isFile() === true;
  const file = isFile ? candidate : join(clientDist, 'index.html'); // SPA fallback
  res.writeHead(200, { 'content-type': MIME[extname(file)] ?? 'application/octet-stream' });
  createReadStream(file).pipe(res);
}

/** Starts the http + ws game server and resolves once it is listening. */
export function startServer(options: ServerOptions = {}): Promise<ServerHandle> {
  const env = options.env ?? process.env;
  const clientDist = options.clientDist ?? DEFAULT_CLIENT_DIST;
  const port = options.port ?? Number(env.PORT ?? 8090);
  // CS2D_FAST=1 shrinks round timings for integration tests
  const fastTimings = env.CS2D_FAST === '1' ? { freeze: 1, round: 20, bomb: 4, plant: 0.5, defuse: 1, defuseKit: 0.5, roundEnd: 1 } : {};

  const limits = loadLimitsConfig(env);

  const manager = new RoomManager(limits.maxRooms);
  const createLimiter = new KeyedRateLimiter(limits.createBurst, limits.createPerMin / 60);
  const reapTimer = setInterval(() => {
    manager.reap();
    createLimiter.prune();
  }, REAP_INTERVAL_MS);

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
      const result = await createRoomResponse({
        ip: clientIp(req, limits.trustedProxyHops),
        manager,
        limiter: createLimiter,
        timings: fastTimings,
        readBody: () => readJsonBody(req),
      });
      res.writeHead(result.status, { 'content-type': 'application/json', ...result.headers, ...cors });
      res.end(JSON.stringify(result.body));
      return;
    }

    serveClient(clientDist, url.pathname, res);
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
    let playerTeam: TeamId | null = null;

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
      const verdict = limiter.check(msg, Date.now()); // malformed frames count too
      if (verdict === 'kick') {
        ws.close(1008, 'rate limit exceeded');
        return;
      }
      if (verdict === 'drop' || !msg) return; // drop over-budget and malformed messages
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

  const close = (): Promise<void> => {
    clearInterval(reapTimer);
    for (const code of manager.codes()) manager.get(code)?.room.stop();
    for (const client of wss.clients) client.terminate();
    return new Promise((resolveClose) => {
      wss.close(() => {
        http.close(() => resolveClose());
        http.closeAllConnections();
      });
    });
  };

  return new Promise((resolveStart, rejectStart) => {
    // ws re-emits the http server's errors on `wss`; handle both while binding so a taken port rejects instead of crashing
    const onStartError = (err: Error): void => {
      clearInterval(reapTimer);
      rejectStart(err);
    };
    http.once('error', onStartError);
    wss.once('error', onStartError);
    http.listen(port, () => {
      http.off('error', onStartError);
      wss.off('error', onStartError);
      resolveStart({ http, wss, manager, port: (http.address() as AddressInfo).port, close });
    });
  });
}
