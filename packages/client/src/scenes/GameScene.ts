import Phaser from 'phaser';
import {
  BTN,
  getMap,
  PFLAG,
  TICK_MS,
  TILE_SIZE,
  type CompiledMap,
  type RosterEntry,
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

export class GameScene extends Phaser.Scene {
  private map!: CompiledMap;
  private conn = new Connection();
  private predictor!: Predictor;
  private buffer = new SnapshotBuffer();
  private myId = -1;
  private myTeam: TeamId = 'T';
  private spawned = false;
  private roster = new Map<number, RosterEntry>();
  private entities = new Map<number, Entity>();
  private keys!: Record<'W' | 'A' | 'S' | 'D' | 'SHIFT', Phaser.Input.Keyboard.Key>;
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

    this.cameras.main.setBounds(0, 0, this.map.widthPx, this.map.heightPx);
    this.cameras.main.setZoom(1.25);
    this.cameras.main.centerOn(this.map.widthPx / 2, this.map.heightPx / 2);

    this.keys = this.input.keyboard!.addKeys('W,A,S,D,SHIFT') as GameScene['keys'];

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

    this.conn.onWelcome = (msg) => {
      this.myId = msg.id;
      this.statusText.setVisible(false);
    };
    this.conn.onRoster = (msg) => this.applyRoster(msg.players);
    this.conn.onSnapshot = (msg) => {
      this.buffer.push(msg);
      const self = msg.p.find(([id]) => id === this.myId);
      if (self) {
        const alive = (self[5] & PFLAG.ALIVE) !== 0;
        if (!this.spawned) {
          this.predictor.pos = { x: self[1], y: self[2] };
          this.spawned = true;
        } else {
          this.predictor.reconcile({ x: self[1], y: self[2] }, msg.a, alive);
        }
      }
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

  private applyRoster(entries: RosterEntry[]): void {
    this.roster = new Map(entries.map((e) => [e.id, e]));
    if (this.roster.has(this.myId)) this.myTeam = this.roster.get(this.myId)!.team;
    // remove entities for departed players
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
    e = { sprite, label, team: info.team };
    this.entities.set(id, e);
    return e;
  }

  update(_time: number, deltaMs: number): void {
    if (this.myId === -1 || !this.spawned) return;

    // fixed-step input → predict locally → send to server
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
      const input = this.predictor.buildInput(buttons, aim);
      this.predictor.applyLocal(input, true);
      this.conn.send(input);
    }

    // own entity: predicted position, instant aim
    const me = this.ensureEntity(this.myId);
    if (me) {
      me.sprite.setPosition(this.predictor.pos.x, this.predictor.pos.y);
      const pointer = this.input.activePointer;
      const world = this.cameras.main.getWorldPoint(pointer.x, pointer.y);
      me.sprite.setRotation(Math.atan2(world.y - this.predictor.pos.y, world.x - this.predictor.pos.x));
      me.label.setPosition(this.predictor.pos.x, this.predictor.pos.y);
      if (!this.cameras.main.deadzone) this.cameras.main.startFollow(me.sprite, true, 0.15, 0.15);
    }

    // remote entities: interpolated
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
  }
}
