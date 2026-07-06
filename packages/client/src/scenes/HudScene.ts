import Phaser from 'phaser';
import {
  FLASH_MAX_BLIND,
  getGrenade,
  GRENADES,
  PRICE_DEFUSE_KIT,
  PRICE_HELMET,
  PRICE_KEVLAR,
  TICK_RATE,
  WEAPONS,
  type MatchSnap,
  type RosterEntry,
  type SelfState,
  type TeamId,
} from '@cs2d/shared';

interface KillEntry {
  text: Phaser.GameObjects.Text;
  until: number;
}

interface SelfPayload {
  hp: number;
  alive: boolean;
  me: SelfState | null;
  team: TeamId;
  match: MatchSnap | null;
}

const MONO = 'monospace';

/** Screen-fixed UI. Listens to game-level events emitted by GameScene. */
export class HudScene extends Phaser.Scene {
  private hpText!: Phaser.GameObjects.Text;
  private ammoText!: Phaser.GameObjects.Text;
  private moneyText!: Phaser.GameObjects.Text;
  private weaponText!: Phaser.GameObjects.Text;
  private timerText!: Phaser.GameObjects.Text;
  private scoreText!: Phaser.GameObjects.Text;
  private bannerText!: Phaser.GameObjects.Text;
  private bannerUntil = 0;
  private bombHint!: Phaser.GameObjects.Text;
  private spectateText!: Phaser.GameObjects.Text;
  private progressBar!: Phaser.GameObjects.Graphics;
  private crosshair!: Phaser.GameObjects.Graphics;
  private hitmarker!: Phaser.GameObjects.Graphics;
  private hitmarkerUntil = 0;
  private hurtOverlay!: Phaser.GameObjects.Rectangle;
  private blindOverlay!: Phaser.GameObjects.Rectangle;
  private nadeText!: Phaser.GameObjects.Text;
  private killfeed: KillEntry[] = [];
  private buyPanel!: Phaser.GameObjects.Container;
  private buyOpen = false;
  private scorePanel!: Phaser.GameObjects.Container;
  private roster: RosterEntry[] = [];
  private lastSelf: SelfPayload | null = null;
  private pingText!: Phaser.GameObjects.Text;
  private teamHintText!: Phaser.GameObjects.Text;
  private matchEndPanel!: Phaser.GameObjects.Container;

  constructor() {
    super('Hud');
  }

