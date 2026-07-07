import { describe, expect, it } from 'vitest';
import type { WebSocket } from 'ws';
import { BTN, type GameEvent, type SnapshotMsg } from '@cs2d/shared';
import { Room } from '../src/room.js';

// Fast timings (seconds); sec() rounds to ticks. Mirrors room.test.ts's FAST.
const FAST = { freeze: 0.05, round: 5, bomb: 1, plant: 0.1, defuse: 0.2, defuseKit: 0.1, roundEnd: 0.1 };

/** Private internals the tests poke at (TS `private` is compile-time only). */
interface RoomInternals {
  step(): void;
}

const guts = (r: Room): RoomInternals => r as unknown as RoomInternals;
const step = (r: Room, n = 1): void => {
  for (let i = 0; i < n; i++) guts(r).step();
};
const stepUntil = (r: Room, cond: () => boolean, cap = 800): void => {
  for (let i = 0; i < cap && !cond(); i++) guts(r).step();
  if (!cond()) throw new Error('stepUntil: condition not reached');
};

function liveRoom(): Room {
  return new Room('testarena', FAST);
}

/** Fake websocket that records every server message (for event assertions). */
function fakeWs(): { msgs: Array<Record<string, unknown>>; ws: WebSocket } {
  const msgs: Array<Record<string, unknown>> = [];
  return { msgs, ws: { send: (raw: string) => msgs.push(JSON.parse(raw)) } as unknown as WebSocket };
}

const eventTypes = (rec: { msgs: Array<Record<string, unknown>> }): string[] =>
  rec.msgs
    .filter((m): m is Record<string, unknown> & SnapshotMsg => m.t === 's')
    .flatMap((m) => m.ev ?? [])
    .map((e: GameEvent) => e.e);

const shotCount = (rec: { msgs: Array<Record<string, unknown>> }): number =>
  eventTypes(rec).filter((e) => e === 'shot').length;

/**
 * broadcastSnapshot() only flushes queued events every SNAPSHOT_EVERY (2)
 * ticks, not every tick — a shot fired on an odd tick sits unflushed until
 * the next even one. Send an idle input and step past that boundary before
 * reading event-derived state (state read directly off PlayerConn, like hp,
 * doesn't need this).
 */
function settle(r: Room, send: ReturnType<typeof feeder>, id: number): void {
  send(id, 0, { a: 0 });
  step(r, 2);
}

/** Per-room input feeder with automatic sequence numbers; supports the lag-comp `k` field. */
function feeder(room: Room) {
  const seqs = new Map<number, number>();
  return (id: number, b: number, extra: { a?: number; w?: number; k?: number } = {}): void => {
    const s = (seqs.get(id) ?? 0) + 1;
    seqs.set(id, s);
    room.handleInput(id, {
      t: 'i',
      s,
      b,
      a: extra.a ?? 0,
      ...(extra.w !== undefined ? { w: extra.w } : {}),
      ...(extra.k !== undefined ? { k: extra.k } : {}),
    });
  };
}

describe('tryFire: semi-auto edge detection', () => {
  it('a semi-auto weapon fires once per fresh press, not once per tick held', () => {
    const room = liveRoom();
    const wsA = fakeWs();
    const t = room.addPlayer(wsA.ws, 'T1', 'T'); // default pistol (glock/usp) is semi-auto
    room.addPlayer(null, 'CT1', 'CT');
    const send = feeder(room);
    stepUntil(room, () => room.phase === 'live');

    send(t.id, BTN.ATTACK, { a: 0 });
    step(room, 1); // fresh press: fires
    send(t.id, BTN.ATTACK, { a: 0 }); // still held
    step(room, 1); // blocked: prevButtons already had ATTACK set
    settle(room, send, t.id);
    expect(shotCount(wsA)).toBe(1);

    // wait out the weapon's own fire-rate cooldown so the next press is
    // blocked (or not) purely by edge detection, not the rate limiter
    step(room, 10);
    send(t.id, BTN.ATTACK, { a: 0 }); // fresh press again (settle released the button)
    step(room, 1);
    settle(room, send, t.id);
    expect(shotCount(wsA)).toBe(2);
  });
});

describe('tryFire: fire-rate cooldown', () => {
  it('an auto weapon cannot fire again before nextShotTick', () => {
    const room = liveRoom();
    const wsA = fakeWs();
    const t = room.addPlayer(wsA.ws, 'T1', 'T');
    room.addPlayer(null, 'CT1', 'CT');
    const send = feeder(room);
    stepUntil(room, () => room.phase === 'live');

    t.primary = { id: 'ak47', ammo: 30, reserve: 90 };
    t.activeSlot = 1;

    // ak47: rpm=600 -> cooldown = round(TICK_RATE / (600/60)) = 6 ticks.
    // Holding ATTACK for 7 consecutive ticks should fire at tick 1 and tick 7.
    for (let i = 0; i < 7; i++) {
      send(t.id, BTN.ATTACK, { a: 0 });
      step(room, 1);
    }
    settle(room, send, t.id);
    expect(shotCount(wsA)).toBe(2);
  });
});

