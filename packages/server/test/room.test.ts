import { describe, expect, it } from 'vitest';
import type { WebSocket } from 'ws';
import { BTN, MOLOTOV_DPS, OT_MONEY, PICKUP_RADIUS, TICK_DT, type GameEvent, type SnapshotMsg, type TeamId } from '@cs2d/shared';
import { Room, type PlayerConn } from '../src/room.js';

// Fast timings (seconds); sec() rounds to ticks: freeze=3, plant=6, defuse=12, roundEnd=6, bomb=60.
const FAST = { freeze: 0.05, round: 5, bomb: 1, plant: 0.1, defuse: 0.2, defuseKit: 0.1, roundEnd: 0.1 };

/** Private internals the tests poke at (TS `private` is compile-time only). */
interface NadeLike {
  id: number;
  kind: string;
  pos: { x: number; y: number };
  vel: { x: number; y: number };
  fuseTick: number;
  bornTick: number;
  ownerId: number;
  ownerTeam: TeamId;
}

interface RoomInternals {
  step(): void;
  startRound(): void;
  streaks: { T: number; CT: number };
  fires: Map<number, { id: number; kind: string; pos: { x: number; y: number }; untilTick: number; ownerId: number; ownerTeam: TeamId }>;
  activeNades: Map<number, NadeLike>;
  smokes: Map<number, unknown>;
  groundItems: Map<number, { weaponId: string }>;
  bomb: { mode: string; pos: { x: number; y: number }; carrierId: number; explodeTick: number };
  phaseEndTick: number;
  roundNumber: number;
  afterRoundEnd(): void;
}

const guts = (r: Room): RoomInternals => r as unknown as RoomInternals;
const step = (r: Room, n = 1): void => {
  for (let i = 0; i < n; i++) guts(r).step();
};
const stepUntil = (r: Room, cond: () => boolean, cap = 800): void => {
  for (let i = 0; i < cap && !cond(); i++) guts(r).step();
  if (!cond()) throw new Error('stepUntil: condition not reached');
};

/** Fake websocket that records every server message (for event assertions). */
function fakeWs(): { msgs: Array<Record<string, unknown>>; ws: WebSocket } {
  const msgs: Array<Record<string, unknown>> = [];
  return { msgs, ws: { send: (raw: string) => msgs.push(JSON.parse(raw)) } as unknown as WebSocket };
}

const killEvents = (msgs: Array<Record<string, unknown>>): Array<Extract<GameEvent, { e: 'kill' }>> =>
  msgs
    .filter((m): m is Record<string, unknown> & SnapshotMsg => m.t === 's')
    .flatMap((m) => m.ev ?? [])
    .filter((ev): ev is Extract<GameEvent, { e: 'kill' }> => ev.e === 'kill');

/** Per-room input feeder with automatic sequence numbers. */
function feeder(room: Room) {
  const seqs = new Map<number, number>();
  return (id: number, b: number, extra: { a?: number; w?: number } = {}): void => {
    const s = (seqs.get(id) ?? 0) + 1;
    seqs.set(id, s);
    room.handleInput(id, { t: 'i', s, b, a: extra.a ?? 0, ...(extra.w !== undefined ? { w: extra.w } : {}) });
  };
}

function liveRoom(): { room: Room; send: ReturnType<typeof feeder> } {
  const room = new Room('testarena', FAST);
  return { room, send: feeder(room) };
}

const plantBomb = (room: Room, send: ReturnType<typeof feeder>, t: PlayerConn): void => {
  t.pos = { ...room.map.siteCenters.A };
  stepUntil(
    room,
    () => {
      send(t.id, BTN.USE);
      return room.phase === 'planted';
    },
    60,
  );
};