  create(): void {
    const style = { fontFamily: MONO, fontSize: '18px', color: '#ffffff' };

    this.hurtOverlay = this.add.rectangle(0, 0, this.scale.width * 2, this.scale.height * 2, 0xaa0000, 0).setOrigin(0).setDepth(90);
    this.blindOverlay = this.add.rectangle(0, 0, this.scale.width * 2, this.scale.height * 2, 0xffffff, 0).setOrigin(0).setDepth(95);

    this.hpText = this.add.text(16, 0, '', { ...style, fontSize: '22px' }).setShadow(1, 1, '#000', 2);
    this.ammoText = this.add.text(0, 0, '', { ...style, fontSize: '22px' }).setOrigin(1, 0).setShadow(1, 1, '#000', 2);
    this.weaponText = this.add.text(0, 0, '', { ...style, color: '#c9c9c9', fontSize: '14px' }).setOrigin(1, 0).setShadow(1, 1, '#000', 2);
    this.nadeText = this.add.text(0, 0, '', { ...style, color: '#dddddd', fontSize: '13px' }).setOrigin(1, 0).setShadow(1, 1, '#000', 2);
    this.moneyText = this.add.text(16, 0, '', { ...style, color: '#8fd18f', fontSize: '16px' }).setShadow(1, 1, '#000', 2);
    this.timerText = this.add.text(0, 10, '', { ...style, fontSize: '24px' }).setOrigin(0.5, 0).setShadow(1, 1, '#000', 3);
    this.scoreText = this.add.text(0, 40, '', { ...style, fontSize: '15px' }).setOrigin(0.5, 0).setShadow(1, 1, '#000', 2);
    this.bannerText = this.add.text(0, 0, '', { ...style, fontSize: '30px', fontStyle: 'bold' }).setOrigin(0.5).setShadow(2, 2, '#000', 4).setVisible(false);
    this.bombHint = this.add.text(0, 0, '', { ...style, fontSize: '14px', color: '#ffd280' }).setOrigin(0.5).setShadow(1, 1, '#000', 2);
    this.spectateText = this.add.text(0, 0, '', { ...style, fontSize: '15px', color: '#bbbbbb' }).setOrigin(0.5).setShadow(1, 1, '#000', 2);
    this.progressBar = this.add.graphics();
    this.crosshair = this.add.graphics();
    this.hitmarker = this.add.graphics();
    this.pingText = this.add.text(0, 0, '', { ...style, fontSize: '11px', color: '#888888' }).setOrigin(1, 0);
    this.teamHintText = this.add
      .text(0, 0, '[ = Join T    ] = Join CT', { ...style, fontSize: '13px', color: '#cccccc' })
      .setOrigin(0.5)
      .setShadow(1, 1, '#000', 2);

    this.buildBuyPanel('T');
    this.scorePanel = this.add.container(0, 0).setVisible(false);
    this.matchEndPanel = this.add.container(0, 0).setVisible(false).setDepth(150);

    this.input.keyboard!.on('keydown-B', () => this.toggleBuy());
    this.input.keyboard!.on('keydown-TAB', (e: KeyboardEvent) => {
      e.preventDefault();
      this.updateScoreboard();
      this.scorePanel.setVisible(true);
    });
    this.input.keyboard!.on('keyup-TAB', () => this.scorePanel.setVisible(false));

    this.game.events.on('hud:self', this.onSelf, this);
    this.game.events.on('hud:kill', this.onKill, this);
    this.game.events.on('hud:hitmarker', this.onHitmarker, this);
    this.game.events.on('hud:hurt', this.onHurt, this);
    this.game.events.on('hud:banner', this.onBanner, this);
    this.game.events.on('hud:roster', this.onRoster, this);
    this.game.events.on('hud:spectate', this.onSpectate, this);
    this.game.events.on('hud:ping', this.onPing, this);
    this.game.events.on('hud:matchend', this.onMatchEnd, this);
    this.events.once('shutdown', () => {
      this.game.events.off('hud:self', this.onSelf, this);
      this.game.events.off('hud:kill', this.onKill, this);
      this.game.events.off('hud:hitmarker', this.onHitmarker, this);
      this.game.events.off('hud:hurt', this.onHurt, this);
      this.game.events.off('hud:banner', this.onBanner, this);
      this.game.events.off('hud:roster', this.onRoster, this);
      this.game.events.off('hud:spectate', this.onSpectate, this);
      this.game.events.off('hud:ping', this.onPing, this);
      this.game.events.off('hud:matchend', this.onMatchEnd, this);
    });

    this.scale.on('resize', () => this.layout());
    this.layout();
  }

  private layout(): void {
    const w = this.scale.width;
    const h = this.scale.height;
    this.hpText.setPosition(16, h - 40);
    this.ammoText.setPosition(w - 16, h - 40);
    this.weaponText.setPosition(w - 16, h - 64);
    this.nadeText.setPosition(w - 16, h - 84);
    this.moneyText.setPosition(16, h - 64);
    this.timerText.setX(w / 2);
    this.scoreText.setX(w / 2);
    this.bannerText.setPosition(w / 2, h * 0.3);
    this.bombHint.setPosition(w / 2, h - 90);
    this.spectateText.setPosition(w / 2, h - 60);
    this.buyPanel?.setPosition(w / 2, h / 2);
    this.scorePanel?.setPosition(w / 2, h * 0.22);
    this.pingText.setPosition(w - 16, 10);
    this.teamHintText.setPosition(w / 2, 66);
    this.matchEndPanel?.setPosition(w / 2, h / 2);
  }

  // ── buy menu ───────────────────────────────────────────────────────────────

