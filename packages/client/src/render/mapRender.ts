import Phaser from 'phaser';
import { CH, TILE_SIZE, type CompiledMap } from '@cs2d/shared';
import { TILE_INDEX } from '../textures.js';

const CHAR_TO_TILE: Record<string, number> = {
  [CH.WALL]: TILE_INDEX.WALL,
  [CH.BOX]: TILE_INDEX.BOX,
  [CH.FLOOR]: TILE_INDEX.FLOOR,
  [CH.SITE_A]: TILE_INDEX.SITE_A,
  [CH.SITE_B]: TILE_INDEX.SITE_B,
  [CH.T_SPAWN]: TILE_INDEX.FLOOR,
  [CH.CT_SPAWN]: TILE_INDEX.FLOOR,
};

/** Builds the tile layer + bombsite letters for a compiled map. */
export function renderMap(scene: Phaser.Scene, map: CompiledMap): void {
  const data: number[][] = [];
  for (let ty = 0; ty < map.height; ty++) {
    const row: number[] = [];
    for (let tx = 0; tx < map.width; tx++) {
      row.push(CHAR_TO_TILE[map.charAt(tx, ty)] ?? TILE_INDEX.FLOOR);
    }
    data.push(row);
  }
  const tilemap = scene.make.tilemap({ data, tileWidth: TILE_SIZE, tileHeight: TILE_SIZE });
  const tileset = tilemap.addTilesetImage('tiles', 'tiles', TILE_SIZE, TILE_SIZE, 0, 0)!;
  tilemap.createLayer(0, tileset, 0, 0);

  for (const site of ['A', 'B'] as const) {
    const c = map.siteCenters[site];
    scene.add
      .text(c.x, c.y, site, { fontFamily: 'Arial Black', fontSize: '48px', color: '#7a2e1d' })
      .setOrigin(0.5)
      .setAlpha(0.5);
  }

  for (const callout of map.def.callouts) {
    scene.add
      .text((callout.tx + 0.5) * TILE_SIZE, (callout.ty + 0.5) * TILE_SIZE, callout.name.toUpperCase(), {
        fontFamily: 'monospace',
        fontSize: '12px',
        color: '#dddddd',
      })
      .setOrigin(0.5)
      .setAlpha(0.35)
      .setDepth(2);
  }
}
