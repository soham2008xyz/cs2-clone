import { describe, expect, it } from 'vitest';
import { resolveFlashBlind, resolveHeDamage, stepGrenade } from '../src/sim/grenades.js';
import { compileMap } from '../src/map/compile.js';
import { MapBuilder } from '../src/map/builder.js';
import { TILE_SIZE, FLASH_MAX_BLIND, HE_MAX_DAMAGE } from '../src/constants.js';

function corridor() {
  const b = new MapBuilder(30, 10);
  b.carve(1, 1, 28, 8);
  b.wall(15, 4, 1, 5); // wall from y=4 down; y=1..3 stays open
  b.spawn('T', 2, 2);
  b.spawn('CT', 27, 2);
  return compileMap(b.build('corridor', 'Corridor'));
}

const at = (tx: number, ty: number) => ({ x: (tx + 0.5) * TILE_SIZE, y: (ty + 0.5) * TILE_SIZE });

describe('grenade physics', () => {
  it('bounces off a wall and loses energy', () => {
    const map = corridor();
    // thrown rightward directly at the wall segment (y=6, wall spans y4-8, x=15)
    let body = { pos: at(13, 6), vel: { x: 400, y: 0 } };
    const speeds: number[] = [Math.hypot(body.vel.x, body.vel.y)];
    for (let i = 0; i < 30; i++) {
      body = stepGrenade(body, map, 1 / 60);
      speeds.push(Math.hypot(body.vel.x, body.vel.y));
    }
    // it must have reversed direction (bounced) at some point
    expect(body.vel.x).toBeLessThanOrEqual(0);
    // speed decreases overall due to drag + bounce friction
    expect(speeds[speeds.length - 1]).toBeLessThan(speeds[0]);
  });

  it('comes to rest eventually', () => {
    const map = corridor();
    let body = { pos: at(5, 6), vel: { x: 300, y: 120 } };
    for (let i = 0; i < 600; i++) body = stepGrenade(body, map, 1 / 60); // 10s
    expect(Math.hypot(body.vel.x, body.vel.y)).toBe(0);
  });

  it('never tunnels through the wall', () => {
    const map = corridor();
    let body = { pos: at(13, 6), vel: { x: 2000, y: 0 } }; // absurdly fast throw
    for (let i = 0; i < 5; i++) body = stepGrenade(body, map, 1 / 60);
    expect(body.pos.x).toBeLessThan(15 * TILE_SIZE);
  });
});

describe('HE damage', () => {
  const map = corridor();

  it('damages with falloff, nobody beyond radius', () => {
    const targets = [
      { id: 1, pos: at(6, 2), alive: true }, // very close
      { id: 2, pos: at(9, 2), alive: true }, // mid
      { id: 3, pos: at(20, 2), alive: true }, // far outside radius
    ];
    const center = at(5, 2);
    const hits = resolveHeDamage(center, targets, map);
    const h1 = hits.find((h) => h.id === 1)!;
    const h2 = hits.find((h) => h.id === 2)!;
    expect(hits.find((h) => h.id === 3)).toBeUndefined();
    expect(h1.rawDamage).toBeGreaterThan(h2.rawDamage);
    expect(h1.rawDamage).toBeLessThanOrEqual(HE_MAX_DAMAGE);
  });

  it('blocked by a wall', () => {
    const center = at(2, 6);
    const targets = [{ id: 1, pos: at(2, 8), alive: true }]; // same side, in radius, should hit
    const blocked = [{ id: 2, pos: at(16, 6), alive: true }]; // across the wall — out of HE radius anyway but also blocked
    expect(resolveHeDamage(center, targets, map).length).toBe(1);
    expect(resolveHeDamage(center, blocked, map).length).toBe(0);
  });

  it('ignores dead targets', () => {
    const hits = resolveHeDamage(at(5, 2), [{ id: 1, pos: at(6, 2), alive: false }], map);
    expect(hits).toHaveLength(0);
  });
});

describe('flash blind', () => {
  const map = corridor();

  it('fully blinds a target looking straight at the pop, close range', () => {
    const pop = at(6, 2);
    const target = { id: 1, pos: at(4, 2), aim: 0, alive: true }; // looking toward +x, flash is to the east
    const [hit] = resolveFlashBlind(pop, [target], map);
    expect(hit).toBeDefined();
    expect(hit.duration).toBeGreaterThan(FLASH_MAX_BLIND * 0.7);
  });

  it('blinds less when looking away', () => {
    const pop = at(6, 2);
    const lookingAt = resolveFlashBlind(pop, [{ id: 1, pos: at(4, 2), aim: 0, alive: true }], map)[0];
    const lookingAway = resolveFlashBlind(pop, [{ id: 2, pos: at(4, 2), aim: Math.PI, alive: true }], map)[0];
    expect(lookingAway.duration).toBeLessThan(lookingAt.duration);
  });

  it('no blind beyond LOS-blocking wall', () => {
    const pop = at(2, 6);
    const hits = resolveFlashBlind(pop, [{ id: 1, pos: at(20, 6), aim: Math.PI, alive: true }], map);
    expect(hits).toHaveLength(0);
  });

  it('smoke blocks flash LOS too', () => {
    const pop = at(2, 2);
    const target = { id: 1, pos: at(10, 2), aim: Math.PI, alive: true };
    const noSmoke = resolveFlashBlind(pop, [target], map);
    const withSmoke = resolveFlashBlind(pop, [target], map, [{ pos: at(6, 2), radius: 60 }]);
    expect(noSmoke.length).toBe(1);
    expect(withSmoke.length).toBe(0);
  });
});
