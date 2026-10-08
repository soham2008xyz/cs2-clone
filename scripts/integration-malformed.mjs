// Sends malformed client messages and a corrupt raw frame to a real server,
// then checks it still answers GET /rooms and still serves the room.
//   node scripts/integration-malformed.mjs
import { spawn } from 'node:child_process';
import { createConnection } from 'node:net';
import { fileURLToPath } from 'node:url';
import WebSocket from 'ws';

const PORT = 8093;
const TSX_CLI = fileURLToPath(new URL('../node_modules/tsx/dist/cli.mjs', import.meta.url));
const base = `http://localhost:${PORT}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let server;
let exited = null;
const done = (code) => {
  server?.kill();
  setTimeout(() => {
    server?.kill('SIGKILL');
    process.exit(code);
  }, 300);
};
const fail = (msg) => {
  console.error(`✗ FAIL: ${msg}`);
  done(1);
};

async function alive() {
  if (exited !== null) return false;
  try {
    const res = await fetch(`${base}/rooms`);
    return res.ok;
  } catch {
    return false;
  }
}

function openWs(code) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://localhost:${PORT}?room=${code}`);
    ws.on('open', () => resolve(ws));
    ws.on('error', reject);
  });
}

/** Handshake by hand, then write a frame with reserved opcode 0xF (ws rejects it). */
function sendBadFrame(code) {
  return new Promise((resolve) => {
    const sock = createConnection(PORT, 'localhost', () => {
      sock.write(
        `GET /?room=${code} HTTP/1.1\r\nHost: localhost\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n` +
          `Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\nSec-WebSocket-Version: 13\r\n\r\n`,
      );
    });
    let sent = false;
    sock.on('data', () => {
      if (sent) return;
      sent = true;
      sock.write(Buffer.from([0x8f, 0x80, 0, 0, 0, 0]));
      setTimeout(() => {
        sock.destroy();
        resolve();
      }, 300);
    });
    sock.on('error', () => resolve());
  });
}

async function main() {
  server = spawn(process.execPath, [TSX_CLI, 'packages/server/src/index.ts'], {
    env: { ...process.env, PORT: String(PORT), CS2D_FAST: '1' },
    stdio: ['ignore', 'ignore', 'inherit'],
  });
  server.on('exit', (c) => (exited = c ?? 1));
  for (let i = 0; i < 60 && !(await alive()); i++) await sleep(250);
  if (!(await alive())) return fail('server did not start');

  const created = await fetch(`${base}/rooms`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ map: 'testarena' }) });
  const { code } = await created.json();

  const cases = [
    ['join without name', [{ t: 'join' }]],
    ['join with object name', [{ t: 'join', name: {} }]],
    ['chat text is a number', [{ t: 'join', name: 'a' }, { t: 'chat', text: 5 }]],
    ['input with bad types', [{ t: 'join', name: 'a' }, { t: 'i', s: 'x', b: [], a: null, w: 'x', k: {} }]],
    ['input with fractional slot', [{ t: 'join', name: 'a' }, { t: 'i', s: 1, b: 0, a: 0, w: 1.5 }]],
    ['buy with numeric item', [{ t: 'join', name: 'a' }, { t: 'buy', item: 7 }]],
    ['bots with string count', [{ t: 'join', name: 'a' }, { t: 'bots', perTeam: 'many' }]],
    ['team with bad value', [{ t: 'join', name: 'a' }, { t: 'team', team: 9 }]],
    ['ping without t0', [{ t: 'join', name: 'a' }, { t: 'ping' }]],
    ['buy __proto__', [{ t: 'join', name: 'a' }, { t: 'buy', item: '__proto__' }, { t: 'buy', item: 'constructor' }]],
    ['non-object JSON', ['null', '5', '[]', '"s"', 'not json']],
  ];
  for (const [label, frames] of cases) {
    const ws = await openWs(code);
    for (const f of frames) ws.send(typeof f === 'string' ? f : JSON.stringify(f));
    await sleep(150);
    ws.close();
    if (!(await alive())) return fail(`server died after: ${label}`);
    console.log(`✓ survived: ${label}`);
  }

  await sendBadFrame(code);
  await sendBadFrame('ZZZZ'); // unknown room: error handler must already be attached
  const big = await openWs(code);
  big.on('error', () => {});
  big.send(JSON.stringify({ t: 'ping', t0: 1, pad: 'x'.repeat(200 * 1024) })); // over maxPayload: socket closes
  await sleep(200);
  big.terminate();
  await sleep(200);
  if (!(await alive())) return fail('server died after raw invalid-opcode frame');
  console.log('✓ survived: invalid opcode frame');

  // The room must still accept a well-formed player.
  const ws = await openWs(code);
  const pong = new Promise((resolve) => ws.on('message', (d) => String(d).includes('"pong"') && resolve(true)));
  ws.send(JSON.stringify({ t: 'join', name: 'ok' }));
  ws.send(JSON.stringify({ t: 'ping', t0: 1 }));
  const got = await Promise.race([pong, sleep(3000).then(() => false)]);
  ws.close();
  if (!got) return fail('room stopped answering after malformed input');
  console.log('✓ room still serves valid clients');
  done(0);
}

main().catch((e) => fail(String(e)));
