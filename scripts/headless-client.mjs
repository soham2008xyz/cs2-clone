// Headless test client: joins the server and walks in a circle. Useful for
// verifying netcode/interpolation with a real second player.
//   node scripts/headless-client.mjs [name] [durationSec]
import WebSocket from 'ws';

const name = process.argv[2] ?? 'HeadlessBob';
const durationSec = Number(process.argv[3] ?? 60);
const BTN = { UP: 1, DOWN: 2, LEFT: 4, RIGHT: 8 };

const ws = new WebSocket('ws://localhost:8090');
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
