import { createServer } from 'node:http';
import { WebSocketServer } from 'ws';
import { getMap, listMaps } from '@cs2d/shared';

const PORT = Number(process.env.PORT ?? 8090);

// Warm the map registry (also validates the maps at boot).
for (const name of listMaps()) {
  const m = getMap(name);
  console.log(`[map] ${name}: ${m.width}x${m.height} tiles, T spawns=${m.spawns.T.length}, CT spawns=${m.spawns.CT.length}`);
}

const http = createServer((req, res) => {
  res.writeHead(200, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ ok: true, maps: listMaps() }));
});

const wss = new WebSocketServer({ server: http });

wss.on('connection', (ws) => {
  console.log('[ws] client connected');
  ws.on('close', () => console.log('[ws] client disconnected'));
});

http.listen(PORT, () => {
  console.log(`[server] listening on http://localhost:${PORT}`);
});
