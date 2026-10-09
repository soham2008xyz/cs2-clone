// Bot behaviours that the structural smoke tests in bot.test.ts do not reach.
// Like that file, these pin Math.random so site picks and aim jitter are deterministic.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { dist, MapBuilder, registerMap, TILE_SIZE, type Vec2 } from '@cs2d/shared';
import { Room } from '../../src/room.js';

const FAST = { freeze: 0.05, round: 20, bomb: 1, plant: 0.1, defuse: 0.2, defuseKit: 0.1, roundEnd: 0.1 };

interface Internals {
  step(): void;
  botIntel: { site: 'A' | 'B'; tick: number } | null;
}
const guts = (r: Room): Internals => r as unknown as Internals;
const step = (r: Room, n = 1): void => {
  for (let i = 0; i < n; i++) guts(r).step();
};
const stepUntil = (r: Room, cond: () => boolean, cap = 800): void => {
  for (let i = 0; i < cap && !cond(); i++) guts(r).step();
  if (!cond()) throw new Error('stepUntil: condition not reached');
};
const tile = (x: number, y = 4.5): Vec2 => ({ x: x * TILE_SIZE, y: y * TILE_SIZE });

/** Long corridor; which sites exist is chosen per test. */
function corridor(name: string, sites: Array<'A' | 'B'>, spots: Array<{ kind: 'smoke' | 'flash'; site: 'A' | 'B'; tx: number; ty: number }> = []): string {
  const b = new MapBuilder(60, 8);
  b.carve(1, 1, 58, 6);
  if (sites.includes('A')) b.site('A', 5, 3, 3, 3);
  if (sites.includes('B')) b.site('B', 52, 3, 3, 3);
  for (const s of spots) b.utilitySpot(s.kind, s.site, s.tx, s.ty);
  b.spawn('T', 20, 4);
  b.spawn('CT', 58, 4);
  const def = b.build(name, name);
  registerMap(def);
  return def.name;
}

beforeEach(() => {
  vi.spyOn(Math, 'random').mockReturnValue(0.1); // assignedSite = 'A'
});
afterEach(() => {
  vi.restoreAllMocks();
});

function live(map: string, botTeam: 'T' | 'CT' = 'T') {
  const room = new Room(map, FAST);
  const bot = room.addBot(botTeam, 'hard');
  const human = room.addPlayer(null, 'Human', botTeam === 'T' ? 'CT' : 'T');
  stepUntil(room, () => room.phase === 'live');
  return { room, bot, human };
}

describe('bot goals', () => {
  it('a wounded bot without the bomb falls back to its spawn instead of pushing the site', () => {
    const map = corridor('bot-gaps-save', ['A', 'B']);
    const { room, bot, human } = live(map);
    human.pos = tile(58);
    bot.pos = tile(8);
    bot.hp = 20;
    const spawn = room.map.spawns.T[0];
    const before = dist(bot.pos, spawn);
    step(room, 90);
    expect(dist(bot.pos, spawn)).toBeLessThan(before);
  });

  it('a CT bot rotates toward a site when a teammate reports the bomb carrier there', () => {
    const map = corridor('bot-gaps-rotate', ['A', 'B']);
    const { room, bot, human } = live(map, 'CT');
    human.pos = tile(1, 1.5);
    bot.pos = tile(40);
    guts(room).botIntel = { site: 'B', tick: room.tick };
    const siteB = room.map.siteCenters.B!;
    const before = dist(bot.pos, siteB);
    step(room, 90);
    expect(dist(bot.pos, siteB)).toBeLessThan(before);
  });

  it('ignores stale bomb intel and heads for its own assigned site', () => {
    const map = corridor('bot-gaps-stale', ['A', 'B']);
    const { room, bot, human } = live(map, 'CT');
    human.pos = tile(1, 1.5);
    bot.pos = tile(30);
    guts(room).botIntel = { site: 'B', tick: room.tick - 60 * 60 }; // a minute old
    const siteA = room.map.siteCenters.A!;
    const before = dist(bot.pos, siteA);
    step(room, 90);
    expect(dist(bot.pos, siteA)).toBeLessThan(before);
  });
});

