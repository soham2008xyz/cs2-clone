import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import {
  BTN,
  getMap,
  PFLAG,
  TICK_MS,
  type CompiledMap,
  type GameEvent,
  type GroundItem,
  type MatchSnap,
  type NadeSnap,
  type RosterEntry,
  type SelfState,
  type TeamId,
  type Vec2,
  type ZoneSnap,
} from '@cs2d/shared';
import { Predictor } from '../src/net/prediction.js';
import type { RemoteState } from '../src/net/interpolation.js';
import { fakeFactory, fakeObject, FakeEmitter, methodsCalled, type FakeObject } from './phaserFakes.js';

vi.mock('phaser', () => ({
  default: { Scene: class {}, BlendModes: { ADD: 1 }, Geom: { Circle: class {} } },
}));
vi.mock('../src/audio/sfx.js', () => ({ sfx: vi.fn() }));
vi.mock('../src/audio/synth.js', () => ({ toggleMute: vi.fn(), unlockAudio: vi.fn() }));
vi.mock('../src/render/mapRender.js', () => ({ renderMap: vi.fn() }));
vi.mock('../src/chat.js', () => ({ appendChatLine: vi.fn(), initChat: vi.fn() }));
vi.mock('../src/scenes/BootScene.js', () => ({ playerTexture: (_s: unknown, team: TeamId) => `player_${team}` }));

const { GameScene } = await import('../src/scenes/GameScene.js');
const { sfx } = await import('../src/audio/sfx.js');

interface EntityFake {
  sprite: FakeObject;
  label: FakeObject;
  team: TeamId;
}

/** The private surface these tests drive, with Phaser collaborators swapped for fakes. */
interface GameInternals {
  add: FakeObject;
  textures: { exists: (key: string) => boolean };
  time: { now: number; delayedCall: Mock };
  tweens: { add: Mock };
  cameras: { main: FakeObject };
  game: { events: FakeEmitter };
  input: { activePointer: { x: number; y: number; isDown: boolean } };
  keys: Record<string, { isDown: boolean }>;
  conn: { send: Mock; disconnect: Mock };
  buffer: { sample: () => Map<number, RemoteState> };
  map: CompiledMap;
  predictor: Predictor;
  bombSprite: FakeObject;
  zoneGfx: FakeObject;
  visionGfx: FakeObject;
  tracerGfx: FakeObject;
  friendLayer: FakeObject;
  enemyLayer: FakeObject;
  shotFxMask: unknown;
  myId: number;
  myTeam: TeamId;
  spawned: boolean;
  alive: boolean;
  chatOpen: boolean;
  match: MatchSnap | null;
  me: SelfState | null;
  roster: Map<number, RosterEntry>;
  entities: Map<number, EntityFake>;
  groundItems: GroundItem[];
  nades: NadeSnap[];
  zones: ZoneSnap[];
  tracers: Array<{ x: number; y: number; tx: number; ty: number; until: number }>;
  itemSprites: Map<number, FakeObject>;
  nadeSprites: Map<number, FakeObject>;
  smokeClouds: Map<number, FakeObject[]>;
  fireFx: Map<number, { emitter: FakeObject; glow: FakeObject }>;
  spectateTarget: number;
  spectateIndex: number;
  listener: Vec2;
  nextBeepAt: number;
  update(time: number, deltaMs: number): void;
  handleEvent(ev: GameEvent): void;
  applyRoster(entries: RosterEntry[]): void;
}

const KEY_NAMES = ['W', 'A', 'S', 'D', 'SHIFT', 'R', 'E', 'G', 'ONE', 'TWO', 'THREE', 'FOUR'];
const ALIVE = PFLAG.ALIVE;

let g: GameInternals;
let created: FakeObject[];
let sampled: Map<number, RemoteState>;
let textures: Set<string>;

function roster(...entries: Array<[number, string, TeamId]>): RosterEntry[] {
  return entries.map(([id, name, team]) => ({ id, name, team, k: 0, d: 0 }));
}

function remote(x: number, y: number, flags = ALIVE): RemoteState {
  return { x, y, aim: 0, hp: 100, flags };
}