  private buildBuyPanel(team: TeamId): void {
    this.buyPanel?.destroy();
    this.buyPanel = this.add.container(this.scale.width / 2, this.scale.height / 2).setVisible(this.buyOpen);

    const items: Array<{ id: string; label: string; price: number }> = [];
    for (const w of Object.values(WEAPONS)) {
      if (w.cls === 'knife') continue;
      if (w.team && w.team !== team) continue;
      items.push({ id: w.id, label: w.name, price: w.price });
    }
    items.push({ id: 'kevlar', label: 'Kevlar', price: PRICE_KEVLAR });
    items.push({ id: 'helmet', label: 'Helmet', price: PRICE_HELMET });
    if (team === 'CT') items.push({ id: 'kit', label: 'Defuse Kit', price: PRICE_DEFUSE_KIT });
    for (const g of Object.values(GRENADES)) {
      if (g.team && g.team !== team) continue;
      items.push({ id: g.id, label: g.name, price: g.price });
    }

    const rowH = 30;
    const width = 300;
    const height = items.length * rowH + 56;
    const bg = this.add.rectangle(0, 0, width, height, 0x0a0a0a, 0.88).setStrokeStyle(1, 0x555555);
    this.buyPanel.add(bg);
    const title = this.add.text(0, -height / 2 + 14, `BUY  (${team})`, { fontFamily: MONO, fontSize: '16px', color: '#ffffff' }).setOrigin(0.5);
    this.buyPanel.add(title);

    items.forEach((item, i) => {
      const y = -height / 2 + 48 + i * rowH;
      const row = this.add
        .text(-width / 2 + 16, y, `${item.label.padEnd(16)} $${item.price}`, { fontFamily: MONO, fontSize: '15px', color: '#dddddd' })
        .setOrigin(0, 0.5)
        .setInteractive({ useHandCursor: true });
      row.on('pointerover', () => row.setColor('#ffe680'));
      row.on('pointerout', () => row.setColor('#dddddd'));
      row.on('pointerdown', () => {
        this.game.events.emit('buy', item.id);
      });
      this.buyPanel.add(row);
    });
  }

  private toggleBuy(): void {
    this.buyOpen = !this.buyOpen;
    if (this.buyOpen && this.lastSelf) this.buildBuyPanel(this.lastSelf.team);
    this.buyPanel.setVisible(this.buyOpen);
    this.layout();
  }

  // ── scoreboard ─────────────────────────────────────────────────────────────

  private updateScoreboard(): void {
    this.scorePanel.removeAll(true);
    const width = 400;
    const rows = this.roster.length + 4;
    const height = rows * 22 + 20;
    this.scorePanel.add(this.add.rectangle(0, height / 2, width, height, 0x0a0a0a, 0.88).setStrokeStyle(1, 0x555555));
    let y = 16;
    for (const team of ['CT', 'T'] as const) {
      const color = team === 'CT' ? '#9cc4ff' : '#ffd280';
      this.scorePanel.add(
        this.add.text(-width / 2 + 16, y, team === 'CT' ? 'COUNTER-TERRORISTS' : 'TERRORISTS', { fontFamily: MONO, fontSize: '14px', color }).setOrigin(0, 0.5),
      );
      this.scorePanel.add(this.add.text(width / 2 - 16, y, 'K / D', { fontFamily: MONO, fontSize: '12px', color: '#888888' }).setOrigin(1, 0.5));
      y += 24;
      for (const p of this.roster.filter((r) => r.team === team)) {
        this.scorePanel.add(this.add.text(-width / 2 + 24, y, p.name, { fontFamily: MONO, fontSize: '13px', color: '#eeeeee' }).setOrigin(0, 0.5));
        this.scorePanel.add(this.add.text(width / 2 - 16, y, `${p.k} / ${p.d}`, { fontFamily: MONO, fontSize: '13px', color: '#cccccc' }).setOrigin(1, 0.5));
        y += 22;
      }
      y += 8;
    }
  }

  // ── event handlers ────────────────────────────────────────────────────────

