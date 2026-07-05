import Phaser from 'phaser';
import {
  BTN,
  getMap,
  getWeapon,
  PFLAG,
  TICK_MS,
  visibilityPolygon,
  type CompiledMap,
  type GameEvent,
  type RosterEntry,
  type SelfState,
  type TeamId,
} from '@cs2d/shared';
import { playerTexture } from './BootScene.js';
import { Connection, serverUrl } from '../net/connection.js';
import { Predictor } from '../net/prediction.js';
import { SnapshotBuffer } from '../net/interpolation.js';
import { renderMap } from '../render/mapRender.js';

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
  private keys!: Record<'W' | 'A' | 'S' | 'D' | 'SHIFT' | 'R' | 'ONE' | 'TWO' | 'THREE', Phaser.Input.Keyboard.Key>;
  private pendingSlot: number | undefined;
  private accumulator = 0;
  private statusText!: Phaser.GameObjects.Text;

  constructor() {
    super('Game');
  }

  create(): void {
    (window as unknown as { __scene: GameScene }).__scene = this; // debug/testing handle
    this.map = getMap('dust2');
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

    this.keys = this.input.keyboard!.addKeys('W,A,S,D,SHIFT,R,ONE,TWO,THREE') as GameScene['keys'];
    this.input.keyboard!.on('keydown-ONE', () => (this.pendingSlot = 1));
    this.input.keyboard!.on('keydown-TWO', () => (this.pendingSlot = 2));
    this.input.keyboard!.on('keydown-THREE', () => (this.pendingSlot = 3));

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
      this.myId = msg.id;
      this.statusText.setVisible(false);
    };
    this.conn.onRoster = (msg) => this.applyRoster(msg.players);
    this.conn.onSnapshot = (msg) => {
      this.buffer.push(msg);
      this.lastServerTick = msg.k;
      if (msg.me) this.me = msg.me;
      const self = msg.p.find(([id]) => id === this.myId);
      if (self) {
        this.myHp = self[4];
        this.alive = (self[5] & PFLAG.ALIVE) !== 0;
        if (!this.spawned) {
          this.predictor.pos = { x: self[1], y: self[2] };
          this.spawned = true;
        } else {
          this.predictor.reconcile({ x: self[1], y: self[2] }, msg.a, this.alive);
        }
        this.game.events.emit('hud:self', { hp: this.myHp, alive: this.alive, me: this.me });
      }
      for (const ev of msg.ev ?? []) this.handleEvent(ev);
    };
    this.conn.onClose = () => {
      this.statusText.setText('disconnected — is the server running?  (npm run dev:server)').setVisible(true);
    };

    const name = new URLSearchParams(location.search).get('name') ?? `Player${Math.floor(Math.random() * 1000)}`;
    this.conn
      .connect(serverUrl())
      .then(() => this.conn.send({ t: 'join', name }))
      .catch(() => {
        this.statusText.setText('cannot reach server — start it with: npm run dev:server').setVisible(true);
      });
  }

  private nameOf(id: number): string {
    return this.roster.get(id)?.name ?? `#${id}`;
  }

  private handleEvent(ev: GameEvent): void {
    switch (ev.e) {
      case 'shot': {
        this.tracers.push({ x: ev.x, y: ev.y, tx: ev.tx, ty: ev.ty, until: this.time.now + 70 });
        break;
      }
      case 'kill':
        this.game.events.emit('hud:kill', {
          killer: this.nameOf(ev.k),
          victim: this.nameOf(ev.v),
          weapon: getWeapon(ev.w).name,
          meKiller: ev.k === this.myId,
          meVictim: ev.v === this.myId,
        });
        break;
      case 'hit':
        this.game.events.emit('hud:hitmarker');
        break;
      case 'hurt':
        this.game.events.emit('hud:hurt', ev.d);
        break;
    }
  }

  private applyRoster(entries: RosterEntry[]): void {
    this.roster = new Map(entries.map((e) => [e.id, e]));
    if (this.roster.has(this.myId)) this.myTeam = this.roster.get(this.myId)!.team;
    for (const [id, e] of this.entities) {
      if (!this.roster.has(id)) {
        e.sprite.destroy();
        e.label.destroy();
        this.entities.delete(id);
      }
    }
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
      if (this.keys.W.isDown) buttons |= BTN.UP;
      if (this.keys.S.isDown) buttons |= BTN.DOWN;
      if (this.keys.A.isDown) buttons |= BTN.LEFT;
      if (this.keys.D.isDown) buttons |= BTN.RIGHT;
      if (this.keys.SHIFT.isDown) buttons |= BTN.WALK;
      if (this.keys.R.isDown) buttons |= BTN.RELOAD;
      if (this.input.activePointer.isDown) buttons |= BTN.ATTACK;
      const mobility = this.me ? getWeapon(this.me.weapon).mobility : 1;
      const input = this.predictor.buildInput(buttons, aim, this.lastServerTick, this.pendingSlot);
      this.pendingSlot = undefined;
      this.predictor.applyLocal(input, this.alive, mobility);
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
      if (!this.cameras.main.deadzone) this.cameras.main.startFollow(me.sprite, true, 0.15, 0.15);
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

    // vision polygon from predicted position
    const poly = visibilityPolygon(this.predictor.pos, this.map);
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
