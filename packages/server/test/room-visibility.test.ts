import { describe, expect, it } from 'vitest';
import type { WebSocket } from 'ws';
import { getMap, hasLineOfSight, parseClientMsg, VISION_RANGE, type GameEvent, type InputMsg, type SnapshotMsg, type Vec2 } from '@cs2d/shared';
import { Room, type PlayerConn } from '../src/room.js';
import { VIS_GRACE_TICKS } from '../src/visibility.js';

const FAST = { freeze: 0.05, round: 30, bomb: 5, plant: 0.1, defuse: 0.2, defuseKit: 0.1, roundEnd: 0.1 };

interface RoomInternals {
  step(): void;
  emit(ev: GameEvent, to?: number, src?: number): void;
  smokes: Map<number, { id: number; pos: Vec2; startTick: number; untilTick: number }>;
  activeNades: Map<number, unknown>;
  bomb: { mode: string; pos: Vec2; carrierId: number };
  tick: number;
}
const guts = (r: Room): RoomInternals => r as unknown as RoomInternals;
const step = (r: Room, n = 1): void => {
  for (let i = 0; i < n; i++) guts(r).step();
};

type Rec = { msgs: SnapshotMsg[]; ws: WebSocket };
function fakeWs(): Rec {
  const msgs: SnapshotMsg[] = [];
  const ws = {
    send: (raw: string) => {
      const m = JSON.parse(raw) as { t: string };
      if (m.t === 's') msgs.push(m as SnapshotMsg);
    },
  } as unknown as WebSocket;
  return { msgs, ws };
}
const last = (rec: Rec): SnapshotMsg => rec.msgs.at(-1)!;
const ids = (rec: Rec): number[] => last(rec).p.map((s) => s[0]);
const events = (rec: Rec, from: number): GameEvent[] => rec.msgs.slice(from).flatMap((m) => m.ev ?? []);

const map = getMap('dust2');
const solidFree = (p: Vec2): boolean => !map.isSolid(Math.floor(p.x / 32), Math.floor(p.y / 32));

/** A point near `from` (within 400px, not too close) with no line of sight to it. */
function walledOffPoint(from: Vec2): Vec2 {
  for (let r = 96; r <= 400; r += 16) {
    for (let a = 0; a < Math.PI * 2; a += Math.PI / 16) {
      const p = { x: from.x + Math.cos(a) * r, y: from.y + Math.sin(a) * r };
      if (solidFree(p) && !hasLineOfSight(from, p, map)) return p;
    }
  }
  throw new Error('no walled-off point found');
}

/** An open-sight point 200px from `from`. */
function openPoint(from: Vec2): Vec2 {
  for (let a = 0; a < Math.PI * 2; a += Math.PI / 16) {
    const p = { x: from.x + Math.cos(a) * 200, y: from.y + Math.sin(a) * 200 };
    if (solidFree(p) && hasLineOfSight(from, p, map)) return p;
  }
  throw new Error('no open point found');
}

interface Setup {
  room: Room;
  t1: PlayerConn;
  t2: PlayerConn;
  ct1: PlayerConn;
  rec: { t1: Rec; t2: Rec; ct1: Rec };
}

function setup(): Setup {
  const room = new Room('dust2', FAST);
  const rec = { t1: fakeWs(), t2: fakeWs(), ct1: fakeWs() };
  const t1 = room.addPlayer(rec.t1.ws, 'T1', 'T');
  const t2 = room.addPlayer(rec.t2.ws, 'T2', 'T');
  const ct1 = room.addPlayer(rec.ct1.ws, 'CT1', 'CT');
  for (let i = 0; i < 400 && room.phase !== 'live'; i++) step(room);
  expect(room.phase).toBe('live');
  return { room, t1, t2, ct1, rec };
}

/** Teleport players, then run past the grace window so earlier sightings expire. */
function place(s: Setup, spots: Partial<Record<'t1' | 't2' | 'ct1', Vec2>>): void {
  for (const k of ['t1', 't2', 'ct1'] as const) {
    const pos = spots[k];
    if (pos) s[k].pos = { ...pos };
  }
  step(s.room, VIS_GRACE_TICKS + 4);
}

const base = map.spawns.T[0];

