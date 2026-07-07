import { describe, expect, it } from 'vitest';
import { PRICE_DEFUSE_KIT, PRICE_HELMET, PRICE_KEVLAR } from '@cs2d/shared';
import { Room } from '../src/room.js';

// Fast timings (seconds); sec() rounds to ticks. Mirrors room.test.ts's FAST.
const FAST = { freeze: 0.05, round: 5, bomb: 1, plant: 0.1, defuse: 0.2, defuseKit: 0.1, roundEnd: 0.1 };
// BUY_WINDOW (20s = 1200 ticks) is a fixed constant, not scaled by timings —
// only the "buy window elapses" test needs a round long enough to stay live
// past it; every other buy test uses FAST.
const LONG_LIVE = { ...FAST, round: 30 };

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

function liveRoom(timings = FAST): Room {
  return new Room('testarena', timings);
}

describe('handleBuy: window & buyzone gating', () => {
  it('rejects a buy while outside the buyzone', () => {
    const room = liveRoom();
    const t = room.addPlayer(null, 'T1', 'T');
    room.addPlayer(null, 'CT1', 'CT');
    stepUntil(room, () => room.phase === 'freeze');

    t.pos = { x: t.pos.x + 1000, y: t.pos.y }; // well outside BUYZONE_RADIUS_TILES (7 tiles = 224px)
    const money = t.money;
    room.handleBuy(t.id, 'kevlar');
    expect(t.money).toBe(money);
    expect(t.armor).toBe(0);
  });

  it('allows a buy in the buyzone during freeze', () => {
    const room = liveRoom();
    const t = room.addPlayer(null, 'T1', 'T');
    room.addPlayer(null, 'CT1', 'CT');
    stepUntil(room, () => room.phase === 'freeze'); // t.pos is still its spawn, inside the buyzone

    room.handleBuy(t.id, 'kevlar');
    expect(t.armor).toBe(100);
  });

  it('rejects a buy once BUY_WINDOW has elapsed during live', () => {
    const room = liveRoom(LONG_LIVE);
    const t = room.addPlayer(null, 'T1', 'T');
    room.addPlayer(null, 'CT1', 'CT');
    stepUntil(room, () => room.phase === 'live');

    step(room, 1201); // BUY_WINDOW = 20s = 1200 ticks, fixed regardless of timings
    const money = t.money;
    room.handleBuy(t.id, 'kevlar');
    expect(t.money).toBe(money);
    expect(t.armor).toBe(0);
  });
});

describe('handleBuy: armor', () => {
  it('kevlar requires enough money and sets armor to 100', () => {
    const room = liveRoom();
    const t = room.addPlayer(null, 'T1', 'T');
    room.addPlayer(null, 'CT1', 'CT');
    stepUntil(room, () => room.phase === 'freeze');

    t.money = PRICE_KEVLAR - 1;
    room.handleBuy(t.id, 'kevlar');
    expect(t.armor).toBe(0); // too poor

    t.money = PRICE_KEVLAR;
    room.handleBuy(t.id, 'kevlar');
    expect(t.armor).toBe(100);
    expect(t.money).toBe(0);
  });

  it('helmet requires kevlar (armor>0) first', () => {
    const room = liveRoom();
    const t = room.addPlayer(null, 'T1', 'T');
    room.addPlayer(null, 'CT1', 'CT');
    stepUntil(room, () => room.phase === 'freeze');

    t.money = PRICE_HELMET;
    room.handleBuy(t.id, 'helmet');
    expect(t.hasHelmet).toBe(false); // no armor yet

    t.armor = 100;
    room.handleBuy(t.id, 'helmet');
    expect(t.hasHelmet).toBe(true);
    expect(t.money).toBe(0);
  });
});

describe('handleBuy: defuse kit', () => {
  it('is CT-exclusive', () => {
    const room = liveRoom();
    const t = room.addPlayer(null, 'T1', 'T');
    const ct = room.addPlayer(null, 'CT1', 'CT');
    stepUntil(room, () => room.phase === 'freeze');

    t.money = PRICE_DEFUSE_KIT;
    room.handleBuy(t.id, 'kit');
    expect(t.hasKit).toBe(false); // T cannot buy a kit

    ct.money = PRICE_DEFUSE_KIT;
    room.handleBuy(ct.id, 'kit');
    expect(ct.hasKit).toBe(true);
    expect(ct.money).toBe(0);
  });
});

describe('handleBuy: grenades', () => {
  it('caps total carried grenades at GRENADE_MAX_TOTAL regardless of mix', () => {
    const room = liveRoom();
    const t = room.addPlayer(null, 'T1', 'T');
    room.addPlayer(null, 'CT1', 'CT');
    stepUntil(room, () => room.phase === 'freeze');
    t.money = 16000;

    room.handleBuy(t.id, 'smoke');
    room.handleBuy(t.id, 'flash');
    room.handleBuy(t.id, 'flash'); // flash maxCarry is 2
    room.handleBuy(t.id, 'he');
    expect(t.nades).toEqual(['smoke', 'flash', 'flash', 'he']); // 4 = GRENADE_MAX_TOTAL

    const moneyBefore = t.money;
    room.handleBuy(t.id, 'molotov'); // T-exclusive, but the total cap blocks it first
    expect(t.nades).toHaveLength(4);
    expect(t.money).toBe(moneyBefore);
  });

  it('caps per-type carry at maxCarry (flash: 2)', () => {
    const room = liveRoom();
    const t = room.addPlayer(null, 'T1', 'T');
    room.addPlayer(null, 'CT1', 'CT');
    stepUntil(room, () => room.phase === 'freeze');
    t.money = 16000;

    room.handleBuy(t.id, 'flash');
    room.handleBuy(t.id, 'flash');
    expect(t.nades).toEqual(['flash', 'flash']);

    const moneyBefore = t.money;
    room.handleBuy(t.id, 'flash'); // 3rd flash rejected
    expect(t.nades).toEqual(['flash', 'flash']);
    expect(t.money).toBe(moneyBefore);
  });

  it('ignores an unknown item id without throwing or changing state', () => {
    const room = liveRoom();
    const t = room.addPlayer(null, 'T1', 'T');
    room.addPlayer(null, 'CT1', 'CT');
    stepUntil(room, () => room.phase === 'freeze');
    const money = t.money;

    expect(() => room.handleBuy(t.id, 'bazooka')).not.toThrow();
    expect(t.money).toBe(money);
    expect(t.nades).toHaveLength(0);
    expect(t.primary).toBeNull();
  });
});

describe('handleBuy: weapons', () => {
  it('deducts money, sets the primary slot active, and clears any pending reload', () => {
    const room = liveRoom();
    const t = room.addPlayer(null, 'T1', 'T');
    room.addPlayer(null, 'CT1', 'CT');
    stepUntil(room, () => room.phase === 'freeze');
    t.money = 3000;
    t.reloadEndTick = 999; // simulate a reload in progress on the old weapon

    room.handleBuy(t.id, 'ak47');
    expect(t.primary?.id).toBe('ak47');
    expect(t.money).toBe(3000 - 2700);
    expect(t.activeSlot).toBe(1);
    expect(t.reloadEndTick).toBe(0);
  });
});
