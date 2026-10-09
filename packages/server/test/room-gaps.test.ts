import { describe, expect, it } from 'vitest';
import type { WebSocket } from 'ws';
import { BTN, getWeapon, TICK_RATE, type GameEvent, type SnapshotMsg } from '@cs2d/shared';
import { Room, type PlayerConn } from '../src/room.js';

// Fast timings (seconds); sec() rounds to ticks. Mirrors room.test.ts's FAST.
const FAST = { freeze: 0.05, round: 5, bomb: 1, plant: 0.1, defuse: 0.5, defuseKit: 0.1, roundEnd: 0.1 };

interface RoomInternals {
  step(): void;
  fires: Map<number, { id: number; kind: string; pos: { x: number; y: number }; untilTick: number; ownerId: number; ownerTeam: 'T' | 'CT' }>;
  activeNades: Map<number, { pos: { x: number; y: number }; vel: { x: number; y: number }; fuseTick: number }>;
  phaseEndTick: number;
  onKill(killer: PlayerConn, victim: PlayerConn, weapon: ReturnType<typeof getWeapon>): void;
}

const guts = (r: Room): RoomInternals => r as unknown as RoomInternals;
const step = (r: Room, n = 1): void => {
  for (let i = 0; i < n; i++) guts(r).step();
};
const stepUntil = (r: Room, cond: () => boolean, cap = 800): void => {
  for (let i = 0; i < cap && !cond(); i++) guts(r).step();
  if (!cond()) throw new Error('stepUntil: condition not reached');
};

function fakeWs(): { msgs: Array<Record<string, unknown>>; ws: WebSocket } {
  const msgs: Array<Record<string, unknown>> = [];
  return { msgs, ws: { send: (raw: string) => msgs.push(JSON.parse(raw)) } as unknown as WebSocket };
}

const events = (msgs: Array<Record<string, unknown>>): GameEvent[] =>
  msgs.filter((m): m is Record<string, unknown> & SnapshotMsg => m.t === 's').flatMap((m) => m.ev ?? []);

function feeder(room: Room) {
  const seqs = new Map<number, number>();
  return (id: number, b: number, extra: { a?: number; w?: number } = {}): void => {
    const s = (seqs.get(id) ?? 0) + 1;
    seqs.set(id, s);
    room.handleInput(id, { t: 'i', s, b, a: extra.a ?? 0, ...(extra.w !== undefined ? { w: extra.w } : {}) });
  };
}

/** A started 1v1 on testarena, live. */
function liveDuel() {
  const room = new Room('testarena', FAST);
  const rec = fakeWs();
  const t = room.addPlayer(rec.ws, 'T1', 'T');
  const ct = room.addPlayer(null, 'CT1', 'CT');
  stepUntil(room, () => room.phase === 'live');
  return { room, t, ct, rec, send: feeder(room) };
}

describe('reloading', () => {
  it('refills the magazine from reserve once the reload timer elapses', () => {
    const { room, t, send } = liveDuel();
    t.primary = { id: 'ak47', ammo: 5, reserve: 90 };
    t.activeSlot = 1;
    send(t.id, BTN.RELOAD);
    step(room, 1);
    const w = getWeapon('ak47');
    expect(t.reloadEndTick).toBeGreaterThan(room.tick);
    expect(t.reloadEndTick - room.tick).toBeLessThanOrEqual(Math.round(w.reloadSec * TICK_RATE));
    stepUntil(room, () => t.reloadEndTick === 0, 400);
    expect(t.primary.ammo).toBe(w.magazine);
    expect(t.primary.reserve).toBe(90 - (w.magazine - 5));
  });

  it('only loads what reserve has left', () => {
    const { room, t } = liveDuel();
    t.primary = { id: 'ak47', ammo: 0, reserve: 7 };
    t.activeSlot = 1;
    t.reloadEndTick = room.tick + 2;
    step(room, 4);
    expect(t.primary.ammo).toBe(7);
    expect(t.primary.reserve).toBe(0);
  });

  it.each([
    ['a full magazine', { ammo: getWeapon('ak47').magazine, reserve: 90 }],
    ['an empty reserve', { ammo: 3, reserve: 0 }],
  ])('does not start for %s', (_name, slot) => {
    const { room, t, send } = liveDuel();
    t.primary = { id: 'ak47', ...slot };
    t.activeSlot = 1;
    send(t.id, BTN.RELOAD);
    step(room, 2);
    expect(t.reloadEndTick).toBe(0);
  });

  it('does not restart a reload already in progress', () => {
    const { room, t, send } = liveDuel();
    t.primary = { id: 'ak47', ammo: 1, reserve: 90 };
    t.activeSlot = 1;
    t.reloadEndTick = room.tick + 100;
    const end = t.reloadEndTick;
    send(t.id, BTN.RELOAD);
    step(room, 1);
    expect(t.reloadEndTick).toBe(end);
  });

  it('ignores a reload request while holding the knife', () => {
    const { room, t, send } = liveDuel();
    t.activeSlot = 3;
    send(t.id, BTN.RELOAD);
    step(room, 2);
    expect(t.reloadEndTick).toBe(0);
  });
});

