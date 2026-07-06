import Phaser from 'phaser';
import { BootScene } from './scenes/BootScene.js';
import { GameScene } from './scenes/GameScene.js';
import { HudScene } from './scenes/HudScene.js';
import { initMenu } from './menu.js';

let game: Phaser.Game | null = null;

function startGame(): void {
  document.getElementById('menu')!.style.display = 'none';
  document.getElementById('game')!.style.display = 'block';

  game = new Phaser.Game({
    type: Phaser.AUTO,
    parent: 'game',
    backgroundColor: '#1a1710',
    scale: {
      mode: Phaser.Scale.RESIZE,
      width: '100%',
      height: '100%',
    },
    render: {
      roundPixels: true,
      antialias: true,
    },
    scene: [BootScene, GameScene, HudScene],
  });

  game.events.once('session:end', returnToMenu);
}

function returnToMenu(): void {
  game?.destroy(true);
  game = null;
  document.getElementById('game')!.style.display = 'none';
  document.getElementById('menu')!.style.display = 'flex';
}

initMenu(startGame);