  private onRoster(entries: RosterEntry[]): void {
    this.roster = entries;
    if (this.scorePanel.visible) this.updateScoreboard();
  }

  private onSpectate(name: string | null): void {
    this.spectateText.setText(name ? `SPECTATING ${name}  (SPACE to cycle)` : '');
  }

  private onBanner(b: { text: string; color: string; ttl: number }): void {
    this.bannerText.setText(b.text).setColor(b.color).setVisible(true);
    this.bannerUntil = this.time.now + b.ttl;
  }

  private onHitmarker(): void {
    this.hitmarkerUntil = this.time.now + 90;
  }

  private onPing(ms: number): void {
    this.pingText.setText(`${ms}ms`);
  }

  private onMatchEnd(payload: { winner: TeamId; roster: RosterEntry[] }): void {
    this.matchEndPanel.removeAll(true);
    const width = 380;
    const sorted = [...payload.roster].sort((a, b) => b.k - a.k);
    const height = sorted.length * 20 + 90;
    this.matchEndPanel.add(this.add.rectangle(0, 0, width, height, 0x0a0a0a, 0.92).setStrokeStyle(1, 0x555555));
    const color = payload.winner === 'T' ? '#ffd280' : '#9cc4ff';
    this.matchEndPanel.add(
      this.add
        .text(0, -height / 2 + 20, `${payload.winner === 'T' ? 'TERRORISTS' : 'COUNTER-TERRORISTS'} WIN`, { fontFamily: MONO, fontSize: '18px', color })
        .setOrigin(0.5),
    );
    this.matchEndPanel.add(
      this.add.text(0, -height / 2 + 44, 'returning to menu…', { fontFamily: MONO, fontSize: '12px', color: '#888888' }).setOrigin(0.5),
    );
    sorted.forEach((p, i) => {
      const y = -height / 2 + 70 + i * 20;
      const teamColor = p.team === 'T' ? '#ffd280' : '#9cc4ff';
      this.matchEndPanel.add(this.add.text(-width / 2 + 20, y, `${p.name}${p.bot ? ' (bot)' : ''}`, { fontFamily: MONO, fontSize: '13px', color: teamColor }).setOrigin(0, 0.5));
      this.matchEndPanel.add(this.add.text(width / 2 - 20, y, `${p.k} / ${p.d}`, { fontFamily: MONO, fontSize: '13px', color: '#cccccc' }).setOrigin(1, 0.5));
    });
    this.matchEndPanel.setVisible(true);
    this.layout();
  }

