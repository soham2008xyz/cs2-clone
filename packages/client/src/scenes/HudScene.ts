import Phaser from 'phaser';
import type { SelfState } from '@cs2d/shared';

interface KillEntry {
  text: Phaser.GameObjects.Text;
  until: number;
}

/**
 * Screen-fixed UI on its own scene so camera zoom never distorts it.
 * Listens to game-level events emitted by GameScene.
 */
export class HudScene extends Phaser.Scene {
  private hpText!: Phaser.GameObjects.Text;
  private ammoText!: Phaser.GameObjects.Text;
  private moneyText!: Phaser.GameObjects.Text;
  private weaponText!: Phaser.GameObjects.Text;
  private deadText!: Phaser.GameObjects.Text;
  private crosshair!: Phaser.GameObjects.Graphics;
  private hitmarker!: Phaser.GameObjects.Graphics;
  private hitmarkerUntil = 0;
  private hurtOverlay!: Phaser.GameObjects.Rectangle;
  private killfeed: KillEntry[] = [];

  constructor() {
    super('Hud');
  }

  create(): void {
    const style = { fontFamily: 'monospace', fontSize: '18px', color: '#ffffff' };

    this.hurtOverlay = this.add
      .rectangle(0, 0, this.scale.width * 2, this.scale.height * 2, 0xaa0000, 0)
      .setOrigin(0);

    this.hpText = this.add.text(16, this.scale.height - 40, '', { ...style, fontSize: '22px' }).setShadow(1, 1, '#000', 2);
    this.ammoText = this.add
      .text(this.scale.width - 16, this.scale.height - 40, '', { ...style, fontSize: '22px' })
      .setOrigin(1, 0)
      .setShadow(1, 1, '#000', 2);
    this.weaponText = this.add
      .text(this.scale.width - 16, this.scale.height - 64, '', { ...style, color: '#c9c9c9', fontSize: '14px' })
      .setOrigin(1, 0)
      .setShadow(1, 1, '#000', 2);
    this.moneyText = this.add.text(16, this.scale.height - 64, '', { ...style, color: '#8fd18f', fontSize: '16px' }).setShadow(1, 1, '#000', 2);
    this.deadText = this.add
      .text(this.scale.width / 2, this.scale.height / 2 + 80, 'YOU DIED', { ...style, fontSize: '28px', color: '#ff6b6b' })
      .setOrigin(0.5)
      .setShadow(2, 2, '#000', 4)
      .setVisible(false);

    this.crosshair = this.add.graphics();
    this.hitmarker = this.add.graphics();

    this.game.events.on('hud:self', this.onSelf, this);
    this.game.events.on('hud:kill', this.onKill, this);
    this.game.events.on('hud:hitmarker', () => (this.hitmarkerUntil = this.time.now + 90));
    this.game.events.on('hud:hurt', this.onHurt, this);
    this.events.once('shutdown', () => {
      this.game.events.off('hud:self', this.onSelf, this);
      this.game.events.off('hud:kill', this.onKill, this);
      this.game.events.off('hud:hitmarker');
      this.game.events.off('hud:hurt', this.onHurt, this);
    });

    this.scale.on('resize', () => this.layout());
    this.layout();
  }

  private layout(): void {
    this.hpText.setY(this.scale.height - 40);
    this.ammoText.setPosition(this.scale.width - 16, this.scale.height - 40);
    this.weaponText.setPosition(this.scale.width - 16, this.scale.height - 64);
    this.moneyText.setY(this.scale.height - 64);
    this.deadText.setPosition(this.scale.width / 2, this.scale.height / 2 + 80);
  }

  private onSelf(payload: { hp: number; alive: boolean; me: SelfState | null }): void {
    const { hp, alive, me } = payload;
    this.hpText.setText(`♥ ${Math.max(0, hp)}${me && me.armor > 0 ? `  ⛨ ${me.armor}` : ''}`);
    this.deadText.setVisible(!alive);
    if (me) {
      this.moneyText.setText(`$ ${me.money}`);
      if (me.weapon === 'knife') {
        this.ammoText.setText('—');
      } else if (me.reload > 0) {
        this.ammoText.setText('RELOADING');
      } else {
        this.ammoText.setText(`${me.ammo} / ${me.reserve}`);
      }
      this.weaponText.setText(me.weapon.toUpperCase());
    }
  }

  private onKill(k: { killer: string; victim: string; weapon: string; meKiller: boolean; meVictim: boolean }): void {
    const color = k.meKiller ? '#ffd76b' : k.meVictim ? '#ff6b6b' : '#dddddd';
    const t = this.add
      .text(this.scale.width - 16, 16, `${k.killer}  [${k.weapon}]  ${k.victim}`, {
        fontFamily: 'monospace',
        fontSize: '13px',
        color,
      })
      .setOrigin(1, 0)
      .setShadow(1, 1, '#000', 2);
    this.killfeed.push({ text: t, until: this.time.now + 6000 });
  }

  private onHurt(_damage: number): void {
    this.hurtOverlay.setFillStyle(0xaa0000, 0.28);
    this.tweens.add({ targets: this.hurtOverlay, fillAlpha: 0, duration: 350 });
  }

  update(): void {
    // killfeed stack + expiry
    const now = this.time.now;
    this.killfeed = this.killfeed.filter((e) => {
      if (e.until <= now) {
        e.text.destroy();
        return false;
      }
      return true;
    });
    this.killfeed.forEach((e, i) => e.text.setPosition(this.scale.width - 16, 16 + i * 18));

    // crosshair at pointer
    const p = this.input.activePointer;
    this.crosshair.clear();
    this.crosshair.lineStyle(1.5, 0x7dff7d, 0.95);
    const g = 4; // gap
    const l = 7; // arm length
    this.crosshair.lineBetween(p.x - g - l, p.y, p.x - g, p.y);
    this.crosshair.lineBetween(p.x + g, p.y, p.x + g + l, p.y);
    this.crosshair.lineBetween(p.x, p.y - g - l, p.x, p.y - g);
    this.crosshair.lineBetween(p.x, p.y + g, p.x, p.y + g + l);

    // hitmarker
    this.hitmarker.clear();
    if (this.hitmarkerUntil > now) {
      this.hitmarker.lineStyle(2, 0xffffff, 0.9);
      const o = 6;
      const s = 5;
      this.hitmarker.lineBetween(p.x - o - s, p.y - o - s, p.x - o, p.y - o);
      this.hitmarker.lineBetween(p.x + o, p.y - o, p.x + o + s, p.y - o - s);
      this.hitmarker.lineBetween(p.x - o - s, p.y + o + s, p.x - o, p.y + o);
      this.hitmarker.lineBetween(p.x + o, p.y + o, p.x + o + s, p.y + o + s);
    }
  }
}
