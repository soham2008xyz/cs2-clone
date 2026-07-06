import { describe, expect, it } from 'vitest';
import { TILE_SIZE } from '../src/constants.js';
import { getMap } from '../src/map/registry.js';
import type { CompiledMap } from '../src/map/types.js';

/** BFS over walkable tiles from a starting px position; returns visited set. */
function flood(map: CompiledMap, startX: number, startY: number): Set<number> {
  const start = Math.floor(startY / TILE_SIZE) * map.width + Math.floor(startX / TILE_SIZE);
  const visited = new Set<number>([start]);
  const queue = [start];
  while (queue.length) {
    const i = queue.pop()!;
    const tx = i % map.width;
    const ty = Math.floor(i / map.width);
    for (const [dx, dy] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ] as const) {
      const nx = tx + dx;
      const ny = ty + dy;
      const ni = ny * map.width + nx;
      if (!visited.has(ni) && !map.isSolid(nx, ny)) {
        visited.add(ni);
        queue.push(ni);
      }
    }
  }
  return visited;
}

function tileIndexAt(map: CompiledMap, px: number, py: number): number {
  return Math.floor(py / TILE_SIZE) * map.width + Math.floor(px / TILE_SIZE);
}

describe('dust2', () => {
  const map = getMap('dust2');

  it('buy zones cover each spawn for the right team only', () => {
    const [tSpawn] = map.spawns.T;
    const [ctSpawn] = map.spawns.CT;
    expect(map.buyzoneAt(tSpawn.x, tSpawn.y)).toBe('T');
    expect(map.buyzoneAt(ctSpawn.x, ctSpawn.y)).toBe('CT');
    // mid is nobody's buy area
    expect(map.buyzoneAt(37.5 * TILE_SIZE, 30.5 * TILE_SIZE)).toBeNull();
  });

  it('compiles with equal-width rows and border walls', () => {
    expect(map.width).toBe(84);
    expect(map.height).toBe(60);
    for (let tx = 0; tx < map.width; tx++) {
      expect(map.isSolid(tx, 0)).toBe(true);
      expect(map.isSolid(tx, map.height - 1)).toBe(true);
    }
    for (let ty = 0; ty < map.height; ty++) {
      expect(map.isSolid(0, ty)).toBe(true);
      expect(map.isSolid(map.width - 1, ty)).toBe(true);
    }
  });

  it('has 10 spawns per team on walkable tiles', () => {
    expect(map.spawns.T).toHaveLength(10);
    expect(map.spawns.CT).toHaveLength(10);
    for (const s of [...map.spawns.T, ...map.spawns.CT]) {
      expect(map.isSolidAt(s.x, s.y)).toBe(false);
    }
  });

  it('connects T spawn to every key area (both sites, mid, tunnels, long)', () => {
    const tSpawn = map.spawns.T[0];
    const reach = flood(map, tSpawn.x, tSpawn.y);

    const mustReach: Array<[string, number, number]> = [
      ['CT spawn', map.spawns.CT[0].x, map.spawns.CT[0].y],
      ['A site', map.siteCenters.A.x, map.siteCenters.A.y],
      ['B site', map.siteCenters.B.x, map.siteCenters.B.y],
    ];
    for (const c of map.def.callouts) {
      mustReach.push([c.name, (c.tx + 0.5) * TILE_SIZE, (c.ty + 0.5) * TILE_SIZE]);
    }
    for (const [name, x, y] of mustReach) {
      expect(map.isSolidAt(x, y), `${name} should be walkable`).toBe(false);
      expect(reach.has(tileIndexAt(map, x, y)), `${name} should be reachable from T spawn`).toBe(true);
    }
  });

  it('door pinches are the only route through their walls', () => {
    // mid doors: y=40 row solid across mid except gap x37-38
    expect(map.isSolid(36, 40)).toBe(true);
    expect(map.isSolid(37, 40)).toBe(false);
    expect(map.isSolid(38, 40)).toBe(false);
    expect(map.isSolid(39, 40)).toBe(true);
    // long doors: y=34 gap at x73-74
    expect(map.isSolid(72, 34)).toBe(true);
    expect(map.isSolid(73, 34)).toBe(false);
    expect(map.isSolid(75, 34)).toBe(true);
  });

  it('bomb sites report correctly via siteAt', () => {
    expect(map.siteAt(map.siteCenters.A.x, map.siteCenters.A.y)).toBe('A');
    expect(map.siteAt(map.siteCenters.B.x, map.siteCenters.B.y)).toBe('B');
    expect(map.siteAt(map.spawns.T[0].x, map.spawns.T[0].y)).toBeNull();
  });
});
