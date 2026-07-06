import { describe, expect, it } from 'vitest';
import { compileMap, MapBuilder, TILE_SIZE } from '@cs2d/shared';
import { findPath, smoothPath } from '../src/bots/pathfinding.js';

function room() {
  const b = new MapBuilder(20, 20);
  b.carve(1, 1, 18, 18);
  b.spawn('T', 2, 2);
  b.spawn('CT', 17, 17);
  return compileMap(b.build('room', 'Room'));
}

function corridorWithDogleg() {
  // two rooms connected by an L-shaped corridor, forcing a real path around a wall
  const b = new MapBuilder(20, 20);
  b.carve(1, 1, 6, 6); // room A, x1-6 y1-6
  b.carve(13, 13, 6, 6); // room B, x13-18 y13-18
  b.carve(6, 6, 1, 8); // vertical leg down from room A
  b.carve(6, 13, 8, 1); // horizontal leg across to room B
  b.spawn('T', 2, 2);
  b.spawn('CT', 15, 15);
  return compileMap(b.build('dogleg', 'Dogleg'));
}

const at = (tx: number, ty: number) => ({ x: (tx + 0.5) * TILE_SIZE, y: (ty + 0.5) * TILE_SIZE });

describe('findPath', () => {
  it('returns empty path when already at the goal tile', () => {
    const map = room();
    expect(findPath(map, at(5, 5), at(5, 5))).toEqual([]);
  });

  it('returns empty path for an unreachable / solid goal', () => {
    const map = room();
    expect(findPath(map, at(2, 2), at(0, 0))).toEqual([]); // wall tile
  });

  it('finds a direct path across open space', () => {
    const map = room();
    const path = findPath(map, at(2, 2), at(15, 15));
    expect(path.length).toBeGreaterThan(0);
    const last = path[path.length - 1];
    expect(Math.round(last.x / TILE_SIZE - 0.5)).toBe(15);
    expect(Math.round(last.y / TILE_SIZE - 0.5)).toBe(15);
  });

  it('routes around a wall through the only connecting corridor', () => {
    const map = corridorWithDogleg();
    const path = findPath(map, at(2, 2), at(15, 15));
    expect(path.length).toBeGreaterThan(0);
    // every waypoint must be on a walkable tile (path never cuts through the dividing walls)
    for (const p of path) {
      expect(map.isSolidAt(p.x, p.y)).toBe(false);
    }
    // path must pass through the corridor leg (x=6 column) to get from room A to room B
    const passesThroughLeg = path.some((p) => Math.floor(p.x / TILE_SIZE) === 6 && Math.floor(p.y / TILE_SIZE) >= 6);
    expect(passesThroughLeg).toBe(true);
  });

  it('never returns a waypoint on a solid tile', () => {
    const map = corridorWithDogleg();
    const path = findPath(map, at(3, 3), at(16, 16));
    for (const p of path) expect(map.isSolidAt(p.x, p.y)).toBe(false);
  });
});

describe('smoothPath', () => {
  it('collapses a path in open space to a single direct waypoint', () => {
    const map = room();
    const raw = findPath(map, at(2, 2), at(15, 15));
    const smoothed = smoothPath(map, at(2, 2), raw);
    expect(smoothed.length).toBeLessThanOrEqual(raw.length);
    expect(smoothed.length).toBe(1); // fully open room -> straight line
  });

  it('keeps enough waypoints to navigate around a wall', () => {
    const map = corridorWithDogleg();
    const raw = findPath(map, at(2, 2), at(15, 15));
    const smoothed = smoothPath(map, at(2, 2), raw);
    expect(smoothed.length).toBeGreaterThan(1); // can't shortcut through the wall
    for (const p of smoothed) expect(map.isSolidAt(p.x, p.y)).toBe(false);
  });
});
