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

/** Like botTestMap, but the T spawn sits mid-corridor with site A behind it (left), and a partial wall at x=31. */
function midSpawnMap(): string {
  const b = new MapBuilder(64, 8);
  b.carve(1, 1, 62, 6);
  b.site('A', 5, 3, 3, 3);
  b.wall(31, 1, 1, 4); // two-row gap along the bottom; separates x=30 from x=32 by a wall
  b.spawn('T', 20, 4);
  b.spawn('CT', 62, 4);
  const def = b.build('bot-mid-spawn-arena', 'Bot Mid Spawn Arena');
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

  it('sends no client-seen tick, so its shots use current target positions', () => {
    const room = new Room(botTestMap(), FAST);
    const bot = room.addBot('T', 'normal');
    room.addPlayer(null, 'Human', 'CT');
    stepUntil(room, () => room.phase === 'live');
    step(room, 30);
    expect(bot.lastSeq).toBeGreaterThan(0); // the bot has sent inputs
    expect(bot.lastSeenTick).toBeUndefined();
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

  it('never assigns a bot to a bombsite the map does not have (single-site maps)', () => {
    const mapName = botTestMap(); // only defines site A
    vi.spyOn(Math, 'random').mockReturnValue(0.9); // >= 0.5: would pick the non-existent 'B' if unguarded
    const room = new Room(mapName, FAST);
    const bot = room.addBot('T', 'normal');
    room.addPlayer(null, 'Human', 'CT'); // far away: won't distract the bot into combat
    stepUntil(room, () => room.phase === 'live');

    const start = { ...bot.pos };
    step(room, 90); // 1.5s: should path toward the one real site, not idle at spawn forever
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

  /** Live midSpawnMap round with a lone T bot, then the bomb planted at `bombPos` (bot moved to `botPos` if given). */
  function plantedRoom(bombPos: Vec2, botPos?: Vec2) {
    const room = new Room(midSpawnMap(), FAST);
    const bot = room.addBot('T', 'normal'); // assignedSite 'A' (behind the bot) by the Math.random mock
    room.addPlayer(null, 'Human', 'CT'); // far away: won't distract the bot
    stepUntil(room, () => room.phase === 'live');
    if (botPos) bot.pos = botPos;
    bombGuts(room).bomb = { mode: 'planted', pos: bombPos, carrierId: 0, explodeTick: room.tick + 100000 };
    (room as unknown as { phase: string }).phase = 'planted';
    return { room, bot };
  }
  const tileAt = (x: number, y = 4.5): Vec2 => ({ x: x * TILE_SIZE, y: y * TILE_SIZE });

  it('post-plant, a T bot guards the planted bomb instead of its assigned site', () => {
    const bombPos = tileAt(30); // far side of the bot from site A
    const { room, bot } = plantedRoom(bombPos);
    const startDist = dist(bot.pos, bombPos);
    step(room, 90);
    expect(dist(bot.pos, bombPos)).toBeLessThan(startDist);
  });

  it('post-plant, a T bot holds near the bomb instead of standing on it', () => {
    const bombPos = tileAt(30);
    const { room, bot } = plantedRoom(bombPos, tileAt(29));
    const before = { ...bot.pos };
    step(room, 60);
    expect(dist(bot.pos, before)).toBeLessThan(TILE_SIZE / 2);
  });

  it('post-plant, a T bot walled off from the nearby bomb keeps the bomb as its goal', () => {
    const bombPos = tileAt(30.5);
    const { room, bot } = plantedRoom(bombPos, tileAt(33.5)); // ~3 tiles away (inside the hold radius), wall between
    step(room, 10);
    // not holding: the bot's path goal is the bomb, not "no goal" (the detour hugs a wall
    // corner in this tiny map, so assert the goal rather than distance walked)
    const ctl = (room as unknown as { bots: Map<number, { goal: Vec2 | null }> }).bots.get(bot.id);
    expect(ctl?.goal).toEqual(bombPos);
  });

  it('post-plant, a T bot holding near the bomb moves out of a fire on its tile', () => {
    const { room, bot } = plantedRoom(tileAt(30), tileAt(29));
    const fires = (room as unknown as { fires: Map<number, unknown> }).fires;
    fires.set(301, { id: 301, kind: 'molotov', pos: { ...bot.pos }, untilTick: room.tick + 600, ownerId: 0, ownerTeam: 'CT' });
    const before = { ...bot.pos };
    step(room, 60);
    expect(dist(bot.pos, before)).toBeGreaterThan(TILE_SIZE / 2);
  });
});