describe('round flow', () => {
  it('post-plant: killing all Ts does not end the round; the bomb resolves it', () => {
    const { room, send } = liveRoom();
    const t = room.addPlayer(null, 'T1', 'T');
    room.addPlayer(null, 'CT1', 'CT');
    stepUntil(room, () => room.phase === 'live');

    expect(t.hasBomb).toBe(true); // sole T carries
    plantBomb(room, send, t);

    t.hp = 0;
    t.alive = false;
    step(room, 5);
    expect(room.phase).toBe('planted'); // Ts dead, round still running

    stepUntil(room, () => room.phase === 'round_end');
    expect(room.score.T).toBe(1); // detonation = T win
  });

  it('defuse ends the round for CT and clears the bomb', () => {
    const { room, send } = liveRoom();
    const t = room.addPlayer(null, 'T1', 'T');
    const ct = room.addPlayer(null, 'CT1', 'CT');
    stepUntil(room, () => room.phase === 'live');
    plantBomb(room, send, t);

    ct.pos = { ...guts(room).bomb.pos };
    stepUntil(
      room,
      () => {
        send(ct.id, BTN.USE);
        return room.phase === 'round_end';
      },
      60,
    );
    expect(room.score.CT).toBe(1);
    expect(guts(room).bomb.mode).toBe('none'); // no lingering planted bomb on screen
  });

  it('losers still alive when time expires receive no loss bonus', () => {
    const { room } = liveRoom();
    const tAlive = room.addPlayer(null, 'T1', 'T');
    const tDead = room.addPlayer(null, 'T2', 'T');
    room.addPlayer(null, 'CT1', 'CT');
    stepUntil(room, () => room.phase === 'live');

    tDead.hp = 0;
    tDead.alive = false;
    const aliveMoney = tAlive.money;
    const deadMoney = tDead.money;

    guts(room).phaseEndTick = room.tick + 1; // expire the round timer now
    stepUntil(room, () => room.phase === 'round_end', 10);

    expect(tAlive.money).toBe(aliveMoney); // saved = $0
    expect(tDead.money).toBe(deadMoney + 1400); // first-loss bonus
  });

  it('defuse kit is lost on death; loss streaks reset and sides swap on the halftime pistol round', () => {
    const { room } = liveRoom();
    const t = room.addPlayer(null, 'T1', 'T');
    const ct = room.addPlayer(null, 'CT1', 'CT');
    stepUntil(room, () => room.phase === 'live');

    ct.hasKit = true;
    ct.hp = 0;
    ct.alive = false; // CT eliminated -> round ends, next round starts
    stepUntil(room, () => room.phase === 'freeze' && guts(room).roundNumber === 2);
    expect(ct.hasKit).toBe(false);

    guts(room).roundNumber = 12;
    guts(room).streaks = { T: 4, CT: 1 };
    room.score = { T: 9, CT: 3 };
    guts(room).startRound(); // halftime pistol (round 13)
    expect(guts(room).streaks).toEqual({ T: 0, CT: 0 });
    expect(t.team).toBe('CT'); // players swap sides...
    expect(ct.team).toBe('T');
    expect(room.score).toEqual({ T: 3, CT: 9 }); // ...and scores follow the side, not the player
  });
});

describe('utility friendly fire & attribution', () => {
  it('HE spares teammates, damages enemies and self, credits the thrower', () => {
    const { room, send } = liveRoom();
    const wsRec = fakeWs();
    const thrower = room.addPlayer(wsRec.ws, 'A', 'T');
    const mate = room.addPlayer(null, 'B', 'T');
    const victim = room.addPlayer(null, 'X', 'CT');
    const bystander = room.addPlayer(null, 'Y', 'CT'); // keeps the round alive
    stepUntil(room, () => room.phase === 'live');

    thrower.pos = { x: 300, y: 150 };
    mate.pos = { x: 330, y: 150 }; // dead center of the blast
    victim.pos = { x: 360, y: 150 };
    victim.hp = 5;
    bystander.pos = { x: 700, y: 320 }; // outside HE radius

    thrower.nades = ['he'];
    send(thrower.id, 0, { w: 4 });
    step(room, 1);
    send(thrower.id, BTN.ATTACK);
    step(room, 1);

    const nade = [...guts(room).activeNades.values()][0];
    expect(nade).toBeDefined();
    nade.pos = { x: 330, y: 150 };
    nade.vel = { x: 0, y: 0 };
    nade.fuseTick = room.tick + 1;
    const moneyBefore = thrower.money;
    step(room, 3);

    expect(mate.hp).toBe(100); // friendly fire off: teammate untouched
    expect(thrower.hp).toBeLessThan(100); // self-damage stays (CS behavior)
    expect(victim.alive).toBe(false);
    expect(thrower.kills).toBe(1);
    expect(thrower.money).toBe(moneyBefore + 300);

    const kills = killEvents(wsRec.msgs);
    expect(kills).toContainEqual({ e: 'kill', k: thrower.id, v: victim.id, w: 'he' });
  });

  it('fire spares the thrower team and never stacks across overlapping zones', () => {
    const { room } = liveRoom();
    const t = room.addPlayer(null, 'T1', 'T');
    const ct = room.addPlayer(null, 'CT1', 'CT');
    const owner = room.addPlayer(null, 'CT2', 'CT');
    stepUntil(room, () => room.phase === 'live');

    const pos = { x: 300, y: 150 };
    t.pos = { ...pos };
    ct.pos = { ...pos }; // non-owner teammate standing in the owner's fire
    owner.pos = { x: 700, y: 320 }; // thrower, outside his own fire
    const until = room.tick + 600;
    guts(room).fires.set(101, { id: 101, kind: 'incendiary', pos: { ...pos }, untilTick: until, ownerId: owner.id, ownerTeam: 'CT' });
    guts(room).fires.set(102, { id: 102, kind: 'incendiary', pos: { ...pos }, untilTick: until, ownerId: owner.id, ownerTeam: 'CT' });

    step(room, 1);
    expect(ct.hp).toBe(100); // FF off: teammate not burned
    expect(t.hp).toBeCloseTo(100 - MOLOTOV_DPS * TICK_DT, 5); // exactly one zone's tick, not two
  });
});

