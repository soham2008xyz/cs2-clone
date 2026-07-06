import Phaser from 'phaser';
import {
  BTN,
  getMap,
  getWeapon,
  GRENADES,
  PFLAG,
  TICK_MS,
  TICK_RATE,
  visibilityPolygon,
  WEAPONS,
  type GrenadeKind,
  type CompiledMap,
  type GameEvent,
  type GroundItem,
  type MatchSnap,
  type NadeSnap,
  type RosterEntry,
  type SelfState,
  type TeamId,
  type ZoneSnap,
} from '@cs2d/shared';
import { playerTexture } from './BootScene.js';
import { sfx } from '../audio/sfx.js';
import { toggleMute, unlockAudio } from '../audio/synth.js';
import { appendChatLine, initChat } from '../chat.js';
import { Connection, serverUrl } from '../net/connection.js';
import { Predictor } from '../net/prediction.js';
import { SnapshotBuffer } from '../net/interpolation.js';
import { renderMap } from '../render/mapRender.js';
import { session } from '../session.js';

interface Entity {
  sprite: Phaser.GameObjects.Sprite;
  label: Phaser.GameObjects.Text;
  team: TeamId;
}

interface Tracer {
  x: number;
  y: number;
  tx: number;
  ty: number;
  until: number;
}

/** Killfeed label for any kill-event weapon id: guns, grenades, or the C4. */
function weaponDisplayName(id: string): string {
  if (id === 'c4') return 'C4';
  return WEAPONS[id]?.name ?? GRENADES[id as GrenadeKind]?.name ?? id;
}

export class GameScene extends Phaser.Scene {
  map!: CompiledMap;
  private conn = new Connection();
  private predictor!: Predictor;
  private buffer = new SnapshotBuffer();
  myId = -1;
  myTeam: TeamId = 'T';
  private myHp = 100;
  private me: SelfState | null = null;
  private spawned = false;
  private alive = true;
  private lastServerTick = 0;
  roster = new Map<number, RosterEntry>();
  entities = new Map<number, Entity>();
  private enemyLayer!: Phaser.GameObjects.Container;
  private friendLayer!: Phaser.GameObjects.Container;
  private visionGfx!: Phaser.GameObjects.Graphics;
  private darkness!: Phaser.GameObjects.Graphics;
  private tracerGfx!: Phaser.GameObjects.Graphics;
  private tracers: Tracer[] = [];
  private keys!: Record<'W' | 'A' | 'S' | 'D' | 'SHIFT' | 'R' | 'E' | 'G' | 'ONE' | 'TWO' | 'THREE' | 'FOUR', Phaser.Input.Keyboard.Key>;
  private pendingSlot: number | undefined;
  private accumulator = 0;
  private statusText!: Phaser.GameObjects.Text;
  private match: MatchSnap | null = null;
  private bombSprite!: Phaser.GameObjects.Sprite;
  private itemSprites = new Map<number, Phaser.GameObjects.Sprite>();
  private groundItems: GroundItem[] = [];
  private nadeSprites = new Map<number, Phaser.GameObjects.Arc>();
  private nades: NadeSnap[] = [];
  private zones: ZoneSnap[] = [];
  private zoneGfx!: Phaser.GameObjects.Graphics;
  private smokeClouds = new Map<number, Phaser.GameObjects.Image[]>();
  private fireFx = new Map<number, { emitter: Phaser.GameObjects.Particles.ParticleEmitter; glow: Phaser.GameObjects.Image }>();
  private spectateIndex = 0;
  private spectateTarget = -1;
  private chatOpen = false;
  private pingTimer?: Phaser.Time.TimerEvent;
  private listener = { x: 0, y: 0 }; // positional-audio ear (camera subject)
  private nextBeepAt = 0;
  private wasReloading = false;

  constructor() {
    super('Game');
  }