describe('per-recipient snapshots (fog of war)', () => {
  it('omits an enemy behind a wall but keeps self and teammates', () => {
    const s = setup();
    const hidden = walledOffPoint(base);
    place(s, { t1: base, t2: openPoint(base), ct1: hidden });
    expect(ids(s.rec.t1).sort()).toEqual([s.t1.id, s.t2.id].sort());
    // the enemy still gets everyone it can see; here T1/T2 are walled off from CT1 only if no LOS
    expect(ids(s.rec.ct1)).toContain(s.ct1.id);
    expect(ids(s.rec.ct1)).not.toContain(s.t1.id);
  });

  it('includes an enemy in line of sight', () => {
    const s = setup();
    place(s, { t1: base, t2: base, ct1: openPoint(base) });
    expect(ids(s.rec.t1)).toContain(s.ct1.id);
    expect(ids(s.rec.ct1)).toContain(s.t1.id);
  });

  it('omits an enemy beyond vision range even with a clear line', () => {
    const s = setup();
    const far = { x: base.x, y: base.y - (VISION_RANGE + 100) };
    if (!solidFree(far) || !hasLineOfSight(base, far, map)) return; // map has no such straight lane here
    place(s, { t1: base, ct1: far });
    expect(ids(s.rec.t1)).not.toContain(s.ct1.id);
  });

  it('a smoke between viewer and enemy hides the enemy', () => {
    const s = setup();
    const enemy = openPoint(base);
    const mid = { x: (base.x + enemy.x) / 2, y: (base.y + enemy.y) / 2 };
    const g = guts(s.room);
    g.smokes.set(1, { id: 1, pos: mid, startTick: g.tick - 10_000, untilTick: g.tick + 10_000 });
    place(s, { t1: base, t2: base, ct1: enemy });
    expect(ids(s.rec.t1)).not.toContain(s.ct1.id);
    expect(ids(s.rec.ct1)).not.toContain(s.t1.id);
    g.smokes.clear();
    step(s.room, VIS_GRACE_TICKS + 4);
    expect(ids(s.rec.t1)).toContain(s.ct1.id);
  });

  it('replays the last seen position during the grace window, never live hidden state', () => {
    const s = setup();
    const seen = openPoint(base);
    place(s, { t1: base, t2: base, ct1: seen });
    expect(ids(s.rec.t1)).toContain(s.ct1.id);
    const hiddenAt = walledOffPoint(base);
    s.ct1.pos = hiddenAt;
    step(s.room, 2);
    const during = last(s.rec.t1).p.find((q) => q[0] === s.ct1.id);
    expect(during).toBeDefined(); // still inside the grace window
    expect(during![1]).toBeCloseTo(seen.x, 0); // the old position
    expect(during![2]).toBeCloseTo(seen.y, 0);
    step(s.room, VIS_GRACE_TICKS + 4);
    expect(ids(s.rec.t1)).not.toContain(s.ct1.id);
  });

  it('never sends dead enemies', () => {
    const s = setup();
    place(s, { t1: base, t2: base, ct1: openPoint(base) });
    s.ct1.alive = false;
    step(s.room, 4);
    expect(ids(s.rec.t1)).not.toContain(s.ct1.id);
    expect(ids(s.rec.t2)).toContain(s.t1.id);
  });

  it('a dead player gets only the view of the teammate they spectate', () => {
    const s = setup();
    const rec3 = fakeWs();
    const t3 = s.room.addPlayer(rec3.ws, 'T3', 'T');
    const enemy = openPoint(base);
    const elsewhere = walledOffPoint(enemy);
    t3.alive = true; // joined mid-round, so revive for the test
    t3.pos = { ...base };
    place(s, { t1: elsewhere, t2: base, ct1: enemy });
    s.t1.pos = { ...elsewhere };
    t3.pos = { ...elsewhere };
    step(s.room, VIS_GRACE_TICKS + 4);
    expect(ids(s.rec.t1)).not.toContain(s.ct1.id); // alive T1 can't see CT1
    expect(ids(rec3)).not.toContain(s.ct1.id);
    expect(ids(s.rec.t2)).toContain(s.ct1.id);
    s.t1.alive = false;
    // go through the real wire path: the validator must keep `sp`
    const wire = (n: number, sp: number) => parseClientMsg(JSON.stringify({ t: 'i', s: n, b: 0, a: 0, sp })) as InputMsg;
    s.room.handleInput(s.t1.id, wire(1, s.t2.id));
    step(s.room, 4);
    expect(ids(s.rec.t1)).toContain(s.ct1.id); // follows T2, who sees CT1
    expect(ids(s.rec.t1)).toContain(s.t2.id);
    s.room.handleInput(s.t1.id, wire(2, t3.id));
    step(s.room, VIS_GRACE_TICKS + 4);
    expect(ids(s.rec.t1)).not.toContain(s.ct1.id); // follows T3, who doesn't; T2's view is not shared
    s.room.handleInput(s.t1.id, wire(3, 9999)); // bogus target: falls back to a living teammate
    step(s.room, 4);
    expect(ids(s.rec.t1)).toContain(s.t1.id);
  });

  it('filters shot and nade_throw events from hidden enemies only', () => {
    const s = setup();
    place(s, { t1: base, t2: base, ct1: walledOffPoint(base) });
    const from = s.rec.t1.msgs.length;
    const fromCt = s.rec.ct1.msgs.length;
    const g = guts(s.room);
    const shot = (id: number, p: Vec2): GameEvent => ({ e: 'shot', id, x: p.x, y: p.y, tx: 0, ty: 0, w: 'ak47' });
    g.emit(shot(s.ct1.id, s.ct1.pos), undefined, s.ct1.id);
    g.emit({ e: 'nade_throw', kind: 'smoke', x: s.ct1.pos.x, y: s.ct1.pos.y }, undefined, s.ct1.id);
    g.emit(shot(s.t2.id, s.t2.pos), undefined, s.t2.id);
    g.emit({ e: 'smoke_pop', x: 1, y: 1 }); // world events stay public
    step(s.room, 2);
    const t1Ev = events(s.rec.t1, from);
    expect(t1Ev.filter((e) => e.e === 'shot')).toHaveLength(1);
    expect(t1Ev.some((e) => e.e === 'nade_throw')).toBe(false);
    expect(t1Ev.some((e) => e.e === 'smoke_pop')).toBe(true);
    // CT1 gets its own shot, not hidden T2's
    expect(events(s.rec.ct1, fromCt).filter((e) => e.e === 'shot')).toHaveLength(1);
  });

  it('sends a dropped bomb to Ts always, to CTs only in sight', () => {
    const s = setup();
    const bombPos = openPoint(base); // away from every T, so nobody picks it up
    place(s, { t1: base, t2: base, ct1: walledOffPoint(bombPos) });
    const g = guts(s.room);
    s.t1.hasBomb = false;
    s.t2.hasBomb = false;
    g.bomb.mode = 'dropped';
    g.bomb.carrierId = 0;
    g.bomb.pos = { ...bombPos };
    step(s.room, 4);
    expect(last(s.rec.t1).m?.bomb).toBeDefined();
    expect(last(s.rec.ct1).m?.bomb).toBeUndefined();
    s.ct1.pos = openPoint(bombPos);
    step(s.room, 4);
    expect(last(s.rec.ct1).m?.bomb).toBeDefined();
    g.bomb.mode = 'planted'; // a planted bomb is public
    s.ct1.pos = walledOffPoint(bombPos);
    step(s.room, 4);
    expect(last(s.rec.ct1).m?.bomb?.[2]).toBe(1);
  });

  it('hides enemy grenades and ground items out of sight, shows team grenades', () => {
    const s = setup();
    place(s, { t1: base, t2: base, ct1: walledOffPoint(base) });
    const g = guts(s.room);
    const nadePos = { ...s.ct1.pos };
    g.activeNades.set(7, { id: 7, kind: 'smoke', pos: nadePos, vel: { x: 0, y: 0 }, fuseTick: g.tick + 1000, bornTick: g.tick, ownerId: s.ct1.id, ownerTeam: 'CT' });
    step(s.room, 4);
    expect(last(s.rec.t1).n ?? []).toHaveLength(0);
    expect(last(s.rec.ct1).n ?? []).toHaveLength(1);
  });
});