beforeEach(() => {
  vi.mocked(sfx).mockClear();
  g = new GameScene() as unknown as GameInternals;
  const factory = fakeFactory();
  created = factory.created;
  textures = new Set();
  sampled = new Map();
  g.add = factory.add;
  g.textures = { exists: (key) => textures.has(key) };
  g.time = { now: 1000, delayedCall: vi.fn() };
  g.tweens = { add: vi.fn() };
  g.cameras = { main: fakeObject({ getWorldPoint: (x: number, y: number) => ({ x, y }) }) };
  g.game = { events: new FakeEmitter() };
  g.input = { activePointer: { x: 0, y: 0, isDown: false } };
  g.keys = Object.fromEntries(KEY_NAMES.map((k) => [k, { isDown: false }]));
  g.conn = { send: vi.fn(), disconnect: vi.fn() };
  g.buffer = { sample: () => sampled };
  g.map = getMap('dust2');
  g.predictor = new Predictor(g.map);
  g.predictor.pos = { ...g.map.spawns.T[0] };
  for (const name of ['bombSprite', 'zoneGfx', 'visionGfx', 'tracerGfx', 'friendLayer', 'enemyLayer'] as const) {
    g[name] = fakeObject();
  }
  g.shotFxMask = {};
  g.myId = 1;
  g.myTeam = 'T';
  g.spawned = true;
  g.alive = true;
  g.match = { ph: 'live', end: 6000, rn: 1, st: 0, sct: 0 };
  g.roster = new Map(roster([1, 'Me', 'T'], [2, 'Mate', 'T'], [3, 'Enemy', 'CT']).map((e) => [e.id, e]));
});

describe('GameScene.update — input', () => {
  it('does nothing before the welcome / first snapshot', () => {
    g.myId = -1;
    g.update(0, TICK_MS * 3);
    expect(g.conn.send).not.toHaveBeenCalled();
  });

  it('sends one input per elapsed tick with the held buttons', () => {
    g.keys.W.isDown = true;
    g.keys.SHIFT.isDown = true;
    g.input.activePointer.isDown = true;
    g.update(0, TICK_MS * 2);
    expect(g.conn.send).toHaveBeenCalledTimes(2);
    const input = g.conn.send.mock.calls[0][0] as { b: number };
    expect(input.b).toBe(BTN.UP | BTN.WALK | BTN.ATTACK);
  });

  it('sends no buttons while the chat box is open', () => {
    g.chatOpen = true;
    g.keys.D.isDown = true;
    g.update(0, TICK_MS);
    expect((g.conn.send.mock.calls[0][0] as { b: number }).b).toBe(0);
  });

  it('forwards a pending weapon-slot switch exactly once', () => {
    (g as unknown as { pendingSlot?: number }).pendingSlot = 3;
    g.update(0, TICK_MS * 2);
    const [first, second] = g.conn.send.mock.calls.map(([m]) => m as { w?: number });
    expect(first.w).toBe(3);
    expect(second.w).toBeUndefined();
  });
});

describe('GameScene.update — entities and camera', () => {
  it('places self at the predicted position and remote players at their sampled state', () => {
    sampled.set(2, remote(100, 200));
    sampled.set(3, remote(300, 400, 0)); // dead enemy
    g.update(0, 0);
    expect(g.entities.get(1)?.sprite.x).toBe(g.predictor.pos.x);
    expect(g.entities.get(2)?.sprite).toMatchObject({ x: 100, y: 200, visible: true });
    expect(g.entities.get(3)?.sprite.visible).toBe(false);
    expect(g.friendLayer.calls.filter((c) => c.method === 'add')).toHaveLength(4); // self + mate: sprite + label
    expect(g.enemyLayer.calls.filter((c) => c.method === 'add')).toHaveLength(2);
  });

  it('skips sampled players missing from the roster', () => {
    sampled.set(99, remote(1, 1));
    g.update(0, 0);
    expect(g.entities.has(99)).toBe(false);
  });

  it('follows self while alive and announces it once', () => {
    g.update(0, 0);
    g.update(0, 0);
    expect(methodsCalled(g.cameras.main).filter((m) => m === 'startFollow')).toHaveLength(1);
    expect(g.spectateTarget).toBe(1);
    expect(g.game.events.payloads('hud:spectate')).toEqual([[null]]);
    expect(g.listener).toEqual(g.predictor.pos);
  });

  it('spectates a living teammate when dead and uses their position for vision', () => {
    g.alive = false;
    sampled.set(2, remote(100, 200));
    sampled.set(3, remote(300, 400));
    g.update(0, 0);
    expect(g.spectateTarget).toBe(2);
    expect(g.game.events.payloads('hud:spectate')).toEqual([['Mate']]);
    expect(g.listener).toEqual({ x: 100, y: 200 });
  });

  it('keeps own position for vision when dead with no living teammate', () => {
    g.alive = false;
    sampled.set(2, remote(100, 200, 0));
    g.update(0, 0);
    expect(g.spectateTarget).not.toBe(2);
    expect(g.listener).toEqual(g.predictor.pos);
  });

  it('keeps following self during warmup even while dead', () => {
    g.alive = false;
    g.match = { ph: 'waiting', end: 0, rn: 0, st: 0, sct: 0 };
    g.update(0, 0);
    expect(g.spectateTarget).toBe(1);
  });

  it('draws the vision polygon from the camera subject', () => {
    g.update(0, 0);
    expect(methodsCalled(g.visionGfx)).toEqual(expect.arrayContaining(['clear', 'beginPath', 'moveTo', 'lineTo', 'closePath', 'fillPath']));
  });
});

