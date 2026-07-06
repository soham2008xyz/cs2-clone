import { createServer } from 'node:http';
import { parse as parseUrl } from 'node:url';
import { WebSocketServer, type WebSocket } from 'ws';
import { decode, listMaps, type ClientMsg } from '@cs2d/shared';
import { RoomManager } from './roomManager.js';

const PORT = Number(process.env.PORT ?? 8090);
// CS2D_FAST=1 shrinks round timings for integration tests
const FAST_TIMINGS = process.env.CS2D_FAST === '1' ? { freeze: 1, round: 20, bomb: 4, plant: 0.5, defuse: 1, defuseKit: 0.5, roundEnd: 1 } : {};
const REAP_INTERVAL_MS = 30000;

const manager = new RoomManager();
setInterval(() => manager.reap(), REAP_INTERVAL_MS);

function readJsonBody(req: import('node:http').IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk) => (body += chunk));
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (e) {
        reject(e);
      }
    });
    req.on('error', reject);
  });
}

const cors = { 'access-control-allow-origin': '*', 'access-control-allow-methods': 'GET,POST,OPTIONS', 'access-control-allow-headers': 'content-type' };

const http = createServer(async (req, res) => {
  const url = parseUrl(req.url ?? '', true);

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
    try {
      const body = (await readJsonBody(req)) as { map?: string; backfillBots?: boolean };
      const map = listMaps().includes(body.map ?? '') ? (body.map as string) : 'dust2';
      const meta = manager.create(map, Boolean(body.backfillBots), FAST_TIMINGS);
      res.writeHead(200, { 'content-type': 'application/json', ...cors });
      res.end(JSON.stringify({ code: meta.code, map: meta.map }));
    } catch {
      res.writeHead(400, { 'content-type': 'application/json', ...cors });
      res.end(JSON.stringify({ error: 'bad request' }));
    }
    return;
  }

  res.writeHead(200, { 'content-type': 'application/json', ...cors });
  res.end(JSON.stringify({ ok: true, maps: listMaps() }));
});

const wss = new WebSocketServer({ server: http });

wss.on('connection', (ws: WebSocket, req) => {
  const url = parseUrl(req.url ?? '', true);
  const code = typeof url.query.room === 'string' ? url.query.room : '';
  const entry = manager.get(code);
  if (!entry) {
    ws.close(4004, 'room not found');
    return;
  }
  const { room, meta } = entry;
  let playerId: number | null = null;
  let playerTeam: import('@cs2d/shared').TeamId | null = null;

  ws.on('message', (raw) => {
    let msg: ClientMsg;
    try {
      msg = decode<ClientMsg>(raw.toString());
    } catch {
      return;
    }
    if (msg.t === 'join' && playerId === null) {
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
      room.fillBots(Math.min(5, Math.max(1, msg.perTeam ?? 5)), msg.difficulty ?? 'normal');
    } else if (msg.t === 'team') {
      room.setTeam(playerId, msg.team);
      playerTeam = msg.team;
    } else if (msg.t === 'chat') {
      const name = room.players.get(playerId)?.name ?? 'Player';
      room.broadcastChat(name, playerTeam, msg.text);
    } else if (msg.t === 'ping') {
      ws.send(JSON.stringify({ t: 'pong', t0: msg.t0 }));
    }
  });

  ws.on('close', () => {
    if (playerId !== null) {
      const departedTeam = room.removePlayer(playerId);
      console.log(`[room ${meta.code}] #${playerId} left, ${room.players.size} online`);
      if (meta.backfillBots && departedTeam && room.phase !== 'waiting') {
        room.addBot(departedTeam);
      }
    }
  });
});

http.listen(PORT, () => {
  console.log(`[server] http/ws listening on :${PORT}`);
});
