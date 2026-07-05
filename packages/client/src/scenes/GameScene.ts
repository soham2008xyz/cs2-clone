import Phaser from 'phaser';
import {
  CH,
  getMap,
  stepMovement,
  TICK_DT,
  TICK_MS,
  TILE_SIZE,
  type CompiledMap,
  type Vec2,
} from '@cs2d/shared';
import { playerTexture } from './BootScene.js';
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

/**
 * Phase 1: local single-player walkabout. The same fixed-timestep loop and
 * shared stepMovement() later become the client-side prediction path.
 */
export class GameScene extends Phaser.Scene {
  private map!: CompiledMap;
  private player!: Phaser.GameObjects.Sprite;
  private pos: Vec2 = { x: 0, y: 0 };
  private keys!: Record<'W' | 'A' | 'S' | 'D' | 'SHIFT', Phaser.Input.Keyboard.Key>;
  private accumulator = 0;
  private debugText!: Phaser.GameObjects.Text;

  constructor() {
    super('Game');
  }

  create(): void {
    this.map = getMap('dust2');

    // tilemap from shared map data
    const data: number[][] = [];
    for (let ty = 0; ty < this.map.height; ty++) {
      const row: number[] = [];
      for (let tx = 0; tx < this.map.width; tx++) {
        row.push(CHAR_TO_TILE[this.map.charAt(tx, ty)] ?? TILE_INDEX.FLOOR);
      }
      data.push(row);
    }
    const tilemap = this.make.tilemap({ data, tileWidth: TILE_SIZE, tileHeight: TILE_SIZE });
    const tileset = tilemap.addTilesetImage('tiles', 'tiles', TILE_SIZE, TILE_SIZE, 0, 0)!;
    tilemap.createLayer(0, tileset, 0, 0);

    // bombsite letters
    for (const site of ['A', 'B'] as const) {
      const c = this.map.siteCenters[site];
      this.add
        .text(c.x, c.y, site, { fontFamily: 'Arial Black', fontSize: '48px', color: '#7a2e1d' })
        .setOrigin(0.5)
        .setAlpha(0.5);
    }

    // player
    this.pos = { ...this.map.spawns.T[0] };
    this.player = this.add.sprite(this.pos.x, this.pos.y, playerTexture(this, 'T'));

    this.cameras.main.setBounds(0, 0, this.map.widthPx, this.map.heightPx);
    this.cameras.main.startFollow(this.player, true, 0.15, 0.15);
    this.cameras.main.setZoom(1.25);

    this.keys = this.input.keyboard!.addKeys('W,A,S,D,SHIFT') as GameScene['keys'];

    this.debugText = this.add
      .text(8, 8, '', { fontFamily: 'monospace', fontSize: '13px', color: '#ffffff' })
      .setScrollFactor(0)
      .setDepth(100)
      .setShadow(1, 1, '#000', 2);
  }

  private nearestCallout(): string {
    let best = '';
    let bestD = Infinity;
    for (const c of this.map.def.callouts) {
      const d = Math.hypot((c.tx + 0.5) * TILE_SIZE - this.pos.x, (c.ty + 0.5) * TILE_SIZE - this.pos.y);
      if (d < bestD) {
        bestD = d;
        best = c.name;
      }
    }
    return best;
  }

  update(_time: number, deltaMs: number): void {
    // fixed-timestep simulation (same cadence the server runs)
    this.accumulator += Math.min(deltaMs, 250);
    while (this.accumulator >= TICK_MS) {
      this.accumulator -= TICK_MS;
      this.pos = stepMovement(
        this.pos,
        {
          up: this.keys.W.isDown,
          down: this.keys.S.isDown,
          left: this.keys.A.isDown,
          right: this.keys.D.isDown,
          walk: this.keys.SHIFT.isDown,
        },
        1,
        this.map,
        TICK_DT,
      );
    }

    this.player.setPosition(this.pos.x, this.pos.y);

    // aim at pointer
    const pointer = this.input.activePointer;
    const world = this.cameras.main.getWorldPoint(pointer.x, pointer.y);
    this.player.setRotation(Math.atan2(world.y - this.pos.y, world.x - this.pos.x));

    this.debugText.setText(
      `${this.nearestCallout()}  (${Math.round(this.pos.x)}, ${Math.round(this.pos.y)})  fps ${Math.round(this.game.loop.actualFps)}`,
    );
  }
}