  create(): void {
    (window as unknown as { __scene: GameScene }).__scene = this; // debug/testing handle
    this.map = getMap(session.map);
    this.predictor = new Predictor(this.map);
    renderMap(this, this.map);

    this.friendLayer = this.add.container(0, 0).setDepth(10);
    this.enemyLayer = this.add.container(0, 0).setDepth(10);
    this.tracerGfx = this.add.graphics().setDepth(15);

    // fog of war: enemies clipped to the visibility polygon; the world outside
    // it is dimmed with the inverse of the same mask
    this.visionGfx = this.make.graphics({ x: 0, y: 0 }, false);
    const mask = this.visionGfx.createGeometryMask();
    this.enemyLayer.setMask(mask);
    this.darkness = this.add.graphics().setDepth(20);
    this.darkness.fillStyle(0x000000, 0.55);
    this.darkness.fillRect(0, 0, this.map.widthPx, this.map.heightPx);
    const darkMask = this.visionGfx.createGeometryMask();
    darkMask.setInvertAlpha(true);
    this.darkness.setMask(darkMask);

    this.cameras.main.setBounds(0, 0, this.map.widthPx, this.map.heightPx);
    this.cameras.main.setZoom(1.25);
    this.cameras.main.centerOn(this.map.widthPx / 2, this.map.heightPx / 2);

    this.keys = this.input.keyboard!.addKeys('W,A,S,D,SHIFT,R,E,G,ONE,TWO,THREE,FOUR') as GameScene['keys'];
    // discrete hotkeys must not fire while the chat input has focus
    const hotkey = (key: string, fn: () => void): void => {
      this.input.keyboard!.on(`keydown-${key}`, () => {
        if (!this.chatOpen) fn();
      });
    };
    hotkey('ONE', () => (this.pendingSlot = 1));
    hotkey('TWO', () => (this.pendingSlot = 2));
    hotkey('THREE', () => (this.pendingSlot = 3));
    hotkey('FOUR', () => (this.pendingSlot = 4));
    hotkey('SPACE', () => this.spectateIndex++);
    hotkey('M', () => toggleMute());
    this.input.once('pointerdown', () => unlockAudio()); // browsers gate audio behind a gesture
    hotkey('OPEN_BRACKET', () => this.conn.send({ t: 'team', team: 'T' }));
    hotkey('CLOSED_BRACKET', () => this.conn.send({ t: 'team', team: 'CT' }));
    this.game.events.on('buy', this.onBuy, this);
    this.game.events.on('chat:send', this.onChatSend, this);
    this.game.events.on('chat:toggle', this.onChatToggle, this);
    this.events.once('shutdown', () => {
      this.game.events.off('buy', this.onBuy, this);
      this.game.events.off('chat:send', this.onChatSend, this);
      this.game.events.off('chat:toggle', this.onChatToggle, this);
      this.pingTimer?.destroy();
    });

    initChat(
      (text) => this.game.events.emit('chat:send', text),
      (open) => this.game.events.emit('chat:toggle', open),
    );

    this.bombSprite = this.add.sprite(-100, -100, 'bomb').setDepth(8).setVisible(false);
    this.zoneGfx = this.add.graphics().setDepth(6);

    this.statusText = this.add
      .text(this.map.widthPx / 2, this.map.heightPx / 2, 'connecting…', {
        fontFamily: 'monospace',
        fontSize: '20px',
        color: '#ffffff',
        backgroundColor: '#00000088',
        padding: { x: 12, y: 8 },
      })
      .setOrigin(0.5)
      .setDepth(200);

    this.scene.launch('Hud');

    this.conn.onWelcome = (msg) => {
      if (msg.map !== session.map) {
        // joined a room running a different map than the menu assumed:
        // fix the session and rebuild the whole game against the right map
        session.map = msg.map;
        this.conn.disconnect();
        this.game.events.emit('session:restart');
        return;
      }
      this.myId = msg.id;
      this.statusText.setVisible(false);
    };
    this.conn.onRoster = (msg) => this.applyRoster(msg.players);
    this.conn.onSnapshot = (msg) => {
      this.buffer.push(msg);
      this.lastServerTick = msg.k;
      if (msg.me) this.me = msg.me;
      this.match = msg.m ?? null;
      this.groundItems = msg.g ?? [];
      this.nades = msg.n ?? [];
      this.zones = msg.z ?? [];
      const reloading = (msg.me?.reload ?? 0) > 0;
      if (reloading && !this.wasReloading) sfx('reload');
      this.wasReloading = reloading;
      const self = msg.p.find(([id]) => id === this.myId);
      if (self) {
        this.myHp = self[4];
        this.alive = (self[5] & PFLAG.ALIVE) !== 0;
        const canMove = this.alive && this.match?.ph !== 'freeze';
        if (!this.spawned || (self[1] !== 0 && Math.hypot(self[1] - this.predictor.pos.x, self[2] - this.predictor.pos.y) > 200)) {
          // first snapshot or teleport (round start respawn): snap hard
          this.predictor.pos = { x: self[1], y: self[2] };
          this.predictor.reconcile({ x: self[1], y: self[2] }, msg.a, false);
          this.spawned = true;
        } else {
          this.predictor.reconcile({ x: self[1], y: self[2] }, msg.a, canMove);
        }
        this.game.events.emit('hud:self', {
          hp: this.myHp,
          alive: this.alive,
          me: this.me,
          team: this.myTeam,
          match: this.match,
        });
      }
      for (const ev of msg.ev ?? []) this.handleEvent(ev);
    };
    this.conn.onClose = () => {
      this.statusText.setText('disconnected from server').setVisible(true);
    };
    this.conn.onChat = (msg) => {
      const color = msg.team === 'T' ? '#ffd280' : msg.team === 'CT' ? '#9cc4ff' : '#aaaaaa';
      appendChatLine(msg.from, msg.text, color);
    };
    this.conn.onPong = (msg) => {
      this.game.events.emit('hud:ping', Math.round(performance.now() - msg.t0));
    };

    this.conn
      .connect(serverUrl(session.roomCode))
      .then(() => {
        this.conn.send({ t: 'join', name: session.name, team: session.team });
        if (session.botsRequested) this.conn.send({ t: 'bots', ...session.botsRequested });
        this.pingTimer = this.time.addEvent({
          delay: 2000,
          loop: true,
          callback: () => this.conn.send({ t: 'ping', t0: performance.now() }),
        });
      })
      .catch(() => {
        this.statusText.setText('cannot reach server — start it with: npm run dev:server').setVisible(true);
      });
  }

