import Phaser from 'phaser';
import { generatePlayerTexture, generateTileset, TEAM_COLORS } from '../textures.js';

/**
 * Generates baseline procedural textures, then opportunistically loads Kenney
 * sprites from /assets (if the manifest exists) to upgrade the look.
 */
export class BootScene extends Phaser.Scene {
  constructor() {
    super('Boot');
  }

  preload(): void {
    generateTileset(this);
    generatePlayerTexture(this, 'player_T_fallback', TEAM_COLORS.T);
    generatePlayerTexture(this, 'player_CT_fallback', TEAM_COLORS.CT);

    this.load.on('loaderror', (file: Phaser.Loader.File) => {
      console.warn(`[assets] failed to load ${file.key}, using fallback`);
    });
    // Kenney sprites (optional upgrade; missing files are tolerated)
    this.load.image('kenney_T', 'assets/man_brown_gun.png');
    this.load.image('kenney_CT', 'assets/soldier1_gun.png');
  }

  create(): void {
    this.scene.start('Game');
  }
}

/** Resolve the best available texture for a team's player sprite. */
export function playerTexture(scene: Phaser.Scene, team: 'T' | 'CT'): string {
  const kenney = `kenney_${team}`;
  return scene.textures.exists(kenney) ? kenney : `player_${team}_fallback`;
}