describe('GameScene.update — bomb', () => {
  it('hides the bomb when none is on the ground', () => {
    g.update(0, 0);
    expect(g.bombSprite.visible).toBe(false);
  });

  it('shows a dropped bomb untinted', () => {
    g.match = { ph: 'live', end: 6000, rn: 1, st: 0, sct: 0, bomb: [50, 60, 0] };
    g.update(0, 0);
    expect(g.bombSprite).toMatchObject({ visible: true, x: 50, y: 60, tint: undefined });
    expect(sfx).not.toHaveBeenCalled();
  });

  it('blinks a planted bomb and schedules the next beep from the timer', () => {
    g.match = { ph: 'planted', end: 40 * 60, rn: 1, st: 0, sct: 0, bomb: [50, 60, 1] };
    g.update(0, 0);
    expect(g.bombSprite.tint).toBeTypeOf('number');
    expect(sfx).toHaveBeenCalledWith('bomb_beep', { x: 50, y: 60 }, g.listener);
    expect(g.nextBeepAt).toBe(1000 + 1000); // 40s left -> slowest 1s interval

    vi.mocked(sfx).mockClear();
    g.update(0, 0); // same instant: no second beep yet
    expect(sfx).not.toHaveBeenCalled();
  });
});

describe('GameScene.update — ground items, grenades, zones', () => {
  it('creates, moves and prunes ground weapon sprites', () => {
    g.groundItems = [[7, 'ak47', 10, 20]];
    g.update(0, 0);
    const sprite = g.itemSprites.get(7)!;
    g.groundItems = [[7, 'ak47', 15, 25]];
    g.update(0, 0);
    expect(g.itemSprites.get(7)).toBe(sprite);
    expect(sprite).toMatchObject({ x: 15, y: 25 });

    g.groundItems = [];
    g.update(0, 0);
    expect(g.itemSprites.size).toBe(0);
    expect(sprite.destroyed).toBe(true);
  });

  it('colors in-flight grenades by kind and prunes them after they land', () => {
    g.nades = [
      [1, 'flash', 0, 0],
      [2, 'molotov', 0, 0],
    ];
    g.update(0, 0);
    expect(g.nadeSprites.get(1)?.fillColor).toBe(0xdddddd);
    expect(g.nadeSprites.get(2)?.fillColor).toBe(0x8b3a1a);

    const dot = g.nadeSprites.get(1)!;
    g.nades = [];
    g.update(0, 0);
    expect(g.nadeSprites.size).toBe(0);
    expect(dot.destroyed).toBe(true);
  });

  it('renders textured smoke and fire effects, then tears them down', () => {
    textures = new Set(['smokepuff', 'flame', 'glow']);
    g.zones = [
      [1, 'smoke', 100, 100, 80, 600],
      [2, 'fire', 200, 200, 60, 600],
    ];
    g.update(0, 0);
    expect(g.smokeClouds.get(1)).toHaveLength(7);
    expect(g.fireFx.has(2)).toBe(true);
    expect(methodsCalled(g.zoneGfx)).toEqual(['clear']); // no vector fallback drawn

    const puffs = g.smokeClouds.get(1)!;
    const fire = g.fireFx.get(2)!;
    g.zones = [];
    g.update(0, 0);
    expect(g.smokeClouds.size).toBe(0);
    expect(g.fireFx.size).toBe(0);
    expect(puffs.every((p) => p.destroyed)).toBe(true);
    expect(fire.emitter.destroyed && fire.glow.destroyed).toBe(true);
  });

  it('falls back to vector circles when particle textures are missing', () => {
    g.zones = [
      [1, 'smoke', 100, 100, 80, 600],
      [2, 'fire', 200, 200, 60, 600],
    ];
    g.update(0, 0);
    expect(g.smokeClouds.size).toBe(0);
    expect(g.fireFx.size).toBe(0);
    expect(methodsCalled(g.zoneGfx).filter((m) => m === 'fillCircle')).toHaveLength(3); // smoke 1 + fire 2
  });
});

