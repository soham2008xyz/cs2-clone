import { createServer } from 'node:http';
import { WebSocketServer, type WebSocket } from 'ws';
import { decode, listMaps, type ClientMsg } from '@cs2d/shared';
import { Room } from './room.js';

const PORT = Number(process.env.PORT ?? 8090);
const MAP = process.env.CS2D_MAP ?? 'dust2';
// CS2D_FAST=1 shrinks round timings for integration tests
const fast = process.env.CS2D_FAST === '1';

const room = new Room(
  MAP,
  fast ? { freeze: 1, round: 20, bomb: 4, plant: 0.5, defuse: 1, defuseKit: 0.5, roundEnd: 1 } : {},
);
room.start();

const http = createServer((req, res) => {
  res.writeHead(200, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ ok: true, maps: listMaps(), players: room.players.size }));
});

const wss = new WebSocketServer({ server: http });

wss.on('connection', (ws: WebSocket) => {
  let playerId: number | null = null;

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
      console.log(`[room] ${p.name} joined as ${p.team} (#${p.id}), ${room.players.size} online`);
    } else if (msg.t === 'i' && playerId !== null) {
      room.handleInput(playerId, msg);
    } else if (msg.t === 'buy' && playerId !== null) {
      room.handleBuy(playerId, msg.item);
    }
  });

  ws.on('close', () => {
    if (playerId !== null) {
      room.removePlayer(playerId);
      console.log(`[room] #${playerId} left, ${room.players.size} online`);
    }
  });
});

http.listen(PORT, () => {
  console.log(`[server] ws://localhost:${PORT} — room '${MAP}' ticking`);
});
