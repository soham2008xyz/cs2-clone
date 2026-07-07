import { describe, expect, it } from 'vitest';
import { PLAYER_RADIUS, RUN_SPEED, TILE_SIZE, WALK_SPEED_MULT } from '../src/constants.js';
import { compileMap } from '../src/map/compile.js';
import { MapBuilder } from '../src/map/builder.js';
import { stepMovement } from '../src/sim/movement.js';
import { moveCircle } from '../src/sim/collision.js';

// 10×10 room: walls on the border, open interior
function room() {
  const b = new MapBuilder(10, 10);
  b.carve(1, 1, 8, 8);
  b.spawn('T', 2, 2);
  b.spawn('CT', 7, 7);
  return compileMap(b.build('room', 'Room'));
}

const btn = (over: Partial<Record<'up' | 'down' | 'left' | 'right' | 'walk', boolean>> = {}) => ({
  up: false,
  down: false,
  left: false,
  right: false,
  walk: false,
  ...over,
});

describe('movement', () => {
  it('moves at run speed', () => {
    const map = room();
    const p0 = { x: 5 * TILE_SIZE, y: 5 * TILE_SIZE };
    const p1 = stepMovement(p0, btn({ right: true }), 1, map, 1 / 60);
    expect(p1.x - p0.x).toBeCloseTo(RUN_SPEED / 60, 5);
    expect(p1.y).toBe(p0.y);
  });

  it('weapon mobility scales speed (heavier weapons are slower)', () => {
    const map = room();
    const p0 = { x: 5 * TILE_SIZE, y: 5 * TILE_SIZE };
    const p1 = stepMovement(p0, btn({ right: true }), 0.5, map, 1 / 60);
    expect(p1.x - p0.x).toBeCloseTo((RUN_SPEED * 0.5) / 60, 5);
    expect(p1.y).toBe(p0.y);
  });

  it('walk is slower than run', () => {
    const map = room();
    const p0 = { x: 5 * TILE_SIZE, y: 5 * TILE_SIZE };
    const walked = stepMovement(p0, btn({ right: true, walk: true }), 1, map, 1 / 60);
    expect(walked.x - p0.x).toBeCloseTo((RUN_SPEED * WALK_SPEED_MULT) / 60, 5);
  });

  it('diagonal speed is normalized', () => {
    const map = room();
    const p0 = { x: 5 * TILE_SIZE, y: 5 * TILE_SIZE };
    const p1 = stepMovement(p0, btn({ right: true, down: true }), 1, map, 1 / 60);
    const d = Math.hypot(p1.x - p0.x, p1.y - p0.y);
    expect(d).toBeCloseTo(RUN_SPEED / 60, 5);
  });

  it('cannot pass through walls and slides along them', () => {
    const map = room();
    // start near the right wall (wall tiles begin at x=9*32=288)
    const p0 = { x: 288 - PLAYER_RADIUS - 1, y: 5 * TILE_SIZE };
    const p1 = stepMovement(p0, btn({ right: true, down: true }), 1, map, 1 / 60);
    expect(p1.x + PLAYER_RADIUS).toBeLessThanOrEqual(288); // clamped at wall
    expect(p1.y).toBeGreaterThan(p0.y); // still slid downward
  });

  it('large delta cannot tunnel through a wall', () => {
    const map = room();
    const p0 = { x: 5 * TILE_SIZE, y: 5 * TILE_SIZE };
    const p1 = moveCircle(p0, { x: 500, y: 0 }, PLAYER_RADIUS, map);
    expect(p1.x + PLAYER_RADIUS).toBeLessThanOrEqual(288);
  });
});
