// Micro-benchmark: A* on Dust II and the vision polygon. Run: npx tsx scripts/bench-hotspots.mts
import { getMap, TILE_SIZE, visibilityPolygon } from '../packages/shared/src/index.ts';
import { findPath } from '../packages/server/src/bots/pathfinding.ts';

const map = getMap('dust2');
const t = map.spawns.T[0];
const ct = map.spawns.CT[0];

function time(label: string, runs: number, fn: () => void): void {
  fn();
  const start = performance.now();
  for (let i = 0; i < runs; i++) fn();
  console.log(`${label}: ${((performance.now() - start) / runs).toFixed(3)} ms/op`);
}

// farthest walkable tile from the T spawn that A* can reach: a worst-case long search
let far = ct;
let farLen = 0;
for (let ty = 1; ty < map.height; ty += 7) {
  for (let tx = 1; tx < map.width; tx += 7) {
    if (map.isSolid(tx, ty)) continue;
    const goal = { x: (tx + 0.5) * TILE_SIZE, y: (ty + 0.5) * TILE_SIZE };
    const len = findPath(map, t, goal).length;
    if (len > farLen) {
      farLen = len;
      far = goal;
    }
  }
}
console.log(`longest path: ${farLen} waypoints`);
time('findPath T spawn -> far tile (dust2)', 20, () => findPath(map, t, far));
const smokes = [{ pos: { x: t.x + 120, y: t.y }, radius: 90 }];
time('visibilityPolygon (1 smoke)', 500, () => visibilityPolygon(t, map, smokes));