describe('bot sightings', () => {
  it.each([
    ['both sites exist: nearest wins', ['A', 'B'] as Array<'A' | 'B'>, 53, 'B'],
    ['both sites exist, other side', ['A', 'B'] as Array<'A' | 'B'>, 7, 'A'],
    ['only site A exists', ['A'] as Array<'A' | 'B'>, 53, 'A'],
    ['only site B exists', ['B'] as Array<'A' | 'B'>, 7, 'B'],
  ])('a CT that sees the bomb carrier reports the nearest site (%s)', (_name, sites, carrierTile, expected) => {
    const map = corridor(`bot-gaps-intel-${sites.join('')}-${carrierTile}`, sites);
    const { room, bot, human } = live(map, 'CT');
    human.hasBomb = true;
    human.pos = tile(carrierTile);
    bot.pos = tile(carrierTile > 30 ? carrierTile - 3 : carrierTile + 3);
    step(room, 5);
    expect(guts(room).botIntel?.site).toBe(expected);
  });

  it('a flashed bot drops its target and does not shoot', () => {
    const { room, bot, human } = live('testarena');
    bot.pos = { x: 300, y: 200 };
    human.pos = { x: 340, y: 200 };
    bot.blindUntilTick = room.tick + 120;
    step(room, 90);
    expect(human.hp).toBe(100);
  });

  it('switches back to a gun when it spots an enemy while holding a grenade', () => {
    const { room, bot, human } = live('testarena');
    bot.pos = { x: 300, y: 200 };
    human.pos = { x: 340, y: 200 };
    bot.nades = ['he'];
    bot.activeSlot = 4;
    step(room, 3);
    expect(bot.activeSlot).not.toBe(4);
  });

  it('fires a held-down automatic in bursts that land hits', () => {
    const { room, bot, human } = live('testarena');
    bot.primary = { id: 'ak47', ammo: 30, reserve: 90 };
    bot.activeSlot = 1;
    bot.pos = { x: 300, y: 200 };
    human.pos = { x: 340, y: 200 };
    stepUntil(room, () => human.hp < 100, 120);
    expect(human.hp).toBeLessThan(100);
  });
});

describe('bot utility', () => {
  const spotMap = () => corridor('bot-gaps-util', ['A'], [{ kind: 'smoke', site: 'A', tx: 10, ty: 4 }]);

  it('throws a carried smoke at the anchor for the site it is executing, once per cooldown', () => {
    const { room, bot, human } = live(spotMap());
    human.pos = tile(58);
    bot.pos = tile(10.5 + 8); // ~8 tiles from the anchor: inside the throw band
    bot.nades = ['smoke', 'smoke'];
    step(room, 20);
    expect(bot.nades).toHaveLength(1); // one thrown...
    step(room, 60);
    expect(bot.nades.length).toBeLessThanOrEqual(1); // ...the cooldown blocks an immediate second
  });

  it('does not throw from outside the throw band', () => {
    const { room, bot, human } = live(spotMap());
    human.pos = tile(58);
    bot.pos = tile(10.5 + 25);
    bot.nades = ['smoke'];
    step(room, 10);
    expect(bot.nades).toEqual(['smoke']);
  });

  it('keeps grenades that are not smoke or flash', () => {
    const { room, bot, human } = live(spotMap());
    human.pos = tile(58);
    bot.pos = tile(10.5 + 8);
    bot.nades = ['he'];
    step(room, 10);
    expect(bot.nades).toEqual(['he']);
  });

  it('does not throw at an anchor assigned to a different site', () => {
    const map = corridor('bot-gaps-othersite', ['A', 'B'], [{ kind: 'smoke', site: 'B', tx: 10, ty: 4 }]);
    const { room, bot, human } = live(map);
    human.pos = tile(58);
    bot.pos = tile(10.5 + 8);
    bot.nades = ['smoke'];
    step(room, 10);
    expect(bot.nades).toEqual(['smoke']);
  });
});

describe('bot movement', () => {
  it('abandons a path it has made no progress along and finds another', () => {
    const map = corridor('bot-gaps-stuck', ['A']);
    const { room, bot, human } = live(map);
    human.pos = tile(58);
    step(room, 5);
    const ctl = (room as unknown as { bots: Map<number, { path: Vec2[] }> }).bots.get(bot.id)!;
    const original = ctl.path;
    expect(original.length).toBeGreaterThan(0);
    // pin the bot in place while it keeps trying to walk
    const pinned = { ...bot.pos };
    for (let i = 0; i < 200; i++) {
      bot.pos = { ...pinned };
      step(room, 1);
    }
    expect(ctl.path).not.toBe(original); // the dead path was discarded and re-planned
  });
});