  private onChatSend(text: string): void {
    this.conn.send({ t: 'chat', text });
  }

  private onChatToggle(open: boolean): void {
    this.chatOpen = open;
  }

  private nameOf(id: number): string {
    return this.roster.get(id)?.name ?? `#${id}`;
  }

  private handleEvent(ev: GameEvent): void {
    switch (ev.e) {
      case 'shot': {
        this.tracers.push({ x: ev.x, y: ev.y, tx: ev.tx, ty: ev.ty, until: this.time.now + 70 });
        const cls = getWeapon(ev.w).cls;
        sfx(`shot_${cls}`, { x: ev.x, y: ev.y }, this.listener);
        if (cls !== 'knife' && this.textures.exists('muzzle')) {
          const ang = Math.atan2(ev.ty - ev.y, ev.tx - ev.x);
          const m = this.add
            .image(ev.x + Math.cos(ang) * 20, ev.y + Math.sin(ang) * 20, 'muzzle')
            .setDepth(16)
            .setRotation(ang)
            .setDisplaySize(30, 30)
            .setBlendMode(Phaser.BlendModes.ADD)
            .setAlpha(0.9);
          this.tweens.add({ targets: m, alpha: 0, duration: 60, onComplete: () => m.destroy() });
        }
        break;
      }
      case 'kill':
        if (ev.k === this.myId) sfx('kill');
        this.game.events.emit('hud:kill', {
          killer: ev.k === 0 ? '' : this.nameOf(ev.k), // 0 = world (C4, unowned fire)
          victim: this.nameOf(ev.v),
          weapon: weaponDisplayName(ev.w),
          meKiller: ev.k !== 0 && ev.k === this.myId,
          meVictim: ev.v === this.myId,
        });
        break;
      case 'hit':
        this.game.events.emit('hud:hitmarker');
        sfx('hit');
        break;
      case 'hurt':
        this.game.events.emit('hud:hurt', ev.d);
        sfx('hurt');
        break;
      case 'exploded': {
        // screen shake + flash at the bomb site
        this.cameras.main.shake(400, 0.01);
        const boom = this.add.circle(ev.x, ev.y, 40, 0xffcc66, 0.9).setDepth(30);
        this.tweens.add({ targets: boom, radius: 320, alpha: 0, duration: 550, onComplete: () => boom.destroy() });
        this.explosionGlow(ev.x, ev.y, 680);
        this.game.events.emit('hud:banner', { text: 'THE BOMB HAS EXPLODED', color: '#ffb066', ttl: 3500 });
        sfx('c4_explosion'); // heard map-wide
        break;
      }
      case 'planted':
        this.game.events.emit('hud:banner', { text: 'THE BOMB HAS BEEN PLANTED', color: '#ff8866', ttl: 3500 });
        sfx('plant', { x: ev.x, y: ev.y }, this.listener);
        this.nextBeepAt = 0;
        break;
      case 'defused':
        this.game.events.emit('hud:banner', { text: 'BOMB DEFUSED', color: '#7db8ff', ttl: 3500 });
        sfx('defused');
        break;
      case 'round_start':
        this.game.events.emit('hud:banner', { text: `ROUND ${ev.rn}`, color: '#ffffff', ttl: 2000 });
        sfx('round_start');
        break;
      case 'round_end': {
        const label = ev.winner === 'T' ? 'TERRORISTS WIN' : 'COUNTER-TERRORISTS WIN';
        const color = ev.winner === 'T' ? '#ffd280' : '#9cc4ff';
        this.game.events.emit('hud:banner', { text: label, color, ttl: 5000 });
        sfx(ev.winner === this.myTeam ? 'round_win' : 'round_lose');
        break;
      }
      case 'swap':
        this.game.events.emit('hud:banner', { text: 'SWITCHING SIDES', color: '#ffffff', ttl: 4000 });
        break;
      case 'match_end': {
        const label = ev.winner === 'T' ? 'TERRORISTS WIN THE MATCH' : 'COUNTER-TERRORISTS WIN THE MATCH';
        this.game.events.emit('hud:banner', { text: label, color: '#ffe680', ttl: 8000 });
        this.game.events.emit('hud:matchend', { winner: ev.winner, roster: [...this.roster.values()] });
        this.time.delayedCall(8000, () => {
          this.conn.disconnect();
          this.game.events.emit('session:end');
        });
        break;
      }
      case 'he_pop': {
        const boom = this.add.circle(ev.x, ev.y, 20, 0xffcc66, 0.85).setDepth(30);
        this.tweens.add({ targets: boom, radius: 130, alpha: 0, duration: 350, onComplete: () => boom.destroy() });
        if (Math.hypot(ev.x - this.predictor.pos.x, ev.y - this.predictor.pos.y) < 250) this.cameras.main.shake(180, 0.006);
        this.explosionGlow(ev.x, ev.y, 260);
        sfx('he_boom', { x: ev.x, y: ev.y }, this.listener);
        break;
      }
      case 'flash_pop': {
        const pop = this.add.circle(ev.x, ev.y, 10, 0xffffff, 0.95).setDepth(30);
        this.tweens.add({ targets: pop, radius: 40, alpha: 0, duration: 250, onComplete: () => pop.destroy() });
        sfx('flash_pop', { x: ev.x, y: ev.y }, this.listener);
        break;
      }
      case 'smoke_pop':
        sfx('smoke_pop', { x: ev.x, y: ev.y }, this.listener);
        break; // cloud itself renders from the zone snapshot
      case 'molotov_ignite':
        sfx('molly_ignite', { x: ev.x, y: ev.y }, this.listener);
        break; // fire renders from the zone snapshot
    }
  }

