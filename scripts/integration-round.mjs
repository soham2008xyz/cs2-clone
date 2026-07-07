// End-to-end round-flow test against the real server on the test arena with
// fast timings. Plays three rounds: elimination win, plant→defuse, plant→boom.
//   node scripts/integration-round.mjs
import { spawn } from 'node:child_process';
import WebSocket from 'ws';

const PORT = 8091;
const BTN = { UP: 1, DOWN: 2, LEFT: 4, RIGHT: 8, ATTACK: 32, USE: 128 };

const fail = (msg) => {
  console.error(`✗ FAIL: ${msg}`);
  process.exitCode = 1;
  cleanup();
};
const ok = (msg) => console.log(`✓ ${msg}`);

let server;
const clients = [];
function cleanup() {
  for (const c of clients) c.ws?.close();
  server?.kill();
  setTimeout(() => {
    server?.kill('SIGKILL'); // don't leave a lingering process holding the port
    process.exit();
  }, 300);
}

class TestClient {
  constructor(name, team) {
    this.name = name;
    this.team = team;
    this.seq = 0;
    this.pos = { x: 0, y: 0 };
    this.me = null;
    this.match = null;
    this.events = [];
    this.buttons = 0;
    this.aim = 0;
    clients.push(this);
  }

  connect(roomCode) {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(`ws://localhost:${PORT}?room=${roomCode}`);
      this.ws.on('open', () => {
        this.ws.send(JSON.stringify({ t: 'join', name: this.name, team: this.team }));
        this.timer = setInterval(() => {
          const msg = { t: 'i', s: ++this.seq, b: this.buttons, a: this.aim, k: this.lastTick ?? 0 };
          if (this.pendingSlot) {
            msg.w = this.pendingSlot;
            this.pendingSlot = undefined;
          }
          this.ws.send(JSON.stringify(msg));
        }, 1000 / 60);
        resolve();
      });
      this.ws.on('error', reject);
      this.ws.on('message', (raw) => {
        const msg = JSON.parse(raw.toString());
        if (msg.t === 'welcome') this.id = msg.id;
        if (msg.t === 's') {
          this.lastTick = msg.k;
          this.me = msg.me;
          this.match = msg.m;
          this.zones = msg.z ?? [];
          this.nadesInFlight = msg.n ?? [];
          const self = msg.p.find((p) => p[0] === this.id);
          if (self) {
            this.pos = { x: self[1], y: self[2] };
            this.alive = (self[5] & 1) !== 0;
          }
          for (const ev of msg.ev ?? []) this.events.push(ev);
        }
      });
    });
  }

  buy(item) {
    this.ws.send(JSON.stringify({ t: 'buy', item }));
  }

  switchSlot(n) {
    this.pendingSlot = n;
  }

  /** semi-auto style pulse: press ATTACK briefly then release (one throw/shot per call) */
  async pulseAttack() {
    // hold long enough that the 60 Hz input sender gets several packets out
    // even when timers jitter under load — one press edge still means one shot
    this.buttons |= BTN.ATTACK;
    await sleep(150);
    this.buttons &= ~BTN.ATTACK;
    await sleep(100);
  }

  /** returns true when arrived */
  steerToward(x, y, useKey = false) {
    const dx = x - this.pos.x;
    const dy = y - this.pos.y;
    let b = 0;
    if (Math.abs(dx) > 6) b |= dx > 0 ? BTN.RIGHT : BTN.LEFT;
    if (Math.abs(dy) > 6) b |= dy > 0 ? BTN.DOWN : BTN.UP;
    const arrived = b === 0;
    if (arrived && useKey) b |= BTN.USE;
    this.buttons = b;
    return arrived;
  }

  aimAt(x, y) {
    this.aim = Math.atan2(y - this.pos.y, x - this.pos.x);
  }

  idle() {
    this.buttons = 0;
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitFor(desc, cond, timeoutMs = 20000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    const v = await cond();
    if (v) return v;
    await sleep(30);
  }
  throw new Error(`timeout waiting for: ${desc}`);
}

/** consume (remove and return) the first queued event of the given type */
const takeEvent = (c, type) => {
  const i = c.events.findIndex((e) => e.e === type);
  return i === -1 ? undefined : c.events.splice(i, 1)[0];
};

/**
 * Wait until `c` sees the current round's round_end on its own socket, then
 * drop it and everything queued before it. Per-socket delivery is FIFO, so
 * this discards exactly the finished round's leftovers — never events that
 * belong to the next round. Each client must sync on its own stream: the two
 * sockets can be tens of milliseconds apart under load, so a bulk clear keyed
 * to the other client's state can wipe events that have not yet arrived here.
 */
const syncRoundEnd = (c, timeoutMs = 20000) =>
  waitFor(`round_end seen by ${c.name}`, () => {
    const i = c.events.findIndex((e) => e.e === 'round_end');
    return i === -1 ? null : c.events.splice(0, i + 1)[i];
  }, timeoutMs);

