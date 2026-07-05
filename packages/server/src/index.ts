import { createServer } from 'node:http';
import { WebSocketServer, type WebSocket } from 'ws';
import { decode, listMaps, type ClientMsg } from '@cs2d/shared';
import { Room } from './room.js';

const PORT = Number(process.env.PORT ?? 8090);

const room = new Room('dust2');
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
  console.log(`[server] ws://localhost:${PORT} — room 'dust2' ticking`);
});