  private onBuy(item: string): void {
    this.conn.send({ t: 'buy', item });
    sfx('buy');
  }

  /** Additive glow burst for HE / C4 detonations. */
  private explosionGlow(x: number, y: number, size: number): void {
    if (!this.textures.exists('glow')) return;
    const g = this.add
      .image(x, y, 'glow')
      .setDepth(29)
      .setBlendMode(Phaser.BlendModes.ADD)
      .setDisplaySize(size * 0.4, size * 0.4)
      .setAlpha(0.95);
    this.tweens.add({
      targets: g,
      displayWidth: size,
      displayHeight: size,
      alpha: 0,
      duration: 420,
      onComplete: () => g.destroy(),
    });
  }

  /** Cluster of drifting textured puffs; sized by the (blooming) radius, fading near expiry. */
  private updateSmokeCloud(zid: number, x: number, y: number, radius: number, ticksLeft: number): void {
    const PUFFS = 7;
    let puffs = this.smokeClouds.get(zid);
    if (!puffs) {
      puffs = Array.from({ length: PUFFS }, () => this.add.image(x, y, 'smokepuff').setDepth(6).setAlpha(0).setTint(0xd8d8d8));
      this.smokeClouds.set(zid, puffs);
    }
    const fade = Math.min(1, ticksLeft / 90); // dissipate over the last 1.5s
    puffs.forEach((img, i) => {
      const ang = (i / PUFFS) * Math.PI * 2 + zid * 1.7;
      const rr = i === 0 ? 0 : radius * 0.45;
      img.setPosition(x + Math.cos(ang) * rr, y + Math.sin(ang) * rr);
      img.setDisplaySize(radius * 1.5, radius * 1.5);
      img.setRotation(ang + this.time.now / 4000);
      img.setAlpha(0.75 * fade);
    });
  }

