import Phaser from 'phaser';
import { TILE_SIZE } from '@cs2d/shared';

/**
 * Procedurally generated textures. These are the guaranteed baseline so the
 * game never depends on downloaded assets; BootScene swaps in Kenney sprites
 * for players/crates when they are present in /assets.
 */

export const TILE_INDEX = {
  FLOOR: 0,
  WALL: 1,
  BOX: 2,
  SITE_A: 3,
  SITE_B: 4,
} as const;

const PALETTE = {
  sand: '#c2a76e',
  sandDark: '#b39a63',
  wall: '#6e5f43',
  wallEdge: '#4e4330',
  box: '#8a6f43',
  boxEdge: '#5f4c2c',
  siteA: '#c49a5e',
  siteB: '#b9a05e',
};

function noiseRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  base: string,
  dark: string,
  rng: () => number,
): void {
  ctx.fillStyle = base;
  ctx.fillRect(x, y, TILE_SIZE, TILE_SIZE);
  ctx.fillStyle = dark;
  for (let i = 0; i < 14; i++) {
    ctx.globalAlpha = 0.25 + rng() * 0.3;
    ctx.fillRect(x + Math.floor(rng() * TILE_SIZE), y + Math.floor(rng() * TILE_SIZE), 2, 2);
  }
  ctx.globalAlpha = 1;
}

export function generateTileset(scene: Phaser.Scene): void {
  if (scene.textures.exists('tiles')) return;
  const count = 5;
  const canvas = document.createElement('canvas');
  canvas.width = TILE_SIZE * count;
  canvas.height = TILE_SIZE;
  const ctx = canvas.getContext('2d')!;
  let seed = 1337;
  const rng = () => {
    seed = (seed * 16807) % 2147483647;
    return seed / 2147483647;
  };

  // floor
  noiseRect(ctx, TILE_INDEX.FLOOR * TILE_SIZE, 0, PALETTE.sand, PALETTE.sandDark, rng);

  // wall
  const wx = TILE_INDEX.WALL * TILE_SIZE;
  ctx.fillStyle = PALETTE.wall;
  ctx.fillRect(wx, 0, TILE_SIZE, TILE_SIZE);
  ctx.strokeStyle = PALETTE.wallEdge;
  ctx.lineWidth = 2;
  ctx.strokeRect(wx + 1, 1, TILE_SIZE - 2, TILE_SIZE - 2);

  // box / crate
  const bx = TILE_INDEX.BOX * TILE_SIZE;
  ctx.fillStyle = PALETTE.box;
  ctx.fillRect(bx, 0, TILE_SIZE, TILE_SIZE);
  ctx.strokeStyle = PALETTE.boxEdge;
  ctx.lineWidth = 2;
  ctx.strokeRect(bx + 2, 2, TILE_SIZE - 4, TILE_SIZE - 4);
  ctx.beginPath();
  ctx.moveTo(bx + 2, 2);
  ctx.lineTo(bx + TILE_SIZE - 2, TILE_SIZE - 2);
  ctx.moveTo(bx + TILE_SIZE - 2, 2);
  ctx.lineTo(bx + 2, TILE_SIZE - 2);
  ctx.stroke();

  // bombsite floors (tinted sand)
  noiseRect(ctx, TILE_INDEX.SITE_A * TILE_SIZE, 0, PALETTE.siteA, PALETTE.sandDark, rng);
  noiseRect(ctx, TILE_INDEX.SITE_B * TILE_SIZE, 0, PALETTE.siteB, PALETTE.sandDark, rng);

  scene.textures.addCanvas('tiles', canvas);
}

/** Fallback player marker: team-colored circle with a barrel, facing +x. */
export function generatePlayerTexture(scene: Phaser.Scene, key: string, color: number): void {
  if (scene.textures.exists(key)) return;
  const g = scene.make.graphics({ x: 0, y: 0 }, false);
  const s = 48;
  const c = s / 2;
  // barrel
  g.fillStyle(0x222222, 1);
  g.fillRect(c, c - 3, 20, 6);
  // body
  g.fillStyle(color, 1);
  g.fillCircle(c, c, 13);
  g.lineStyle(2, 0x111111, 0.8);
  g.strokeCircle(c, c, 13);
  // facing wedge
  g.fillStyle(0xffffff, 0.85);
  g.fillTriangle(c + 4, c - 5, c + 4, c + 5, c + 12, c);
  g.generateTexture(key, s, s);
  g.destroy();
}

export const TEAM_COLORS = { T: 0xd9a33c, CT: 0x4a7fd4 } as const;