describe('GameScene.update — tracers', () => {
  it('draws live tracers and drops expired ones', () => {
    g.tracers = [
      { x: 0, y: 0, tx: 10, ty: 10, until: 1050 },
      { x: 0, y: 0, tx: 20, ty: 20, until: 900 },
    ];
    g.update(0, 0);
    expect(g.tracers).toHaveLength(1);
    expect(methodsCalled(g.tracerGfx).filter((m) => m === 'lineBetween')).toHaveLength(1);
  });
});

describe('GameScene.handleEvent', () => {
  it('records a tracer for a gunshot and adds a muzzle flash when the texture exists', () => {
    textures.add('muzzle');
    g.handleEvent({ e: 'shot', id: 2, x: 0, y: 0, tx: 100, ty: 0, w: 'ak47' });
    expect(g.tracers).toHaveLength(1);
    expect(created.some((o) => o.factory === 'image' && (o.args as unknown[])[2] === 'muzzle')).toBe(true);
    expect(sfx).toHaveBeenCalledWith('shot_rifle', { x: 0, y: 0 }, g.listener);
  });

  it('adds no muzzle flash for knife swings', () => {
    textures.add('muzzle');
    g.handleEvent({ e: 'shot', id: 2, x: 0, y: 0, tx: 10, ty: 0, w: 'knife' });
    expect(created).toHaveLength(0);
  });

  it('reports kills to the HUD with names and our involvement', () => {
    g.handleEvent({ e: 'kill', k: 1, v: 3, w: 'ak47' });
    g.handleEvent({ e: 'kill', k: 0, v: 1, w: 'c4' });
    expect(g.game.events.payloads('hud:kill')).toEqual([
      [{ killer: 'Me', victim: 'Enemy', weapon: 'AK-47', meKiller: true, meVictim: false }],
      [{ killer: '', victim: 'Me', weapon: 'C4', meKiller: false, meVictim: true }],
    ]);
    expect(sfx).toHaveBeenCalledWith('kill');
  });

  it('shakes the camera for a nearby HE but not a distant one', () => {
    const { x, y } = g.predictor.pos;
    g.handleEvent({ e: 'he_pop', x: x + 50, y });
    g.handleEvent({ e: 'he_pop', x: x + 5000, y });
    expect(methodsCalled(g.cameras.main).filter((m) => m === 'shake')).toHaveLength(1);
    expect(sfx).toHaveBeenCalledTimes(2);
  });

  it('ends the session after the match-end banner', () => {
    g.handleEvent({ e: 'match_end', winner: 'CT' });
    expect(g.game.events.payloads('hud:matchend')).toHaveLength(1);
    const [, onDone] = g.time.delayedCall.mock.calls[0] as [number, () => void];
    onDone();
    expect(g.conn.disconnect).toHaveBeenCalled();
    expect(g.game.events.payloads('session:end')).toHaveLength(1);
  });
});

describe('GameScene.applyRoster', () => {
  it('rebuilds entities that left or switched sides and keeps the rest', () => {
    g.update(0, 0); // creates entity 1
    sampled.set(2, remote(1, 1));
    sampled.set(3, remote(2, 2));
    g.update(0, 0);
    const mate = g.entities.get(2)!;
    const enemy = g.entities.get(3)!;

    g.applyRoster(roster([1, 'Me', 'T'], [2, 'Mate', 'CT'])); // mate swapped, enemy left
    expect(g.entities.has(1)).toBe(true);
    expect(g.entities.has(2)).toBe(false);
    expect(g.entities.has(3)).toBe(false);
    expect(mate.sprite.destroyed && enemy.label.destroyed).toBe(true);
    expect(g.game.events.payloads('hud:roster')).toHaveLength(1);
  });
});