describe('gameplay features', () => {
  it('helmet strengthens armor against the same blast', () => {
    const { room } = liveRoom();
    const t = room.addPlayer(null, 'T1', 'T');
    const bare = room.addPlayer(null, 'CT1', 'CT');
    const helmeted = room.addPlayer(null, 'CT2', 'CT');
    stepUntil(room, () => room.phase === 'live');

    bare.armor = 100;
    helmeted.armor = 100;
    helmeted.hasHelmet = true;
    bare.pos = { x: 300, y: 150 };
    helmeted.pos = { x: 300, y: 200 }; // both 25px from the blast center

    guts(room).activeNades.set(999, {
      id: 999, kind: 'he', pos: { x: 300, y: 175 }, vel: { x: 0, y: 0 },
      fuseTick: room.tick + 1, bornTick: room.tick, ownerId: t.id, ownerTeam: 'T',
    });
    step(room, 2);

    expect(bare.hp).toBeLessThan(100);
    expect(helmeted.hp).toBeGreaterThan(bare.hp);
  });

  it('G drops the held gun; E picks up primaries and pistols', () => {
    const { room, send } = liveRoom();
    const a = room.addPlayer(null, 'A', 'T');
    const b = room.addPlayer(null, 'B', 'T');
    room.addPlayer(null, 'CT1', 'CT');
    stepUntil(room, () => room.phase === 'live');

    a.primary = { id: 'ak47', ammo: 30, reserve: 90 };
    a.activeSlot = 1;
    b.pos = { ...a.pos };

    send(a.id, BTN.DROP);
    step(room, 1);
    expect(a.primary).toBeNull();
    expect(a.activeSlot).toBe(2); // falls back to the pistol
    expect([...guts(room).groundItems.values()][0]?.weaponId).toBe('ak47');

    send(b.id, BTN.USE);
    step(room, 1);
    expect(b.primary?.id).toBe('ak47');

    send(a.id, 0); // release G so the next press is a fresh edge
    step(room, 1);
    send(a.id, BTN.DROP); // now drop the pistol — knife remains
    step(room, 1);
    expect(a.secondary).toBeNull();
    expect(a.activeSlot).toBe(3);

    b.secondary = null;
    send(b.id, BTN.USE);
    step(room, 1);
    expect(b.secondary?.id).toBe('glock'); // pistols are picked up too
  });

  it('pressing 4 while holding a grenade cycles the carried nades', () => {
    const { room, send } = liveRoom();
    const t = room.addPlayer(null, 'T1', 'T');
    room.addPlayer(null, 'CT1', 'CT');
    stepUntil(room, () => room.phase === 'live');

    t.nades = ['smoke', 'flash', 'he'];
    send(t.id, 0, { w: 4 }); // draw the grenade slot (no rotation)
    step(room, 1);
    expect(t.nades).toEqual(['smoke', 'flash', 'he']);

    send(t.id, 0, { w: 4 }); // already on slot 4: cycle
    step(room, 1);
    expect(t.nades).toEqual(['flash', 'he', 'smoke']);

    send(t.id, BTN.ATTACK); // throws the cycled-to front nade
    step(room, 1);
    expect([...guts(room).activeNades.values()][0]?.kind).toBe('flash');
    expect(t.nades).toEqual(['he', 'smoke']);
  });

  it('a survivor with no pistol keeps their primary and gets a fresh pistol next round', () => {
    const { room } = liveRoom();
    const a = room.addPlayer(null, 'A', 'T');
    const ct = room.addPlayer(null, 'CT1', 'CT');
    stepUntil(room, () => room.phase === 'live');

    a.primary = { id: 'ak47', ammo: 30, reserve: 90 };
    a.activeSlot = 1;
    a.secondary = null; // dropped the pistol earlier in the round

    ct.hp = 0;
    ct.alive = false; // T wins by elimination; A survives into round 2
    stepUntil(room, () => room.phase === 'freeze' && guts(room).roundNumber === 2);

    expect(a.primary?.id).toBe('ak47'); // rifle survives the round
    expect(a.secondary?.id).toBe('glock'); // missing pistol restocked
    expect(a.activeSlot).toBe(1);
  });

  it('death drops both carried guns, not just the primary', () => {
    const { room } = liveRoom();
    const victim = room.addPlayer(null, 'V', 'T');
    room.addPlayer(null, 'T2', 'T');
    const owner = room.addPlayer(null, 'CT1', 'CT');
    stepUntil(room, () => room.phase === 'live');

    victim.primary = { id: 'ak47', ammo: 30, reserve: 90 };
    victim.secondary = { id: 'deagle', ammo: 7, reserve: 35 };
    victim.hp = 0.4; // one fire tick kills
    guts(room).fires.set(201, {
      id: 201, kind: 'molotov', pos: { ...victim.pos }, untilTick: room.tick + 600,
      ownerId: owner.id, ownerTeam: 'CT',
    });
    step(room, 1);

    expect(victim.alive).toBe(false);
    const dropped = [...guts(room).groundItems.values()].map((g) => g.weaponId).sort();
    expect(dropped).toEqual(['ak47', 'deagle']);
  });

  it('smoke blooms where it rests instead of on a mid-flight timer', () => {
    const { room, send } = liveRoom();
    const t = room.addPlayer(null, 'T1', 'T');
    room.addPlayer(null, 'CT1', 'CT');
    stepUntil(room, () => room.phase === 'live');

    t.pos = { x: 150, y: 150 };
    t.nades = ['smoke'];
    send(t.id, 0, { w: 4 });
    step(room, 1);
    send(t.id, BTN.ATTACK); // thrown rightward across open ground
    step(room, 1);

    step(room, 135); // 2.25s: the old 2s fuse would already have popped
    expect(guts(room).smokes.size).toBe(0); // still sliding
    step(room, 90); // past rest / hard cap
    expect(guts(room).smokes.size).toBe(1);
  });

  it('molotov ignites on wall impact, long before any fuse', () => {
    const { room, send } = liveRoom();
    const t = room.addPlayer(null, 'T1', 'T');
    room.addPlayer(null, 'CT1', 'CT');
    stepUntil(room, () => room.phase === 'live');

    t.pos = { x: 64, y: 150 }; // one tile from the west wall
    t.nades = ['molotov'];
    send(t.id, 0, { w: 4 });
    step(room, 1);
    send(t.id, BTN.ATTACK, { a: Math.PI }); // hurl it straight at the wall
    step(room, 1);

    step(room, 15); // impact after ~4 ticks; old fuse was 96 ticks
    expect(guts(room).fires.size).toBe(1);
  });
});

