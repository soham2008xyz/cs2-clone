import { MapBuilder } from './builder.js';
import type { MapDef } from './types.js';

/**
 * Simplified de_dust2, 84×60 tiles, north (top) = CT side.
 *
 * Topology preserved from the real map:
 *   T spawn (bottom) → Mid (through Mid Doors), → Lower/Upper Tunnels → B,
 *   → Outside Long → Long Doors → Long A → A Ramp → A Site.
 *   CT spawn (top-center) → CT Mid → Mid / B Doors → B, → CT Ramp/Short → A Site.
 *   Catwalk connects Mid to Short.
 */
function buildDust2(): MapDef {
  const b = new MapBuilder(84, 60);

  // ── B site (top-left) ──
  b.carve(4, 6, 16, 14); // site floor x4-19, y6-19
  b.site('B', 6, 9, 9, 7); // plant zone
  b.box(5, 7, 2, 2); // back plat crates
  b.box(16, 16, 2, 2); // "car"
  b.box(11, 6, 2, 1);

  // B doors corridor: B site ↔ CT mid, with door pinch
  b.carve(20, 10, 12, 4); // x20-31, y10-13
  b.wall(25, 10, 1, 1);
  b.wall(25, 13, 1, 1); // gap remains at y11-12 ("B doors")

  // ── CT mid plaza ──
  b.carve(32, 8, 12, 10); // x32-43, y8-17

  // ── CT spawn (top-center) ──
  b.carve(44, 4, 14, 9); // x44-57, y4-12

  // ── A site (top-right) ──
  b.carve(58, 6, 18, 16); // x58-75, y6-21
  b.wall(58, 6, 1, 7); // wall the CT-spawn seam so A is entered via ramp/short/long
  b.site('A', 62, 9, 9, 7);
  b.box(59, 7, 2, 2); // goose corner
  b.box(66, 16, 2, 2); // site crates
  b.box(73, 7, 1, 2);

  // CT ramp / A short plaza: CT spawn ↓ and catwalk → into A
  b.carve(54, 13, 4, 6); // x54-57, y13-18

  // ── Mid (vertical spine) ──
  b.carve(34, 18, 8, 27); // x34-41, y18-44
  b.box(36, 20, 2, 1); // xbox
  b.wall(34, 40, 8, 1);
  b.carve(37, 40, 2, 1); // mid doors: gap x37-38

  // Catwalk: mid → short
  b.carve(42, 20, 12, 3); // x42-53, y20-22
  b.carve(52, 14, 2, 9); // short stairs x52-53, y14-22

  // ── Long A (right side) ──
  b.carve(70, 22, 8, 22); // x70-77, y22-43
  b.wall(70, 34, 8, 1);
  b.carve(73, 34, 2, 1); // long doors: gap x73-74
  b.box(76, 22, 2, 2); // blue container corner
  b.box(76, 36, 2, 2); // cover past doors

  // Outside long (bottom-right sweep to T spawn)
  b.carve(46, 44, 32, 6); // x46-77, y44-49
  b.box(60, 47, 2, 2); // corner cover

  // ── T spawn (bottom) ──
  b.carve(14, 45, 32, 11); // x14-45, y45-55

  // ── Tunnels (left side) ──
  b.carve(8, 20, 4, 4); // B tunnels mouth (up into B)
  b.carve(8, 24, 18, 4); // upper tunnels x8-25, y24-27
  b.carve(18, 28, 4, 17); // lower tunnels x18-21, y28-44

  // Spawn points (5v5 with room for spectator variety)
  for (let i = 0; i < 5; i++) {
    b.spawn('T', 25 + i, 50);
    b.spawn('T', 25 + i, 52);
    b.spawn('CT', 46 + i, 6);
    b.spawn('CT', 46 + i, 8);
  }

  // Buy areas: each team's spawn plaza
  b.buyzone('T', 20, 46, 16, 9); // within T spawn (x14-45, y45-55)
  b.buyzone('CT', 44, 4, 14, 9); // full CT spawn (x44-57, y4-12)

  b.callout('B Site', 10, 12)
    .callout('B Doors', 25, 11)
    .callout('CT Mid', 37, 12)
    .callout('CT Spawn', 50, 7)
    .callout('A Site', 66, 12)
    .callout('Short', 55, 16)
    .callout('Catwalk', 46, 21)
    .callout('Mid', 37, 30)
    .callout('Mid Doors', 37, 40)
    .callout('B Tunnels', 9, 22)
    .callout('Upper Tunnels', 15, 25)
    .callout('Lower Tunnels', 19, 36)
    .callout('T Spawn', 28, 51)
    .callout('Outside Long', 58, 46)
    .callout('Long Doors', 73, 34)
    .callout('Long A', 73, 28)
    .callout('A Ramp', 72, 22);

  return b.build('dust2', 'Dust II');
}

export const DUST2: MapDef = buildDust2();
