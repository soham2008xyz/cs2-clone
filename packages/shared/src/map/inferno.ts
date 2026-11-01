import { MapBuilder } from './builder.js';
import type { MapDef } from './types.js';

/**
 * Simplified de_inferno, 86×62 tiles. T spawn south-west, CT spawn north
 * (between the sites), B site north-west (top-left), A site east.
 *
 * Topology preserved from the real map:
 *   T spawn → T Ramp → Banana → B Site.
 *   CT spawn → Construction → B Site; Dark hangs off B's south-east corner.
 *   T spawn → Second Mid → Mid → Short → A Site; Mid → Arch → CT / A.
 *   T spawn → Apartments → Boiler → Balcony → A Site.
 *   Library and Pit are dead-end pockets off A; CT spawn → A via the CT hall.
 */
/** B site, Banana up from T spawn, Dark, and Construction back to CT spawn. */
function carveB(b: MapBuilder): void {
  // ── B site (north-west) ──
  b.carve(6, 3, 22, 11); // x6-27, y3-13
  b.site('B', 10, 5, 12, 7); // plant zone x10-21, y5-11
  b.box(12, 6, 2, 2); // fountain
  b.box(7, 4, 2, 2); // new box
  b.box(24, 10, 2, 2); // coffins

  // T Ramp: T spawn ↑ toward lower Banana
  b.carve(10, 40, 6, 8); // x10-15, y40-47
  // Banana: long corridor north into B
  b.carve(11, 14, 6, 26); // x11-16, y14-39
  b.box(13, 27, 2, 2); // car: 2-tile lanes either side
  b.wall(11, 14, 1, 2);
  b.wall(16, 14, 1, 2); // sandbags pinch at the top of Banana: gap x12-15

  // Dark: CT-side pocket off the south-east corner of B
  b.carve(20, 14, 6, 4); // x20-25, y14-17
  // Construction: CT spawn → B
  b.carve(28, 5, 20, 4); // x28-47, y5-8
}

/** Mid from T spawn, with Short into A and Arch up to the CT hall. */
function carveMid(b: MapBuilder): void {
  b.carve(20, 50, 16, 4); // second mid x20-35, y50-53
  b.carve(36, 28, 6, 26); // mid x36-41, y28-53
  b.box(37, 34, 2, 1); // mid cover
  // Short: top mid → A site
  b.carve(42, 32, 16, 4); // x42-57, y32-35
  // Arch: top mid ↑ then east into the CT hall
  b.carve(38, 18, 4, 10); // x38-41, y18-27
  b.carve(42, 18, 14, 4); // x42-55, y18-21
}

/** A site, CT spawn and hall, Library, Pit, and Apartments → Boiler → Balcony. */
function carveAAndCt(b: MapBuilder): void {
  // ── CT spawn (north) ──
  b.carve(48, 4, 14, 10); // x48-61, y4-13
  b.carve(56, 14, 4, 12); // CT hall: CT ↔ A, x56-59, y14-25

  // ── A site (east) ──
  b.carve(58, 26, 20, 14); // x58-77, y26-39
  b.site('A', 62, 29, 10, 7); // plant zone x62-71, y29-35
  b.box(66, 30, 2, 2); // graveyard
  b.box(74, 34, 2, 2); // pit plat cover
  b.box(59, 37, 2, 1); // short-side cover
  // Library: room off A's north-east, 2-tile door at x72-73
  b.carve(72, 16, 10, 8); // x72-81, y16-23
  b.carve(72, 24, 2, 2); // door x72-73, y24-25
  // Pit: dead-end drop east of A
  b.carve(78, 30, 6, 16); // x78-83, y30-45

  // Apartments: T spawn → east along the south edge
  b.carve(20, 56, 42, 3); // x20-61, y56-58
  b.carve(60, 55, 2, 1); // apartments door x60-61, y55
  b.carve(58, 44, 10, 11); // boiler room x58-67, y44-54
  b.box(62, 48, 2, 2); // boiler
  b.carve(64, 40, 6, 4); // balcony x64-69, y40-43 → A
}

/** Spawns, buy zones, bot utility anchors and callouts. */
function annotate(b: MapBuilder): void {
  for (let i = 0; i < 5; i++) {
    b.spawn('T', 8 + i, 52);
    b.spawn('T', 8 + i, 54);
    b.spawn('CT', 52 + i, 7);
    b.spawn('CT', 52 + i, 9);
  }

  b.buyzone('T', 6, 48, 14, 12);
  b.buyzone('CT', 48, 4, 14, 10);

  b.utilitySpot('smoke', 'B', 28, 7); // CT / Construction exit
  b.utilitySpot('smoke', 'B', 22, 15); // Dark
  b.utilitySpot('flash', 'B', 13, 16); // over the Banana sandbags
  b.utilitySpot('smoke', 'A', 57, 22); // Arch / CT hall
  b.utilitySpot('smoke', 'A', 73, 25); // Library door
  b.utilitySpot('flash', 'A', 56, 33); // over Short into site

  b.callout('B Site', 16, 8)
    .callout('Banana', 13, 32)
    .callout('T Ramp', 12, 44)
    .callout('Dark', 22, 15)
    .callout('Construction', 38, 6)
    .callout('CT Spawn', 54, 11)
    .callout('Arch', 48, 19)
    .callout('Top Mid', 39, 30)
    .callout('Mid', 38, 42)
    .callout('Second Mid', 28, 51)
    .callout('Short', 50, 33)
    .callout('A Site', 68, 33)
    .callout('Library', 76, 19)
    .callout('Pit', 80, 41)
    .callout('Balcony', 66, 41)
    .callout('Boiler', 60, 50)
    .callout('Apartments', 40, 57)
    .callout('T Spawn', 10, 56);
}

function buildInferno(): MapDef {
  const b = new MapBuilder(86, 62);
  b.carve(6, 48, 14, 12); // T spawn (south-west), x6-19, y48-59
  carveB(b);
  carveMid(b);
  carveAAndCt(b);
  annotate(b);
  return b.build('inferno', 'Inferno');
}

export const INFERNO: MapDef = buildInferno();
