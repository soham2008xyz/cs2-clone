// Headless test client: joins a room (creating one if no code given) and
// walks in a circle. Useful for verifying netcode/interpolation with a real
// second player, or for populating a room the browser client can also join.
//   node scripts/headless-client.mjs [name] [durationSec] [roomCode]
import WebSocket from 'ws';

const name = process.argv[2] ?? 'HeadlessBob';
const durationSec = Number(process.argv[3] ?? 60);
const explicitRoom = process.argv[4];
const BTN = { UP: 1, DOWN: 2, LEFT: 4, RIGHT: 8 };

async function resolveRoomCode() {
  if (explicitRoom) return explicitRoom;
  // reuse the first open room if one exists, else create a fresh dust2 room
  const list = await fetch('http://localhost:8090/rooms').then((r) => r.json());
  if (list.rooms.length > 0) return list.rooms[0].code;
  const created = await fetch('http://localhost:8090/rooms', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ map: 'dust2', backfillBots: false }),
  }).then((r) => r.json());
  return created.code;
}

const roomCode = await resolveRoomCode();
console.log(`[${name}] using room ${roomCode}`);

const ws = new WebSocket(`ws://localhost:8090?room=${roomCode}`);
let seq = 0;
let tick = 0;

ws.on('open', () => {
  ws.send(JSON.stringify({ t: 'join', name }));
  console.log(`[${name}] joined`);
  const timer = setInterval(() => {
    tick++;
    // walk a square: right, down, left, up — 1s each
    const phase = Math.floor(tick / 60) % 4;
    const b = [BTN.RIGHT, BTN.DOWN, BTN.LEFT, BTN.UP][phase];
    const aim = (tick / 60) * Math.PI;
    ws.send(JSON.stringify({ t: 'i', s: ++seq, b, a: aim }));
    if (tick >= durationSec * 60) {
      clearInterval(timer);
      ws.close();
      console.log(`[${name}] done`);
    }
  }, 1000 / 60);
});

ws.on('message', (raw) => {
  const msg = JSON.parse(raw.toString());
  if (msg.t === 'welcome') console.log(`[${name}] id=${msg.id} map=${msg.map}`);
});
ws.on('error', (e) => {
  console.error(`[${name}] error:`, e.message);
  process.exit(1);
});