  private onSelf(payload: SelfPayload): void {
    const teamChanged = this.lastSelf?.team !== payload.team;
    this.lastSelf = payload;
    if (teamChanged) this.buildBuyPanel(payload.team);
    const { hp, alive, me, match } = payload;

    this.hpText.setText(alive ? `♥ ${Math.max(0, hp)}${me && me.armor > 0 ? `  ⛨ ${me.armor}${me.helm ? '+' : ''}` : ''}` : '');
    if (me) {
      this.moneyText.setText(`$ ${me.money}${me.buy ? '  [B] BUY' : ''}`);
      if (me.slot === 4 && me.nades?.length) {
        this.ammoText.setText('THROW');
        this.weaponText.setText(getGrenade(me.nades[0]).name.toUpperCase());
      } else if (me.weapon === 'knife') {
        this.ammoText.setText('—');
        this.weaponText.setText(me.weapon.toUpperCase());
      } else if (me.reload > 0) {
        this.ammoText.setText('RELOADING');
        this.weaponText.setText(me.weapon.toUpperCase() + (me.kit ? '  +KIT' : ''));
      } else {
        this.ammoText.setText(`${me.ammo} / ${me.reserve}`);
        this.weaponText.setText(me.weapon.toUpperCase() + (me.kit ? '  +KIT' : ''));
      }
      this.nadeText.setText(me.nades?.length ? `[4] ${me.nades.map((n) => getGrenade(n).name).join(', ')}` : '');
      this.bombHint.setText(me.bomb ? 'YOU HAVE THE C4 — hold E on a bomb site to plant' : '');

      // flash blindness: full white fading proportional to remaining duration
      const blindFrac = Math.min(1, (me.blind ?? 0) / (FLASH_MAX_BLIND * TICK_RATE));
      this.blindOverlay.setFillStyle(0xffffff, blindFrac);
    }

    // timer + scores
    if (match) {
      const secs = Math.ceil(match.end / 60);
      const mm = Math.floor(secs / 60);
      const ss = (secs % 60).toString().padStart(2, '0');
      this.teamHintText.setVisible(match.ph === 'waiting');
      switch (match.ph) {
        case 'waiting':
          this.timerText.setText('WARMUP').setColor('#aaaaaa');
          break;
        case 'freeze':
          this.timerText.setText(`BUY  ${mm}:${ss}`).setColor('#8fd18f');
          break;
        case 'live':
          this.timerText.setText(`${mm}:${ss}`).setColor('#ffffff');
          break;
        case 'planted': {
          const blink = Math.floor(this.time.now / 400) % 2 === 0;
          this.timerText.setText(`⏱ ${secs}`).setColor(blink ? '#ff5544' : '#ffaa88');
          break;
        }
        case 'round_end':
        case 'match_end':
          this.timerText.setText('');
          break;
      }
      this.scoreText.setText(
        match.ph === 'waiting' ? 'waiting for both teams…' : `T ${match.st}  —  ${match.sct} CT    round ${match.rn}`,
      );

      // close the buy menu when buying is over
      if (this.buyOpen && me && !me.buy) this.toggleBuy();

      // plant/defuse progress
      this.progressBar.clear();
      if (match.prog !== undefined && alive) {
        const w = 220;
        const x = this.scale.width / 2 - w / 2;
        const y = this.scale.height * 0.62;
        this.progressBar.fillStyle(0x000000, 0.6).fillRect(x, y, w, 14);
        this.progressBar.fillStyle(0xffd280, 0.95).fillRect(x + 2, y + 2, (w - 4) * match.prog, 10);
      }
    }
  }

  private onKill(k: { killer: string; victim: string; weapon: string; meKiller: boolean; meVictim: boolean }): void {
    const color = k.meKiller ? '#ffd76b' : k.meVictim ? '#ff6b6b' : '#dddddd';
    const line = k.killer ? `${k.killer}  [${k.weapon}]  ${k.victim}` : `☠  [${k.weapon}]  ${k.victim}`;
    const t = this.add
      .text(this.scale.width - 16, 16, line, { fontFamily: MONO, fontSize: '13px', color })
      .setOrigin(1, 0)
      .setShadow(1, 1, '#000', 2);
    this.killfeed.push({ text: t, until: this.time.now + 6000 });
  }

  private onHurt(_damage: number): void {
    this.hurtOverlay.setFillStyle(0xaa0000, 0.28);
    this.tweens.add({ targets: this.hurtOverlay, fillAlpha: 0, duration: 350 });
  }

  update(): void {
    const now = this.time.now;

    if (this.bannerText.visible && this.bannerUntil <= now) this.bannerText.setVisible(false);

    this.killfeed = this.killfeed.filter((e) => {
      if (e.until <= now) {
        e.text.destroy();
        return false;
      }
      return true;
    });
    this.killfeed.forEach((e, i) => e.text.setPosition(this.scale.width - 16, 16 + i * 18));

    const p = this.input.activePointer;
    this.crosshair.clear();
    if (!this.buyOpen) {
      this.crosshair.lineStyle(1.5, 0x7dff7d, 0.95);
      const g = 4;
      const l = 7;
      this.crosshair.lineBetween(p.x - g - l, p.y, p.x - g, p.y);
      this.crosshair.lineBetween(p.x + g, p.y, p.x + g + l, p.y);
      this.crosshair.lineBetween(p.x, p.y - g - l, p.x, p.y - g);
      this.crosshair.lineBetween(p.x, p.y + g, p.x, p.y + g + l);
    }

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