  /** Flame particle emitter over an additive ground glow. */
  private updateFireFx(zid: number, x: number, y: number, radius: number): void {
    let fx = this.fireFx.get(zid);
    if (!fx) {
      const glow = this.add.image(x, y, 'glow').setDepth(6).setBlendMode(Phaser.BlendModes.ADD).setTint(0xff7722);
      const emitter = this.add
        .particles(x, y, 'flame', {
          speed: { min: 5, max: 25 },
          lifespan: { min: 300, max: 600 },
          alpha: { start: 0.75, end: 0 },
          scale: { start: 0.05, end: 0.11 },
          blendMode: 'ADD',
          frequency: 30,
          emitZone: { type: 'random', source: new Phaser.Geom.Circle(0, 0, radius * 0.85), quantity: 1 },
        })
        .setDepth(7);
      fx = { emitter, glow };
      this.fireFx.set(zid, fx);
    }
    const flicker = 0.75 + 0.15 * Math.sin(this.time.now / 90 + x);
    fx.glow.setDisplaySize(radius * 2.6, radius * 2.6).setAlpha(0.5 * flicker);
  }

  private applyRoster(entries: RosterEntry[]): void {
    this.roster = new Map(entries.map((e) => [e.id, e]));
    if (this.roster.has(this.myId)) this.myTeam = this.roster.get(this.myId)!.team;
    for (const [id, e] of this.entities) {
      const entry = this.roster.get(id);
      // gone, or side-swapped: rebuild the entity with the right texture/layer
      if (!entry || entry.team !== e.team) {
        e.sprite.destroy();
        e.label.destroy();
        this.entities.delete(id);
      }
    }
    this.game.events.emit('hud:roster', entries);
  }

  private ensureEntity(id: number): Entity | null {
    let e = this.entities.get(id);
    if (e) return e;
    const info = this.roster.get(id);
    if (!info) return null;
    const sprite = this.add.sprite(-100, -100, playerTexture(this, info.team));
    const label = this.add
      .text(-100, -100, info.name, { fontFamily: 'monospace', fontSize: '11px', color: '#ffffffcc' })
      .setOrigin(0.5, 1.6)
      .setShadow(1, 1, '#000', 2);
    const friendly = id === this.myId || info.team === this.myTeam;
    const layer = friendly ? this.friendLayer : this.enemyLayer;
    layer.add(sprite);
    layer.add(label);
    e = { sprite, label, team: info.team };
    this.entities.set(id, e);
    return e;
  }

