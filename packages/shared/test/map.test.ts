import { describe, expect, it } from 'vitest';
import { TILE_SIZE } from '../src/constants.js';
import { getMap, listMaps } from '../src/map/registry.js';
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

// Invariants every full-size 5v5 map must hold; per-map specifics follow below.
describe.each([
  // dust2's top-mid smoke anchor deliberately sits on the xbox crate, so only
  // the newer maps require their utility anchors to be walkable and reachable
  { name: 'dust2', width: 84, height: 60, midTile: [37, 30], utilityOnFloor: false },
  { name: 'mirage', width: 88, height: 62, midTile: [40, 30], utilityOnFloor: true },
  { name: 'inferno', width: 86, height: 62, midTile: [38, 42], utilityOnFloor: true },
])('$name (full-size map invariants)', ({ name, width, height, midTile, utilityOnFloor }) => {
  const map = getMap(name);

  it('is registered', () => {
    expect(listMaps()).toContain(name);
  });

  it('compiles with equal-width rows and border walls', () => {
    expect(map.width).toBe(width);
    expect(map.height).toBe(height);
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

  it('buy zones cover each spawn for the right team only', () => {
    for (const s of map.spawns.T) expect(map.buyzoneAt(s.x, s.y)).toBe('T');
    for (const s of map.spawns.CT) expect(map.buyzoneAt(s.x, s.y)).toBe('CT');
    // mid is nobody's buy area
    expect(map.buyzoneAt((midTile[0] + 0.5) * TILE_SIZE, (midTile[1] + 0.5) * TILE_SIZE)).toBeNull();
  });

  it('bomb sites report correctly via siteAt', () => {
    expect(map.siteAt(map.siteCenters.A!.x, map.siteCenters.A!.y)).toBe('A');
    expect(map.siteAt(map.siteCenters.B!.x, map.siteCenters.B!.y)).toBe('B');
    expect(map.siteAt(map.spawns.T[0].x, map.spawns.T[0].y)).toBeNull();
  });

  it('connects T spawn to CT spawn, both sites and every callout (and utility anchor where required)', () => {
    const tSpawn = map.spawns.T[0];
    const reach = flood(map, tSpawn.x, tSpawn.y);
    const mustReach: Array<[string, number, number]> = [
      ['CT spawn', map.spawns.CT[0].x, map.spawns.CT[0].y],
      ['A site', map.siteCenters.A!.x, map.siteCenters.A!.y],
      ['B site', map.siteCenters.B!.x, map.siteCenters.B!.y],
    ];
    for (const c of map.def.callouts) {
      mustReach.push([c.name, (c.tx + 0.5) * TILE_SIZE, (c.ty + 0.5) * TILE_SIZE]);
    }
    if (utilityOnFloor) for (const u of map.utilitySpots) mustReach.push([`${u.kind} ${u.site}`, u.pos.x, u.pos.y]);
    for (const [label, x, y] of mustReach) {
      expect(map.isSolidAt(x, y), `${label} should be walkable`).toBe(false);
      expect(reach.has(tileIndexAt(map, x, y)), `${label} should be reachable from T spawn`).toBe(true);
    }
  });
});

describe('dust2', () => {
  const map = getMap('dust2');

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
});

describe('mirage', () => {
  const map = getMap('mirage');

  it('is offered under its display name', () => {
    expect(map.def.displayName).toBe('Mirage');
  });

  it('pinches are the only route through their walls', () => {
    // palace door: gap at (55,55) between walls above and below
    expect(map.isSolid(55, 54)).toBe(true);
    expect(map.isSolid(55, 55)).toBe(false);
    expect(map.isSolid(55, 56)).toBe(true);
    // window: one-tile-tall gap from window room into mid
    expect(map.isSolid(24, 29)).toBe(true);
    expect(map.isSolid(24, 30)).toBe(false);
    expect(map.isSolid(24, 31)).toBe(true);
  });
});

describe('inferno', () => {
  const map = getMap('inferno');

  it('is offered under its display name', () => {
    expect(map.def.displayName).toBe('Inferno');
  });

  it('pinches are the only route through their walls', () => {
    // Banana sandbags: walls at x11 and x16, 4-tile gap x12-15 into B
    expect(map.isSolid(11, 14)).toBe(true);
    for (let tx = 12; tx <= 15; tx++) expect(map.isSolid(tx, 14)).toBe(false);
    expect(map.isSolid(16, 14)).toBe(true);
    // Apartments door: 2-tile gap x60-61 at y55 into the boiler room
    expect(map.isSolid(59, 55)).toBe(true);
    expect(map.isSolid(60, 55)).toBe(false);
    expect(map.isSolid(61, 55)).toBe(false);
    expect(map.isSolid(62, 55)).toBe(true);
    // Library door: 2-tile gap x72-73 at y24
    expect(map.isSolid(71, 24)).toBe(true);
    expect(map.isSolid(72, 24)).toBe(false);
    expect(map.isSolid(73, 24)).toBe(false);
    expect(map.isSolid(74, 24)).toBe(true);
  });

  it('the Banana car leaves a 2-tile lane on both sides', () => {
    for (const ty of [27, 28]) {
      expect(map.isSolid(13, ty)).toBe(true);
      expect(map.isSolid(14, ty)).toBe(true);
      for (const tx of [11, 12, 15, 16]) expect(map.isSolid(tx, ty)).toBe(false);
    }
  });
});

// testarena is what scripts/integration-round.mjs and integration-bots.mjs run
// against — a scoped-down sanity check guards against accidental map-def
// breakage without duplicating the full dust2 suite above.
describe('testarena', () => {
  const map = getMap('testarena');

  it('compiles with 5 spawns per team, all on walkable tiles', () => {
    expect(map.spawns.T).toHaveLength(5);
    expect(map.spawns.CT).toHaveLength(5);
    for (const s of [...map.spawns.T, ...map.spawns.CT]) {
      expect(map.isSolidAt(s.x, s.y)).toBe(false);
    }
  });

  it('site A is reachable from T spawn', () => {
    const tSpawn = map.spawns.T[0];
    const reach = flood(map, tSpawn.x, tSpawn.y);
    expect(map.isSolidAt(map.siteCenters.A!.x, map.siteCenters.A!.y)).toBe(false);
    expect(reach.has(tileIndexAt(map, map.siteCenters.A!.x, map.siteCenters.A!.y))).toBe(true);
  });

  it('has no site B (single-site map) — siteCenters.B is null, not a bogus (0,0)', () => {
    expect(map.siteCenters.B).toBeNull();
  });
});