describe('tryFire: ammo and reload interaction', () => {
  it('firing with an empty magazine starts a reload instead of shooting', () => {
    const room = liveRoom();
    const wsA = fakeWs();
    const t = room.addPlayer(wsA.ws, 'T1', 'T');
    room.addPlayer(null, 'CT1', 'CT');
    const send = feeder(room);
    stepUntil(room, () => room.phase === 'live');

    t.primary = { id: 'ak47', ammo: 0, reserve: 90 };
    t.activeSlot = 1;

    send(t.id, BTN.ATTACK, { a: 0 });
    step(room, 1);
    expect(shotCount(wsA)).toBe(0);
    expect(t.reloadEndTick).toBeGreaterThan(0);
  });

  it('a pending reload blocks firing even with ammo available', () => {
    const room = liveRoom();
    const wsA = fakeWs();
    const t = room.addPlayer(wsA.ws, 'T1', 'T');
    room.addPlayer(null, 'CT1', 'CT');
    const send = feeder(room);
    stepUntil(room, () => room.phase === 'live');

    t.primary = { id: 'ak47', ammo: 30, reserve: 90 };
    t.activeSlot = 1;
    t.reloadEndTick = room.tick + 1000; // reload in progress, far from completing

    send(t.id, BTN.ATTACK, { a: 0 });
    step(room, 1);
    expect(shotCount(wsA)).toBe(0);
    expect(t.primary.ammo).toBe(30); // untouched
  });
});

describe('tryFire: event targeting', () => {
  it('shot broadcasts, hit is shooter-only, hurt is victim-only, kill broadcasts', () => {
    const room = liveRoom();
    const wsA = fakeWs();
    const wsB = fakeWs();
    const a = room.addPlayer(wsA.ws, 'A', 'T');
    const b = room.addPlayer(wsB.ws, 'B', 'CT');
    const send = feeder(room);
    stepUntil(room, () => room.phase === 'live');

    a.pos = { x: 200, y: 200 };
    b.pos = { x: 230, y: 200 }; // 30px east, dead ahead of aim=0
    b.hp = 1;
    b.armor = 0;
    // without an explicit lag-comp seenTick, tryFire targets each player's
    // last *recorded* position, not the live one — step once idly so the
    // reposition above gets captured before the shot is fired
    step(room, 1);

    send(a.id, BTN.ATTACK, { a: 0 });
    step(room, 1);
    settle(room, send, a.id);

    const aEvents = eventTypes(wsA);
    const bEvents = eventTypes(wsB);

    expect(aEvents).toContain('shot');
    expect(aEvents).toContain('hit'); // shooter-only
    expect(aEvents).not.toContain('hurt'); // victim-only, not sent to shooter
    expect(aEvents).toContain('kill'); // broadcast

    expect(bEvents).toContain('shot'); // broadcast fx
    expect(bEvents).toContain('hurt'); // victim-only
    expect(bEvents).not.toContain('hit'); // shooter-only, not sent to victim
    expect(bEvents).toContain('kill'); // broadcast
  });
});

describe('tryFire: lag compensation', () => {
  it('hits a target at its rewound (past) position when the client is behind', () => {
    const room = liveRoom();
    const t = room.addPlayer(null, 'T1', 'T');
    const ct = room.addPlayer(null, 'CT1', 'CT');
    const send = feeder(room);
    stepUntil(room, () => room.phase === 'live');

    t.pos = { x: 300, y: 300 };
    ct.pos = { x: 400, y: 300 }; // 100px east, dead ahead of aim=0
    step(room, 5); // record several frames with ct at this "old" position
    const earlyTick = room.tick;

    ct.pos = { x: 400, y: 900 }; // teleports far off the shot line ("live" position)
    step(room, 3); // a few frames of the moved-away position

    // client last saw ct at ~earlyTick; rewind() subtracts INTERP_DELAY_TICKS
    // (6) internally, so seenTick must be earlyTick + 6 to land back there
    send(t.id, BTN.ATTACK, { a: 0, k: earlyTick + 6 });
    step(room, 1);

    expect(ct.hp).toBeLessThan(100); // hit the rewound (old) position
  });

  it('misses the live position when the client has no lag-comp benefit (recent seenTick)', () => {
    const room = liveRoom();
    const t = room.addPlayer(null, 'T1', 'T');
    const ct = room.addPlayer(null, 'CT1', 'CT');
    const send = feeder(room);
    stepUntil(room, () => room.phase === 'live');

    t.pos = { x: 300, y: 300 };
    ct.pos = { x: 400, y: 300 };
    step(room, 5);

    ct.pos = { x: 400, y: 900 }; // moved off the shot line
    // rewind() always subtracts INTERP_DELAY_TICKS (6), even for a client
    // that's fully caught up — wait past that window so every frame it could
    // land on already reflects the moved-away position
    step(room, 10);

    // seenTick == current tick: rewind lands on a recent (moved-away) frame
    send(t.id, BTN.ATTACK, { a: 0, k: room.tick });
    step(room, 1);

    expect(ct.hp).toBe(100); // aim toward the old position misses the live one
  });
});