describe('flashbang', () => {
  function throwFlash(landAt: { x: number; y: number }) {
    const d = liveDuel();
    d.t.pos = { x: 300, y: 150 };
    d.t.nades = ['flash'];
    d.send(d.t.id, 0, { w: 4 });
    step(d.room, 1);
    d.send(d.t.id, BTN.ATTACK);
    step(d.room, 1);
    const nade = [...guts(d.room).activeNades.values()][0];
    expect(nade).toBeDefined();
    nade.pos = { ...landAt };
    nade.vel = { x: 0, y: 0 };
    nade.fuseTick = d.room.tick + 1;
    return d;
  }

  const blindFor = (aim: number, x = 380): number => {
    const d = throwFlash({ x: 330, y: 150 });
    d.ct.pos = { x, y: 150 };
    d.ct.aim = aim;
    step(d.room, 3);
    return d.ct.blindUntilTick;
  };

  it('blinds a player looking at the pop and announces it', () => {
    const d = throwFlash({ x: 330, y: 150 });
    d.ct.pos = { x: 380, y: 150 };
    d.ct.aim = Math.PI; // facing the flash
    step(d.room, 3);
    expect(d.ct.blindUntilTick).toBeGreaterThan(d.room.tick);
    step(d.room, 2);
    expect(events(d.rec.msgs)).toContainEqual({ e: 'flash_pop', x: 330, y: 150 });
  });

  it('blinds a player facing away for a shorter time', () => {
    const facing = blindFor(Math.PI);
    const away = blindFor(0);
    expect(away).toBeGreaterThan(0);
    expect(away).toBeLessThan(facing);
  });

  it('does not blind a player beyond flash range', () => {
    expect(blindFor(Math.PI, 330 + 600)).toBe(0);
  });
});

describe('fire zones', () => {
  it('expire once their time is up and bump the version so bots repath', () => {
    const { room, t } = liveDuel();
    guts(room).fires.set(1, { id: 1, kind: 'fire', pos: { x: 5000, y: 5000 }, untilTick: room.tick + 2, ownerId: t.id, ownerTeam: 'T' });
    const before = room.fireInfo.version;
    step(room, 4);
    expect(guts(room).fires.size).toBe(0);
    expect(room.fireInfo.version).toBeGreaterThan(before);
  });
});

describe('warmup deaths and match end', () => {
  it('schedules a respawn when someone dies during warmup', () => {
    const { room, t, ct } = liveDuel();
    room.phase = 'waiting';
    guts(room).onKill(t, ct, getWeapon('ak47'));
    expect(ct.alive).toBe(false);
    expect(ct.respawnTick).toBeGreaterThan(room.tick);
  });

  it('does not schedule a respawn for a death in a live round', () => {
    const { room, t, ct } = liveDuel();
    guts(room).onKill(t, ct, getWeapon('ak47'));
    expect(ct.respawnTick).toBe(0);
  });

  it('resets the scoreboard once the match-end screen has run its course', () => {
    const { room } = liveDuel();
    room.phase = 'match_end';
    guts(room).phaseEndTick = room.tick + 2;
    room.score = { T: 16, CT: 4 };
    step(room, 1);
    expect(room.phase).toBe('match_end');
    expect(room.score).toEqual({ T: 16, CT: 4 });
    step(room, 3);
    expect(room.score).toEqual({ T: 0, CT: 0 }); // reset; both teams are still present, so a fresh match starts at once
    expect(room.phase).not.toBe('match_end');
  });
});

describe('defusing speed', () => {
  function defuseTicks(withKit: boolean): number {
    const { room, t, ct, send } = liveDuel();
    t.pos = { ...room.map.siteCenters.A! };
    stepUntil(room, () => { send(t.id, BTN.USE); return room.phase === 'planted'; }, 200);
    ct.hasKit = withKit;
    ct.pos = { ...room.bombInfo.pos };
    const start = room.tick;
    stepUntil(room, () => { send(ct.id, BTN.USE); return room.phase === 'round_end'; }, 400);
    return room.tick - start;
  }

  it('is faster with a kit', () => {
    expect(defuseTicks(true)).toBeLessThan(defuseTicks(false));
  });
});