describe('reload interruption', () => {
  it('is cancelled by switching weapon slots', () => {
    const { room, send } = liveRoom();
    const t = room.addPlayer(null, 'T1', 'T');
    room.addPlayer(null, 'CT1', 'CT');
    stepUntil(room, () => room.phase === 'live');

    t.primary = { id: 'ak47', ammo: 0, reserve: 90 };
    t.activeSlot = 1;
    t.reloadEndTick = room.tick + 500;

    send(t.id, 0, { w: 3 }); // switch to knife
    step(room, 1);
    expect(t.activeSlot).toBe(3);
    expect(t.reloadEndTick).toBe(0);
  });

  it('is cancelled by dropping the active weapon', () => {
    const { room, send } = liveRoom();
    const t = room.addPlayer(null, 'T1', 'T');
    room.addPlayer(null, 'CT1', 'CT');
    stepUntil(room, () => room.phase === 'live');

    t.primary = { id: 'ak47', ammo: 0, reserve: 90 };
    t.activeSlot = 1;
    t.reloadEndTick = room.tick + 500;

    send(t.id, BTN.DROP);
    step(room, 1);
    expect(t.primary).toBeNull();
    expect(t.reloadEndTick).toBe(0);
  });

  it('is cancelled by buying a replacement weapon', () => {
    const { room } = liveRoom();
    const t = room.addPlayer(null, 'T1', 'T');
    room.addPlayer(null, 'CT1', 'CT');
    stepUntil(room, () => room.phase === 'freeze'); // buy window: freeze + in buyzone (spawn)

    t.primary = { id: 'ak47', ammo: 0, reserve: 90 };
    t.activeSlot = 1;
    t.reloadEndTick = room.tick + 500;
    t.money = 3000;

    room.handleBuy(t.id, 'galil'); // T-exclusive rifle
    expect(t.primary?.id).toBe('galil');
    expect(t.reloadEndTick).toBe(0);
  });
});

