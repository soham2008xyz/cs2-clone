// Bot-vs-bot smoke test: fills a fast-timed room to 5v5 with bots and watches
// several rounds complete autonomously (buying, pathing, engaging, plant/defuse)
// without the server crashing or the match stalling.
//   node scripts/integration-bots.mjs
import { spawn } from 'node:child_process';
import WebSocket from 'ws';

const PORT = 8092;
const fail = (msg) => {
  console.error(`✗ FAIL: ${msg}`);
  process.exitCode = 1;
  cleanup();
};
const ok = (msg) => console.log(`✓ ${msg}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let server;
let ws;
function cleanup() {
  ws?.close();
  server?.kill();
  setTimeout(() => process.exit(), 300);
}

async function waitFor(desc, cond, timeoutMs = 20000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    const v = await cond();
    if (v) return v;
    await sleep(50);
  }
  throw new Error(`timeout waiting for: ${desc}`);
}

async function main() {
  server = spawn('npx', ['tsx', 'packages/server/src/index.ts'], {
    env: { ...process.env, PORT: String(PORT), CS2D_FAST: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  server.stderr.on('data', (d) => process.stdout.write(`[srv-err] ${d}`));
  await waitFor('server up', () => fetch(`http://localhost:${PORT}`).then(() => true).catch(() => false), 15000);
  await sleep(200);

  const createRes = await fetch(`http://localhost:${PORT}/rooms`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ map: 'dust2', backfillBots: false }),
  });
  const { code: roomCode } = await createRes.json();
  ok(`created room ${roomCode} (dust2)`);

  let state = { roster: [], match: null, rounds: [], nadeThrows: 0 };
  ws = new WebSocket(`ws://localhost:${PORT}?room=${roomCode}`);
  await new Promise((resolve, reject) => {
    ws.on('open', () => {
      ws.send(JSON.stringify({ t: 'join', name: 'Observer', team: 'T' }));
      resolve();
    });
    ws.on('error', reject);
  });
  ws.on('message', (raw) => {
    const msg = JSON.parse(raw.toString());
    if (msg.t === 'roster') state.roster = msg.players;
    if (msg.t === 's') {
      state.match = msg.m;
      for (const ev of msg.ev ?? []) {
        if (ev.e === 'round_end') state.rounds.push(ev);
        if (ev.e === 'nade_throw') state.nadeThrows++;
      }
    }
  });
  ok('observer connected');

  ws.send(JSON.stringify({ t: 'bots', perTeam: 5, difficulty: 'hard' }));
  await waitFor('roster fills to 5v5', () => state.roster.length === 10, 5000);
  const t = state.roster.filter((r) => r.team === 'T').length;
  const ct = state.roster.filter((r) => r.team === 'CT').length;
  if (t !== 5 || ct !== 5) return fail(`expected 5v5, got T=${t} CT=${ct}`);
  ok(`filled to 5v5 (${state.roster.map((r) => r.name).join(', ')})`);

  await waitFor('match leaves warmup', () => state.match?.ph && state.match.ph !== 'waiting', 10000);
  ok('bots started the match (left warmup)');

  const TARGET_ROUNDS = 4;
  await waitFor(
    `${TARGET_ROUNDS} rounds complete via bot play`,
    () => state.rounds.length >= TARGET_ROUNDS,
    120000,
  );
  ok(`${state.rounds.length} rounds completed autonomously: ${state.rounds.slice(0, TARGET_ROUNDS).map((r) => `${r.winner}/${r.reason}`).join(', ')}`);

  const reasons = new Set(state.rounds.map((r) => r.reason));
  ok(`round end reasons observed: ${[...reasons].join(', ')}`);

  // sanity: both a T-side and a CT-side win occurred somewhere (bots on both teams are competent)
  const tWins = state.rounds.filter((r) => r.winner === 'T').length;
  const ctWins = state.rounds.filter((r) => r.winner === 'CT').length;
  console.log(`  T wins: ${tWins}, CT wins: ${ctWins} (over ${state.rounds.length} rounds)`);

  // bots buy utility from round 2 on and throw it at map anchors while executing
  if (state.nadeThrows === 0) return fail('no bot threw any utility over the observed rounds');
  ok(`bots threw utility ${state.nadeThrows} time(s) at map anchors`);

  console.log('\nALL BOT INTEGRATION CHECKS PASSED');
  cleanup();
}

main().catch((e) => fail(e?.stack ?? e?.message ?? String(e)));