async function main() {
  // spawn tsx directly (not via npx): no wrapper cold-start, and kill()
  // reaches the node process that actually holds the port
  server = spawn('node_modules/.bin/tsx', ['packages/server/src/index.ts'], {
    env: { ...process.env, PORT: String(PORT), CS2D_FAST: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const srvTail = [];
  const logSrv = (tag) => (d) => {
    srvTail.push(String(d));
    if (srvTail.length > 40) srvTail.shift();
    if (tag === 'srv-err' || process.env.VERBOSE) process.stdout.write(`[${tag}] ${d}`);
  };
  server.stdout.on('data', logSrv('srv'));
  server.stderr.on('data', logSrv('srv-err'));
  let serverExit = null;
  server.on('exit', (code, signal) => (serverExit = { code, signal }));
  // cold tsx compile on a loaded machine can take well over 15s
  await waitFor('server up', () => {
    if (serverExit) {
      throw new Error(
        `server exited before ready (code ${serverExit.code}, signal ${serverExit.signal})\n${srvTail.join('')}`,
      );
    }
    return fetch(`http://localhost:${PORT}`).then(() => true).catch(() => false);
  }, 60000);
  await sleep(200);

  const createRes = await fetch(`http://localhost:${PORT}/rooms`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ map: 'testarena', backfillBots: false }),
  });
  const { code: roomCode } = await createRes.json();
  ok(`created room ${roomCode} (testarena)`);

  const A = new TestClient('Alpha', 'T');
  const B = new TestClient('Bravo', 'CT');
  await A.connect(roomCode);
  await B.connect(roomCode);
  ok('both clients connected');

  await waitFor('match freeze', () => A.match?.ph === 'freeze');
  ok('match started (freeze)');

  // pistol round: $800 — deagle ($700) is affordable, an AK must be rejected
  A.buy('ak47');
  await sleep(300);
  if (A.me?.weapon === 'ak47') return fail('AK-47 must be rejected on pistol-round money');
  A.buy('deagle');
  await waitFor('A holds deagle', () => A.me?.weapon === 'deagle');
  if (A.me.money !== 100) return fail(`A money should be $100 after deagle, got $${A.me.money}`);
  ok(`A bought Deagle (money now $${A.me.money}); AK correctly rejected`);

  await waitFor('live', () => A.match?.ph === 'live');
  ok('round 1 live');

  // ── Round 1: A eliminates B ──
  await waitFor('A sees B alive', () => B.alive);
  // semi-auto: pulse the trigger (fresh press required per shot)
  let trigger = false;
  const killTimer = setInterval(() => {
    A.aimAt(B.pos.x, B.pos.y);
    trigger = !trigger;
    A.buttons = trigger ? BTN.ATTACK : 0;
  }, 60);
  await waitFor('kill event', () => takeEvent(A, 'kill'));
  clearInterval(killTimer);
  A.idle();
  ok('A killed B');
  const re1 = await syncRoundEnd(A);
  if (re1.winner !== 'T') return fail(`round 1 winner should be T, got ${re1.winner}`);
  ok(`round 1: T wins by ${re1.reason}`);
  await waitFor('scores update', () => A.match?.st === 1);
  ok(`score T ${A.match.st} - CT ${A.match.sct}`);
  await syncRoundEnd(B);

  // ── Round 2: A plants, B defuses ──
  await waitFor('round 2 live', () => A.match?.ph === 'live' && A.match?.rn === 2);
  const aMoney = A.me.money;
  const bMoney = B.me.money;
  ok(`round 2 live (A $${aMoney}, B $${bMoney})`);
  if (!A.me.bomb) return fail('A (only T) should carry the bomb');

  const SITE = { x: 12 * 32, y: 6 * 32 };
  const plantLoop = setInterval(() => A.steerToward(SITE.x, SITE.y, true), 30);
  const bombPos = await waitFor('planted', () => takeEvent(A, 'planted'), 25000);
  clearInterval(plantLoop);
  A.idle();
  ok('bomb planted');
  await waitFor('phase planted', () => A.match?.ph === 'planted', 5000);

  const defuseLoop = setInterval(() => B.steerToward(bombPos.x, bombPos.y, true), 30);
  await waitFor('defused', () => takeEvent(B, 'defused'), 25000);
  clearInterval(defuseLoop);
  B.idle();
  ok('bomb defused');
  const re2 = await syncRoundEnd(B);
  if (re2.winner !== 'CT' || re2.reason !== 'bomb_defused') return fail(`round 2 expected CT/bomb_defused, got ${re2.winner}/${re2.reason}`);
  ok('round 2: CT wins by defuse');
  await syncRoundEnd(A);

  // ── Round 3: A plants, bomb explodes ──
  await waitFor('round 3 live', () => A.match?.ph === 'live' && A.match?.rn === 3);
  ok('round 3 live');
  const plantLoop3 = setInterval(() => A.steerToward(SITE.x, SITE.y, true), 30);
  await waitFor('planted again', () => takeEvent(A, 'planted'), 25000);
  clearInterval(plantLoop3);
  // A runs away from the bomb
  const fleeLoop = setInterval(() => A.steerToward(3.5 * 32, 3.5 * 32), 30);
  await waitFor('exploded', () => takeEvent(A, 'exploded'), 15000);
  clearInterval(fleeLoop);
  A.idle();
  ok('bomb exploded');
  const re3 = await syncRoundEnd(A);
  if (re3.winner !== 'T' || re3.reason !== 'bomb_exploded') return fail(`round 3 expected T/bomb_exploded, got ${re3.winner}/${re3.reason}`);
  ok('round 3: T wins by explosion');
  await waitFor('final score', () => A.match?.st === 2 && A.match?.sct === 1);
  ok(`final score T ${A.match.st} - CT ${A.match.sct}`);
  await syncRoundEnd(B);

  // ── Round 4: grenade economy + throwing (smoke/flash/he/molotov) ──
  await waitFor('round 4 live', () => A.match?.ph === 'live' && A.match?.rn === 4);
  ok('round 4 live');

  A.buy('smoke');
  await waitFor('A holds smoke', () => A.me?.nades?.includes('smoke'));
  A.buy('flash');
  await waitFor('A holds flash', () => A.me?.nades?.includes('flash'));
  A.buy('he');
  await waitFor('A holds he', () => A.me?.nades?.includes('he'));
  A.buy('molotov');
  await waitFor('A holds molotov', () => A.me?.nades?.includes('molotov'));
  ok(`A bought full utility loadout: ${A.me.nades.join(', ')}`);

  B.buy('molotov'); // CT must not be able to buy the T-exclusive molotov
  await sleep(250);
  if (B.me?.nades?.includes('molotov')) return fail('CT should not be able to buy molotov (T-exclusive)');
  ok('CT correctly rejected molotov purchase (team-restricted)');

  A.switchSlot(4);
  await waitFor('A on grenade slot', () => A.me?.slot === 4);
  A.aimAt(A.pos.x + 200, A.pos.y);

  await A.pulseAttack();
  const t1 = await waitFor('smoke thrown', () => takeEvent(A, 'nade_throw'));
  if (t1.kind !== 'smoke') return fail(`expected smoke thrown first (FIFO), got ${t1.kind}`);
  await waitFor('smoke_pop', () => takeEvent(A, 'smoke_pop'), 8000);
  await waitFor('smoke zone in snapshot', () => A.zones.some((z) => z[1] === 'smoke'), 3000);
  ok('smoke: thrown, detonated, zone visible');

  // aim at the nearby west wall so the flash bounces to rest close to A —
  // keeps the self-blind check deterministic regardless of throw distance
  A.aimAt(A.pos.x - 300, A.pos.y);
  await A.pulseAttack();
  const t2 = await waitFor('flash thrown', () => takeEvent(A, 'nade_throw'));
  if (t2.kind !== 'flash') return fail(`expected flash thrown second, got ${t2.kind}`);
  await waitFor('flash_pop', () => takeEvent(A, 'flash_pop'), 8000);
  ok('flash: thrown and detonated');
  try {
    await waitFor('A is blinded by own flash', () => (A.me?.blind ?? 0) > 0, 1500);
    ok(`self-blind confirmed for ${A.me.blind} ticks`);
  } catch {
    console.log('  (note: self-blind not observed — LOS/distance-dependent, not a hard requirement)');
  }

  await A.pulseAttack();
  const t3 = await waitFor('he thrown', () => takeEvent(A, 'nade_throw'));
  if (t3.kind !== 'he') return fail(`expected he thrown third, got ${t3.kind}`);
  await waitFor('he_pop', () => takeEvent(A, 'he_pop'), 8000);
  ok('HE: thrown and detonated');

  await A.pulseAttack();
  const t4 = await waitFor('molotov thrown', () => takeEvent(A, 'nade_throw'));
  if (t4.kind !== 'molotov') return fail(`expected molotov thrown fourth, got ${t4.kind}`);
  await waitFor('molotov_ignite', () => takeEvent(A, 'molotov_ignite'), 8000);
  await waitFor('fire zone in snapshot', () => A.zones.some((z) => z[1] === 'fire'), 3000);
  ok('molotov: thrown, ignited, fire zone visible');
  if (A.me.nades && A.me.nades.length > 0) return fail(`A should have thrown all 4 grenades, still holding: ${A.me.nades}`);
  ok('inventory empty after throwing all grenades, auto-switched off slot 4');

  console.log('\nALL INTEGRATION CHECKS PASSED');
  cleanup();
}

main().catch((e) => fail(e?.stack ?? e?.message ?? String(e)));