describe('plant/defuse interruption', () => {
  it('releasing USE mid-plant resets progress to zero', () => {
    const { room, send } = liveRoom();
    const t = room.addPlayer(null, 'T1', 'T');
    room.addPlayer(null, 'CT1', 'CT');
    stepUntil(room, () => room.phase === 'live');

    t.pos = { ...room.map.siteCenters.A };
    send(t.id, BTN.USE);
    step(room, 1);
    expect(t.actionStartTick).toBeGreaterThan(0);

    send(t.id, 0); // release USE
    step(room, 1);
    expect(t.actionStartTick).toBe(0);
  });

  it('moving mid-defuse resets progress to zero', () => {
    const { room, send } = liveRoom();
    const t = room.addPlayer(null, 'T1', 'T');
    const ct = room.addPlayer(null, 'CT1', 'CT');
    stepUntil(room, () => room.phase === 'live');
    plantBomb(room, send, t);

    ct.pos = { ...guts(room).bomb.pos };
    send(ct.id, BTN.USE);
    step(room, 1);
    expect(ct.actionStartTick).toBeGreaterThan(0);

    send(ct.id, BTN.USE | BTN.RIGHT); // moving while still holding USE
    step(room, 1);
    expect(ct.actionStartTick).toBe(0);
  });

  it('rejects planting off-site regardless of how long USE is held', () => {
    const { room, send } = liveRoom();
    const t = room.addPlayer(null, 'T1', 'T');
    room.addPlayer(null, 'CT1', 'CT');
    stepUntil(room, () => room.phase === 'live');

    t.pos = { x: 3.5 * 32, y: 3.5 * 32 }; // T spawn area, not site A
    for (let i = 0; i < 20; i++) {
      send(t.id, BTN.USE);
      step(room, 1);
    }
    expect(room.phase).toBe('live'); // never transitions to planted
    expect(t.actionStartTick).toBe(0);
  });
});