  update(_time: number, deltaMs: number): void {
    if (this.myId === -1 || !this.spawned) return;

    this.accumulator += Math.min(deltaMs, 250);
    while (this.accumulator >= TICK_MS) {
      this.accumulator -= TICK_MS;
      const pointer = this.input.activePointer;
      const world = this.cameras.main.getWorldPoint(pointer.x, pointer.y);
      const aim = Math.atan2(world.y - this.predictor.pos.y, world.x - this.predictor.pos.x);
      let buttons = 0;
      if (!this.chatOpen) {
        if (this.keys.W.isDown) buttons |= BTN.UP;
        if (this.keys.S.isDown) buttons |= BTN.DOWN;
        if (this.keys.A.isDown) buttons |= BTN.LEFT;
        if (this.keys.D.isDown) buttons |= BTN.RIGHT;
        if (this.keys.SHIFT.isDown) buttons |= BTN.WALK;
        if (this.keys.R.isDown) buttons |= BTN.RELOAD;
        if (this.keys.E.isDown) buttons |= BTN.USE;
        if (this.keys.G.isDown) buttons |= BTN.DROP;
        if (this.input.activePointer.isDown) buttons |= BTN.ATTACK;
      }
      const mobility = this.me ? getWeapon(this.me.weapon).mobility : 1;
      const canMove = this.alive && this.match?.ph !== 'freeze';
      const input = this.predictor.buildInput(buttons, aim, this.lastServerTick, this.pendingSlot);
      this.pendingSlot = undefined;
      this.predictor.applyLocal(input, canMove, mobility);
      this.conn.send(input);
    }

    // own entity
    const me = this.ensureEntity(this.myId);
    if (me) {
      me.sprite.setVisible(this.alive);
      me.label.setVisible(this.alive);
      me.sprite.setPosition(this.predictor.pos.x, this.predictor.pos.y);
      const pointer = this.input.activePointer;
      const world = this.cameras.main.getWorldPoint(pointer.x, pointer.y);
      me.sprite.setRotation(Math.atan2(world.y - this.predictor.pos.y, world.x - this.predictor.pos.x));
      me.label.setPosition(this.predictor.pos.x, this.predictor.pos.y);
    }

    // remote entities
    const sampled = this.buffer.sample();
    for (const [id, state] of sampled) {
      if (id === this.myId) continue;
      const e = this.ensureEntity(id);
      if (!e) continue;
      const alive = (state.flags & PFLAG.ALIVE) !== 0;
      e.sprite.setVisible(alive);
      e.label.setVisible(alive);
      e.sprite.setPosition(state.x, state.y);
      e.sprite.setRotation(state.aim);
      e.label.setPosition(state.x, state.y);
    }

    // camera: follow self while alive, otherwise spectate a living teammate
    let visionOrigin = this.predictor.pos;
    if (this.alive || this.match?.ph === 'waiting') {
      if (me && this.spectateTarget !== this.myId) {
        this.cameras.main.startFollow(me.sprite, true, 0.15, 0.15);
        this.spectateTarget = this.myId;
        this.game.events.emit('hud:spectate', null);
      }
    } else {
      const mates = [...sampled.entries()].filter(
        ([id, s]) => id !== this.myId && this.roster.get(id)?.team === this.myTeam && (s.flags & PFLAG.ALIVE) !== 0,
      );
      if (mates.length > 0) {
        const [targetId] = mates[this.spectateIndex % mates.length];
        const target = this.entities.get(targetId);
        if (target && this.spectateTarget !== targetId) {
          this.cameras.main.startFollow(target.sprite, true, 0.12, 0.12);
          this.spectateTarget = targetId;
          this.game.events.emit('hud:spectate', this.nameOf(targetId));
        }
        const st = sampled.get(targetId)!;
        visionOrigin = { x: st.x, y: st.y };
      }
    }

    this.listener = { x: visionOrigin.x, y: visionOrigin.y };

    // bomb rendering (dropped or planted)
    if (this.match?.bomb) {
      const [bx, by, planted] = this.match.bomb;
      this.bombSprite.setVisible(true).setPosition(bx, by);
      if (planted === 1) {
        const blink = Math.floor(this.time.now / 350) % 2 === 0;
        this.bombSprite.setTint(blink ? 0xff4444 : 0xffffff);
        // beep accelerates as the timer runs down: ~1s apart -> ~0.15s
        const secsLeft = (this.match.end ?? 0) / TICK_RATE;
        const interval = 150 + 850 * Math.min(1, Math.max(0, secsLeft / 40));
        if (this.time.now >= this.nextBeepAt) {
          sfx('bomb_beep', { x: bx, y: by }, this.listener);
          this.nextBeepAt = this.time.now + interval;
        }
      } else {
        this.bombSprite.clearTint();
      }
    } else {
      this.bombSprite.setVisible(false);
    }

    // ground weapons
    const seen = new Set<number>();
    for (const [itemId, weaponId, x, y] of this.groundItems) {
      seen.add(itemId);
      let s = this.itemSprites.get(itemId);
      if (!s) {
        s = this.add.sprite(x, y, 'grounditem').setDepth(7);
        this.itemSprites.set(itemId, s);
      }
      s.setPosition(x, y);
      void weaponId;
    }
    for (const [itemId, s] of this.itemSprites) {
      if (!seen.has(itemId)) {
        s.destroy();
        this.itemSprites.delete(itemId);
      }
    }

    // in-flight grenades
    const seenNades = new Set<number>();
    for (const [nadeId, kind, x, y] of this.nades) {
      seenNades.add(nadeId);
      let s = this.nadeSprites.get(nadeId);
      if (!s) {
        const color = kind === 'flash' ? 0xdddddd : kind === 'smoke' ? 0x999999 : kind === 'he' ? 0x556b2f : 0x8b3a1a;
        s = this.add.circle(x, y, 5, color).setDepth(9).setStrokeStyle(1, 0x000000, 0.6);
        this.nadeSprites.set(nadeId, s);
      }
      s.setPosition(x, y);
    }
    for (const [nadeId, s] of this.nadeSprites) {
      if (!seenNades.has(nadeId)) {
        s.destroy();
        this.nadeSprites.delete(nadeId);
      }
    }

    // smoke / fire zones (Kenney particle textures; vector fallback when missing)
    const smokeOccluders = this.zones.filter((z) => z[1] === 'smoke').map((z) => ({ pos: { x: z[2], y: z[3] }, radius: z[4] }));
    const smokeTex = this.textures.exists('smokepuff');
    const flameTex = this.textures.exists('flame') && this.textures.exists('glow');
    const seenZones = new Set<number>();
    this.zoneGfx.clear();
    for (const [zid, kind, x, y, radius, ticksLeft] of this.zones) {
      seenZones.add(zid);
      if (kind === 'smoke') {
        if (smokeTex) {
          this.updateSmokeCloud(zid, x, y, radius, ticksLeft);
        } else {
          this.zoneGfx.fillStyle(0xcfcfcf, 0.92);
          this.zoneGfx.fillCircle(x, y, radius);
          this.zoneGfx.lineStyle(2, 0xb0b0b0, 0.5);
          this.zoneGfx.strokeCircle(x, y, radius);
        }
      } else {
        if (flameTex) {
          this.updateFireFx(zid, x, y, radius);
        } else {
          const flicker = 0.75 + 0.15 * Math.sin(this.time.now / 90 + x);
          this.zoneGfx.fillStyle(0xff6a1a, 0.55 * flicker);
          this.zoneGfx.fillCircle(x, y, radius);
          this.zoneGfx.fillStyle(0xffcc55, 0.45 * flicker);
          this.zoneGfx.fillCircle(x, y, radius * 0.55);
        }
      }
    }
    for (const [zid, puffs] of this.smokeClouds) {
      if (!seenZones.has(zid)) {
        puffs.forEach((img) => img.destroy());
        this.smokeClouds.delete(zid);
      }
    }
    for (const [zid, fx] of this.fireFx) {
      if (!seenZones.has(zid)) {
        fx.emitter.destroy();
        fx.glow.destroy();
        this.fireFx.delete(zid);
      }
    }

    // vision polygon from the camera's subject (smoke blocks LOS same as walls)
    const poly = visibilityPolygon(visionOrigin, this.map, smokeOccluders);
    this.visionGfx.clear();
    this.visionGfx.fillStyle(0xffffff, 1);
    this.visionGfx.beginPath();
    this.visionGfx.moveTo(poly[0].x, poly[0].y);
    for (let i = 1; i < poly.length; i++) this.visionGfx.lineTo(poly[i].x, poly[i].y);
    this.visionGfx.closePath();
    this.visionGfx.fillPath();

    // tracers
    const now = this.time.now;
    this.tracers = this.tracers.filter((t) => t.until > now);
    this.tracerGfx.clear();
    this.tracerGfx.lineStyle(1.5, 0xfff2ba, 0.9);
    for (const t of this.tracers) {
      this.tracerGfx.lineBetween(t.x, t.y, t.tx, t.ty);
    }
  }
}
