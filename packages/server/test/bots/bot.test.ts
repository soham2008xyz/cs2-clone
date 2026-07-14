// Structural smoke tests only — bot.ts drives aim/site-pick off bare,
// non-seeded Math.random() (exactly two call sites today: site pick and aim
// jitter). We mock Math.random to a fixed value so results are deterministic,
// but any *new* Math.random() call added to bot.ts will silently desync this
// mock and produce a confusing failure far from its cause. If these tests
// stop being cheap to keep green, cut this file and rely on
// scripts/integration-bots.mjs for bot coverage instead.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { dist, MapBuilder, registerMap, TILE_SIZE, type Vec2 } from '@cs2d/shared';
import { Room } from '../../src/room.js';

interface BombInternals {
  bomb: { mode: string; pos: Vec2; carrierId: number; explodeTick: number };
}
const bombGuts = (r: Room): BombInternals => r as unknown as BombInternals;

const FAST = { freeze: 0.05, round: 20, bomb: 1, plant: 0.1, defuse: 0.2, defuseKit: 0.1, roundEnd: 0.1 };

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

/**
 * An elongated open corridor (no interior walls): T and CT spawns are placed
 * over 1000px apart, well outside VISION_RANGE (900px) — unlike the tiny,
 * fully-open testarena, this guarantees the bot has no visible enemy without
 * resorting to manually faking blindness or LOS-blocking smoke.
 */
function botTestMap(): string {
  const b = new MapBuilder(40, 8);
  b.carve(1, 1, 38, 6);
  b.site('A', 5, 3, 3, 3); // near the T side, reachable, not at spawn
  b.spawn('T', 2, 4);
  b.spawn('CT', 37, 4);
  const def = b.build('bot-test-arena', 'Bot Test Arena');
  registerMap(def);
  return def.name;
}

describe('BotController (structural smoke tests)', () => {
  beforeEach(() => {
    vi.spyOn(Math, 'random').mockReturnValue(0.1); // < 0.5: assignedSite always 'A'
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('spends money during its first freeze window', () => {
    // not asserting *what* it buys: on $800 pistol-round money the wishlist's
    // deagle ($700) already leaves too little for kevlar ($650) — a real
    // affordability trade-off, not a bug. Money moving proves handleBuy ran.
    const room = new Room('testarena', FAST);
    const bot = room.addBot('T', 'normal');
    room.addPlayer(null, 'Human', 'CT');
    const startingMoney = bot.money;
    stepUntil(room, () => room.phase === 'freeze');
    expect(bot.money).toBeLessThan(startingMoney);
  });

  it('moves toward its goal when no enemy is visible', () => {
    const mapName = botTestMap();
    const room = new Room(mapName, FAST);
    const bot = room.addBot('T', 'normal');
    room.addPlayer(null, 'Human', 'CT'); // >1000px away: outside VISION_RANGE
    stepUntil(room, () => room.phase === 'live');

    const start = { ...bot.pos };
    step(room, 90); // 1.5s: plenty of time to start walking toward the assigned site
    expect(bot.pos.x !== start.x || bot.pos.y !== start.y).toBe(true);
  });

  it('damages a nearby, visible enemy within a reasonable tick budget', () => {
    const room = new Room('testarena', FAST);
    const bot = room.addBot('T', 'hard'); // hard: shortest reaction delay
    const human = room.addPlayer(null, 'Human', 'CT');
    stepUntil(room, () => room.phase === 'live');

    bot.pos = { x: 300, y: 200 };
    human.pos = { x: 340, y: 200 }; // 40px away, well within VISION_RANGE and LOS

    let hit = false;
    for (let i = 0; i < 60 && !hit; i++) {
      step(room, 1);
      if (human.hp < 100) hit = true;
    }
    expect(hit).toBe(true);
  });

  it('a T bot without the bomb heads toward a dropped bomb instead of its assigned site', () => {
    const mapName = botTestMap();
    const room = new Room(mapName, FAST);
    const bot = room.addBot('T', 'normal'); // assignedSite forced to 'A' (near T spawn) by the Math.random mock
    room.addPlayer(null, 'Human', 'CT'); // far away: outside VISION_RANGE, won't distract the bot
    stepUntil(room, () => room.phase === 'live');

    // drop the bomb near the CT side — the opposite direction from site A
    const dropPos: Vec2 = { x: 35 * TILE_SIZE, y: 4 * TILE_SIZE };
    bombGuts(room).bomb = { mode: 'dropped', pos: dropPos, carrierId: 0, explodeTick: 0 };

    const startDist = dist(bot.pos, dropPos);
    step(room, 90); // 1.5s: plenty of time to start walking toward the bomb
    expect(dist(bot.pos, dropPos)).toBeLessThan(startDist);
  });
});