describe('bomb carrier lifecycle', () => {
  it('drops where the carrier died', () => {
    const { room } = liveRoom();
    const t = room.addPlayer(null, 'T1', 'T');
    const owner = room.addPlayer(null, 'CT1', 'CT');
    stepUntil(room, () => room.phase === 'live');

    expect(t.hasBomb).toBe(true); // sole T carries
    t.pos = { x: 222, y: 111 };
    t.hp = 0.4; // one fire tick kills
    guts(room).fires.set(301, {
      id: 301, kind: 'molotov', pos: { ...t.pos }, untilTick: room.tick + 600,
      ownerId: owner.id, ownerTeam: 'CT',
    });
    step(room, 1);

    expect(t.alive).toBe(false);
    expect(t.hasBomb).toBe(false);
    expect(guts(room).bomb.mode).toBe('dropped');
    expect(guts(room).bomb.pos).toEqual({ x: 222, y: 111 });
  });

  it('is only picked up by a nearby, alive T player', () => {
    const { room } = liveRoom();
    const otherT = room.addPlayer(null, 'T2', 'T');
    const ct = room.addPlayer(null, 'CT1', 'CT');
    stepUntil(room, () => room.phase === 'live');

    otherT.hasBomb = false;
    guts(room).bomb = { mode: 'dropped', pos: { x: 500, y: 200 }, carrierId: 0, explodeTick: 0 };

    ct.pos = { ...guts(room).bomb.pos }; // wrong team, right on top
    step(room, 1);
    expect(guts(room).bomb.mode).toBe('dropped');

    otherT.pos = { x: guts(room).bomb.pos.x + PICKUP_RADIUS + 10, y: guts(room).bomb.pos.y }; // right team, out of range
    step(room, 1);
    expect(guts(room).bomb.mode).toBe('dropped');

    otherT.pos = { x: guts(room).bomb.pos.x + PICKUP_RADIUS - 1, y: guts(room).bomb.pos.y }; // right team, in range
    step(room, 1);
    expect(guts(room).bomb.mode).toBe('carried');
    expect(otherT.hasBomb).toBe(true);
  });
});

describe('match arc', () => {
  it('overtime half start resets everyone to OT money', () => {
    const { room } = liveRoom();
    const t = room.addPlayer(null, 'T1', 'T');
    const ct = room.addPlayer(null, 'CT1', 'CT');
    stepUntil(room, () => room.phase === 'live');

    t.money = 500;
    ct.money = 16000;
    guts(room).roundNumber = 24;
    guts(room).startRound(); // OT1 half start (round 25)

    expect(t.money).toBe(OT_MONEY);
    expect(ct.money).toBe(OT_MONEY);
  });

  it('match_end fires and the phase locks once a team reaches the win target', () => {
    const { room } = liveRoom();
    const wsRec = fakeWs();
    room.addPlayer(wsRec.ws, 'T1', 'T');
    room.addPlayer(null, 'CT1', 'CT');
    stepUntil(room, () => room.phase === 'live');

    room.score = { T: 13, CT: 5 }; // T already at ROUNDS_TO_WIN
    guts(room).afterRoundEnd();
    step(room, 2); // flush the snapshot so the emitted event reaches the client

    expect(room.phase).toBe('match_end');
    const matchEndEvents = wsRec.msgs
      .filter((m): m is Record<string, unknown> & SnapshotMsg => m.t === 's')
      .flatMap((m) => m.ev ?? []);
    expect(matchEndEvents).toContainEqual({ e: 'match_end', winner: 'T' });
  });

  it('emptying one team resets the match to warmup', () => {
    const { room } = liveRoom();
    const t = room.addPlayer(null, 'T1', 'T');
    const ct = room.addPlayer(null, 'CT1', 'CT');
    stepUntil(room, () => room.phase === 'live');

    room.score = { T: 5, CT: 3 };
    t.nades = ['smoke'];
    room.removePlayer(ct.id);
    step(room, 1); // the abandoned-match guard runs at the top of the next step()

    expect(room.phase).toBe('waiting');
    expect(room.score).toEqual({ T: 0, CT: 0 });
    expect(t.nades).toEqual([]);
    expect(t.alive).toBe(true);
  });
});

describe('team balance', () => {
  it('pickTeam assigns unrequested players to the smaller team, ties favoring T', () => {
    const { room } = liveRoom();
    room.addPlayer(null, 'A', 'T');
    room.addPlayer(null, 'B', 'T');
    const c = room.addPlayer(null, 'C'); // no requested team: T=2, CT=0 -> CT
    expect(c.team).toBe('CT');

    const d = room.addPlayer(null, 'D'); // T=2, CT=1 -> still CT
    expect(d.team).toBe('CT');

    const e = room.addPlayer(null, 'E'); // T=2, CT=2 -> tie goes to T
    expect(e.team).toBe('T');
  });
});
