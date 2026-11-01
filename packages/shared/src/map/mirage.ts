import { MapBuilder } from './builder.js';
import type { MapDef } from './types.js';

/**
 * Simplified de_mirage, 88×62 tiles. T spawn east (right), CT spawn
 * south-west, A site south (bottom-center), B site north-west (top-left).
 *
 * Topology preserved from the real map:
 *   T spawn → T Ramp → A Ramp → A Site, and T Ramp → Palace → A Site.
 *   T spawn → Top Mid → Mid → Connector/Jungle → A Site.
 *   Mid → Short → B Site; Mid → Ladder Room → Arch → B Site / CT.
 *   T spawn → B Apartments → B Site.
 *   CT spawn → Ticket → A Site; CT spawn → Arch/Market → B Site;
 *   CT spawn → Window room (overlooks mid through the window).
 */
function buildMirage(): MapDef {
  const b = new MapBuilder(88, 62);

  // ── T spawn (east) ──
  b.carve(70, 26, 14, 12); // x70-83, y26-37

  // ── A site (south-center) ──
  b.carve(28, 44, 20, 14); // x28-47, y44-57
  b.site('A', 32, 47, 10, 7); // plant zone x32-41, y47-53
  b.box(33, 48, 2, 2); // "triple" stack
  b.box(44, 50, 2, 2); // firebox
  b.box(29, 55, 2, 2); // CT-side cover by ticket

  // T Ramp: T spawn ↓ toward A
  b.carve(62, 38, 12, 4); // x62-73, y38-41
  // A Ramp: down and west into A
  b.carve(58, 42, 6, 6); // x58-63, y42-47
  b.carve(48, 48, 16, 4); // x48-63, y48-51
  b.box(52, 48, 1, 2); // ramp cover
  // Palace: T Ramp ↓ then west onto A's balcony
  b.carve(66, 42, 4, 14); // x66-69, y42-55
  b.carve(48, 54, 22, 3); // x48-69, y54-56
  b.wall(55, 54, 1, 1);
  b.wall(55, 56, 1, 1); // palace door pinch at y55

  // ── Mid ──
  b.carve(56, 28, 14, 5); // top mid x56-69, y28-32
  b.carve(26, 26, 30, 8); // mid x26-55, y26-33
  b.box(46, 29, 2, 2); // mid boxes
  // Connector → Jungle → A
  b.carve(36, 34, 4, 6); // connector x36-39, y34-39
  b.carve(30, 40, 10, 4); // jungle x30-39, y40-43
  // Short: mid ↑ then west into B
  b.carve(40, 14, 4, 12); // x40-43, y14-25
  b.carve(24, 14, 20, 3); // x24-43, y14-16
  // Ladder room / underpass: bottom mid ↔ arch
  b.carve(12, 24, 14, 3); // x12-25, y24-26

  // Window room: overlooks mid via a one-tile window, drops to CT
  b.carve(18, 28, 6, 5); // x18-23, y28-32
  b.carve(24, 30, 2, 1); // the window x24-25, y30
  b.carve(18, 33, 4, 9); // x18-21, y33-41 down to CT spawn

  // ── B site (north-west) ──
  b.carve(6, 6, 18, 14); // x6-23, y6-19
  b.site('B', 9, 9, 9, 7); // plant zone x9-17, y9-15
  b.box(7, 7, 2, 2); // bench corner
  b.box(19, 12, 2, 2); // van
  b.box(15, 17, 2, 1);

  // B Apartments: T spawn ↑ then west into B
  b.carve(74, 8, 4, 18); // x74-77, y8-25
  b.carve(24, 8, 54, 4); // x24-77, y8-11
  b.carve(50, 4, 12, 4); // apartments room x50-61, y4-7
  b.wall(30, 8, 1, 2); // apps exit pinch: gap at y10-11
  b.box(56, 5, 2, 1);

  // ── CT spawn (south-west) ──
  b.carve(8, 42, 12, 10); // x8-19, y42-51
  b.carve(20, 46, 8, 4); // ticket: CT ↔ A, x20-27, y46-49
  b.carve(8, 20, 4, 22); // arch / market: CT ↔ B, x8-11, y20-41

  for (let i = 0; i < 5; i++) {
    b.spawn('T', 74 + i, 30);
    b.spawn('T', 74 + i, 32);
    b.spawn('CT', 10 + i, 45);
    b.spawn('CT', 10 + i, 47);
  }

  b.buyzone('T', 70, 26, 14, 12);
  b.buyzone('CT', 8, 42, 12, 10);

  b.utilitySpot('smoke', 'A', 24, 47); // CT / ticket entrance
  b.utilitySpot('smoke', 'A', 34, 41); // jungle
  b.utilitySpot('flash', 'A', 46, 49); // over A ramp into site
  b.utilitySpot('smoke', 'B', 24, 15); // short exit
  b.utilitySpot('smoke', 'B', 10, 21); // arch / market
  b.utilitySpot('flash', 'B', 25, 10); // apps exit into B

  b.callout('A Site', 37, 51)
    .callout('A Ramp', 56, 50)
    .callout('Palace', 60, 55)
    .callout('T Ramp', 67, 39)
    .callout('Ticket', 24, 47)
    .callout('Jungle', 34, 41)
    .callout('Connector', 37, 36)
    .callout('Top Mid', 62, 30)
    .callout('Mid', 40, 30)
    .callout('Window', 20, 30)
    .callout('Ladder Room', 18, 25)
    .callout('Short', 42, 20)
    .callout('B Site', 13, 12)
    .callout('Apartments', 55, 6)
    .callout('Arch', 9, 30)
    .callout('CT Spawn', 13, 48)
    .callout('T Spawn', 76, 31);

  return b.build('mirage', 'Mirage');
}

export const MIRAGE: MapDef = buildMirage();
