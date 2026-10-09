import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { PFLAG, type GameEvent, type PlayerSnap, type RosterEntry, type SnapshotMsg, type WelcomeMsg } from '@cs2d/shared';
import { fakeFactory, fakeObject, FakeEmitter, type FakeObject } from './phaserFakes.js';

vi.mock('phaser', () => ({
  default: { Scene: class {}, BlendModes: { ADD: 1 }, Geom: { Circle: class {} } },
}));
vi.mock('../src/audio/sfx.js', () => ({ sfx: vi.fn() }));
vi.mock('../src/audio/synth.js', () => ({ toggleMute: vi.fn(), unlockAudio: vi.fn() }));
vi.mock('../src/render/mapRender.js', () => ({ renderMap: vi.fn() }));
vi.mock('../src/chat.js', () => ({ appendChatLine: vi.fn(), initChat: vi.fn() }));
vi.mock('../src/scenes/BootScene.js', () => ({ playerTexture: (_s: unknown, team: string) => `player_${team}` }));

const { GameScene } = await import('../src/scenes/GameScene.js');
const { sfx } = await import('../src/audio/sfx.js');
const { toggleMute, unlockAudio } = await import('../src/audio/synth.js');
const { renderMap } = await import('../src/render/mapRender.js');
const { appendChatLine, initChat } = await import('../src/chat.js');
const { session } = await import('../src/session.js');

interface Conn {
  send: Mock;
  disconnect: Mock;
  connect: Mock;
  onWelcome: (m: WelcomeMsg) => void;
  onRoster: (m: { players: RosterEntry[] }) => void;
  onSnapshot: (m: SnapshotMsg) => void;
  onClose: (code: number, reason: string) => void;
  onChat: (m: { from: string; text: string; team: 'T' | 'CT' | null }) => void;
  onPong: (m: { t0: number }) => void;
}

interface Scene {
  conn: Conn;
  create(): void;
  game: { events: FakeEmitter };
  events: FakeEmitter;
  input: { keyboard: { addKeys: Mock; on: Mock }; once: Mock; activePointer: { isDown: boolean } };
  scene: { launch: Mock };
  time: { addEvent: Mock; delayedCall: Mock; now: number };
  statusText: FakeObject;
  predictor: { pos: { x: number; y: number }; reconcile: Mock };
  myId: number;
  myTeam: 'T' | 'CT';
  alive: boolean;
  myHp: number;
  spawned: boolean;
  chatOpen: boolean;
  buyOpen: boolean;
  attackLatched: boolean;
  pendingSlot?: number;
  spectateIndex: number;
  match: unknown;
  me: unknown;
  groundItems: unknown;
  nades: unknown;
  zones: unknown;
  buffer: { push: Mock };
  lastServerTick: number;
  roster: Map<number, RosterEntry>;
  onBuy(item: string): void;
  onChatSend(text: string): void;
  onChatToggle(open: boolean): void;
  onBuyToggle(open: boolean): void;
  handleEvent: Mock;
}

let s: Scene;
let hotkeys: Map<string, () => void>;
let connectDeferred: { resolve: () => void; reject: (e: Error) => void };

function snap(over: Partial<SnapshotMsg> = {}, players: PlayerSnap[] = []): SnapshotMsg {
  return { t: 's', k: 7, a: 3, p: players, ...over };
}
const self = (x: number, y: number, hp = 100, flags: number = PFLAG.ALIVE): PlayerSnap => [1, x, y, 0, hp, flags, 'usp'];

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('window', {});
  vi.stubGlobal('location', { port: '', hostname: 'h', protocol: 'http:', host: 'h' });
  Object.assign(session, { name: 'Me', roomCode: 'ABCD', map: 'testarena', team: 'T', botsRequested: undefined });

  s = new GameScene() as unknown as Scene;
  const factory = fakeFactory();
  hotkeys = new Map();
  const noopKeys = {};
  Object.assign(s, {
    add: factory.add,
    make: { graphics: () => fakeObject() },
    cameras: { main: fakeObject() },
    game: { events: new FakeEmitter() },
    events: new FakeEmitter(),
    input: {
      keyboard: {
        addKeys: vi.fn(() => noopKeys),
        on: vi.fn((evt: string, fn: () => void) => hotkeys.set(evt.replace('keydown-', ''), fn)),
      },
      once: vi.fn(),
      activePointer: { isDown: false },
    },
    scene: { launch: vi.fn() },
    time: { addEvent: vi.fn(() => fakeObject()), delayedCall: vi.fn(), now: 0 },
  });
  const p = new Promise<void>((resolve, reject) => (connectDeferred = { resolve, reject }));
  s.conn = Object.assign(s.conn, { send: vi.fn(), disconnect: vi.fn(), connect: vi.fn(() => p) });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('GameScene.create — setup', () => {
  it('builds the world, wires input and launches the HUD', () => {
    s.create();
    expect(renderMap).toHaveBeenCalledTimes(1);
    expect(s.input.keyboard.addKeys).toHaveBeenCalledWith(expect.stringContaining('W,A,S,D'));
    expect(s.scene.launch).toHaveBeenCalledWith('Hud');
    expect(initChat).toHaveBeenCalledTimes(1);
    expect(s.statusText.calls.some((c) => c.method === 'setOrigin')).toBe(true);
    expect(s.conn.connect).toHaveBeenCalledWith('ws://h?room=ABCD');
    expect((window as unknown as { __scene: unknown }).__scene).toBe(s);
  });

  it('resets per-run input state because scene instances are reused on restart', () => {
    s.buyOpen = true;
    s.attackLatched = true;
    s.create();
    expect(s.buyOpen).toBe(false);
    expect(s.attackLatched).toBe(false);
  });

  it('forwards the chat widget callbacks onto the game event bus', () => {
    s.create();
    const [onSend, onToggle] = (initChat as Mock).mock.calls[0] as [(t: string) => void, (o: boolean) => void];
    const sent = vi.fn();
    const toggled = vi.fn();
    s.game.events.on('chat:send', sent);
    s.game.events.on('chat:toggle', toggled);
    onSend('gg');
    onToggle(true);
    expect(sent).toHaveBeenCalledWith('gg');
    expect(toggled).toHaveBeenCalledWith(true);
  });

  it('unlocks audio on the first pointer press', () => {
    s.create();
    const [evt, fn] = s.input.once.mock.calls[0] as [string, () => void];
    expect(evt).toBe('pointerdown');
    fn();
    expect(unlockAudio).toHaveBeenCalled();
  });
});

describe('GameScene.create — hotkeys', () => {
  beforeEach(() => s.create());

  it('selects weapon slots and cycles spectate targets', () => {
    hotkeys.get('ONE')!();
    expect(s.pendingSlot).toBe(1);
    hotkeys.get('FOUR')!();
    expect(s.pendingSlot).toBe(4);
    hotkeys.get('SPACE')!();
    expect(s.spectateIndex).toBe(1);
  });

  it('toggles mute and switches teams via the bracket keys', () => {
    hotkeys.get('M')!();
    expect(toggleMute).toHaveBeenCalled();
    hotkeys.get('OPEN_BRACKET')!();
    hotkeys.get('CLOSED_BRACKET')!();
    expect(s.conn.send).toHaveBeenNthCalledWith(1, { t: 'team', team: 'T' });
    expect(s.conn.send).toHaveBeenNthCalledWith(2, { t: 'team', team: 'CT' });
  });

  it('ignores every hotkey while the chat box has focus', () => {
    s.game.events.emit('chat:toggle', true);
    expect(s.chatOpen).toBe(true);
    for (const fn of hotkeys.values()) fn();
    expect(s.pendingSlot).toBeUndefined();
    expect(s.spectateIndex).toBe(0);
    expect(toggleMute).not.toHaveBeenCalled();
    expect(s.conn.send).not.toHaveBeenCalled();
  });
});

describe('GameScene.create — game event bus', () => {
  beforeEach(() => s.create());

  it('relays buy and chat requests to the server', () => {
    s.game.events.emit('buy', 'ak47');
    expect(s.conn.send).toHaveBeenCalledWith({ t: 'buy', item: 'ak47' });
    expect(sfx).toHaveBeenCalledWith('buy');
    s.game.events.emit('chat:send', 'hello');
    expect(s.conn.send).toHaveBeenCalledWith({ t: 'chat', text: 'hello' });
  });

  it('latches an attack held through the buy menu closing, but only if the button is down', () => {
    s.game.events.emit('buy:toggle', true);
    expect(s.buyOpen).toBe(true);
    s.game.events.emit('buy:toggle', false);
    expect(s.attackLatched).toBe(false);

    s.input.activePointer.isDown = true;
    s.game.events.emit('buy:toggle', true);
    s.game.events.emit('buy:toggle', false);
    expect(s.attackLatched).toBe(true);
  });

  it('detaches its listeners and stops pinging on shutdown', async () => {
    connectDeferred.resolve();
    await vi.waitFor(() => expect(s.time.addEvent).toHaveBeenCalled());
    const timer = (s.time.addEvent as Mock).mock.results[0].value as FakeObject;
    s.events.emit('shutdown');
    s.game.events.emit('buy', 'ak47');
    s.game.events.emit('chat:send', 'x');
    s.game.events.emit('chat:toggle', true);
    s.game.events.emit('buy:toggle', true);
    expect(s.conn.send.mock.calls.some((c) => (c[0] as { t: string }).t === 'buy')).toBe(false);
    expect(s.chatOpen).toBe(false);
    expect(s.buyOpen).toBe(false);
    expect(timer.calls.some((c) => c.method === 'destroy')).toBe(true);
  });
});

describe('GameScene.create — connection lifecycle', () => {
  it('joins with the session identity once connected and starts pinging', async () => {
    s.create();
    connectDeferred.resolve();
    await vi.waitFor(() => expect(s.conn.send).toHaveBeenCalledWith({ t: 'join', name: 'Me', team: 'T' }));
    expect(s.conn.send).toHaveBeenCalledTimes(1);

    const cfg = (s.time.addEvent as Mock).mock.calls[0][0] as { delay: number; loop: boolean; callback: () => void };
    expect(cfg).toMatchObject({ delay: 2000, loop: true });
    cfg.callback();
    expect(s.conn.send).toHaveBeenLastCalledWith({ t: 'ping', t0: expect.any(Number) });
  });

  it('asks for bots right after joining when the menu requested them', async () => {
    session.botsRequested = { perTeam: 3, difficulty: 'hard' };
    s.create();
    connectDeferred.resolve();
    await vi.waitFor(() => expect(s.conn.send).toHaveBeenCalledTimes(2));
    expect(s.conn.send).toHaveBeenNthCalledWith(2, { t: 'bots', perTeam: 3, difficulty: 'hard' });
  });

  it('ends the session with a hint when the server cannot be reached', async () => {
    s.create();
    connectDeferred.reject(new Error('nope'));
    await vi.waitFor(() => expect(s.time.delayedCall).toHaveBeenCalled());
    expect(s.statusText.text).toMatch(/cannot reach server/);
    expect(s.conn.send).not.toHaveBeenCalled();
  });

  it('turns a server close into the player-facing message', () => {
    s.create();
    s.conn.onClose(4003, 'whatever');
    expect(s.statusText.text).toBe('room full');
  });

  it('shows chat lines in the sender team colour and answers pongs with the round trip', () => {
    s.create();
    s.conn.onChat({ from: 'Ann', text: 'rush b', team: 'CT' });
    expect(appendChatLine).toHaveBeenCalledWith('Ann', 'rush b', expect.any(String));

    vi.spyOn(performance, 'now').mockReturnValue(1000);
    s.conn.onPong({ t0: 940 });
    expect(s.game.events.payloads('hud:ping')).toEqual([[60]]);
  });

  it('applies roster updates', () => {
    s.create();
    s.conn.onRoster({ players: [{ id: 1, name: 'Me', team: 'T', k: 0, d: 0 }] });
    expect(s.game.events.payloads('hud:roster')).toHaveLength(1);
  });
});

describe('GameScene.create — welcome', () => {
  it('records our id and clears the connecting banner', () => {
    s.create();
    s.conn.onWelcome({ t: 'welcome', id: 9, map: 'testarena', tick: 0 });
    expect(s.myId).toBe(9);
    expect(s.statusText.visible).toBe(false);
  });

  it('rebuilds the game when the room runs a different map than the menu assumed', () => {
    s.create();
    s.conn.onWelcome({ t: 'welcome', id: 9, map: 'dust2', tick: 0 });
    expect(session.map).toBe('dust2');
    expect(s.conn.disconnect).toHaveBeenCalled();
    expect(s.game.events.payloads('session:restart')).toHaveLength(1);
    expect(s.myId).not.toBe(9);
  });
});

describe('GameScene.create — snapshots', () => {
  beforeEach(() => {
    s.create();
    s.conn.onWelcome({ t: 'welcome', id: 1, map: 'testarena', tick: 0 });
    s.handleEvent = vi.fn();
    s.predictor.reconcile = vi.fn();
  });

  it('buffers the snapshot and stores the shared world state', () => {
    const m = { ph: 'live', end: 100, rn: 2, st: 1, sct: 0 };
    const me = { ammo: 10, reserve: 20, armor: 0, money: 800, slot: 2, weapon: 'usp', reload: 0 };
    const msg = snap({ m: m as never, g: [[1, 'ak47', 5, 5]], n: [[2, 'he', 1, 1]], z: [[3, 'smoke', 1, 1, 50, 100]], me }, [self(100, 100)]);
    const push = vi.spyOn(s.buffer, 'push');
    s.conn.onSnapshot(msg);
    expect(push).toHaveBeenCalledWith(msg);
    expect(s.lastServerTick).toBe(7);
    expect(s.match).toBe(m);
    expect(s.me).toBe(me);
    expect(s.groundItems).toHaveLength(1);
    expect(s.nades).toHaveLength(1);
    expect(s.zones).toHaveLength(1);
  });

  it('defaults absent optional sections to empty', () => {
    s.conn.onSnapshot(snap({}, [self(100, 100)]));
    expect(s.match).toBeNull();
    expect(s.groundItems).toEqual([]);
    expect(s.nades).toEqual([]);
    expect(s.zones).toEqual([]);
  });

  it('snaps hard to the server on the first snapshot', () => {
    s.conn.onSnapshot(snap({}, [self(300, 400)]));
    expect(s.spawned).toBe(true);
    expect(s.predictor.pos).toEqual({ x: 300, y: 400 });
    expect(s.predictor.reconcile).toHaveBeenCalledWith({ x: 300, y: 400 }, 3, false);
  });

  it('reconciles smoothly afterwards, and moves only while alive and out of freeze', () => {
    s.conn.onSnapshot(snap({ m: { ph: 'live', end: 1, rn: 1, st: 0, sct: 0 } }, [self(300, 400)]));
    s.predictor.pos = { x: 300, y: 400 };
    s.predictor.reconcile.mockClear();

    s.conn.onSnapshot(snap({ m: { ph: 'live', end: 1, rn: 1, st: 0, sct: 0 } }, [self(305, 400)]));
    expect(s.predictor.reconcile).toHaveBeenLastCalledWith({ x: 305, y: 400 }, 3, true);

    s.conn.onSnapshot(snap({ m: { ph: 'freeze', end: 1, rn: 1, st: 0, sct: 0 } }, [self(305, 400)]));
    expect(s.predictor.reconcile).toHaveBeenLastCalledWith({ x: 305, y: 400 }, 3, false);

    s.conn.onSnapshot(snap({ m: { ph: 'live', end: 1, rn: 1, st: 0, sct: 0 } }, [self(305, 400, 0, 0)]));
    expect(s.predictor.reconcile).toHaveBeenLastCalledWith({ x: 305, y: 400 }, 3, false);
    expect(s.alive).toBe(false);
  });

  it('treats a >200px jump (round-start respawn) as a teleport', () => {
    s.conn.onSnapshot(snap({}, [self(300, 400)]));
    s.predictor.pos = { x: 300, y: 400 };
    s.predictor.reconcile.mockClear();
    s.conn.onSnapshot(snap({}, [self(900, 900)]));
    expect(s.predictor.pos).toEqual({ x: 900, y: 900 });
    expect(s.predictor.reconcile).toHaveBeenCalledWith({ x: 900, y: 900 }, 3, false);
  });

  it('does not snap on an x of 0 (not yet placed) once spawned', () => {
    s.conn.onSnapshot(snap({}, [self(300, 400)]));
    s.predictor.pos = { x: 300, y: 400 };
    s.predictor.reconcile.mockClear();
    s.conn.onSnapshot(snap({}, [self(0, 0)]));
    expect(s.predictor.reconcile).toHaveBeenCalledWith({ x: 0, y: 0 }, 3, true);
  });

  it('publishes our vitals to the HUD', () => {
    const me = { ammo: 1, reserve: 2, armor: 3, money: 4, slot: 1, weapon: 'usp', reload: 0 };
    s.conn.onSnapshot(snap({ me }, [self(100, 100, 77)]));
    const [payload] = s.game.events.payloads('hud:self')[0];
    expect(payload).toMatchObject({ hp: 77, alive: true, me, team: 'T' });
  });

  it('emits nothing for the HUD when we are not in the snapshot', () => {
    s.conn.onSnapshot(snap({}, [[2, 1, 1, 0, 100, PFLAG.ALIVE, 'usp']]));
    expect(s.game.events.payloads('hud:self')).toHaveLength(0);
  });

  it('plays the reload cue only on the rising edge', () => {
    const me = (reload: number) => ({ ammo: 1, reserve: 2, armor: 0, money: 0, slot: 1, weapon: 'usp', reload });
    s.conn.onSnapshot(snap({ me: me(30) }, [self(100, 100)]));
    s.conn.onSnapshot(snap({ me: me(20) }, [self(100, 100)]));
    expect(sfx).toHaveBeenCalledTimes(1);
    expect(sfx).toHaveBeenCalledWith('reload');
    s.conn.onSnapshot(snap({ me: me(0) }, [self(100, 100)]));
    s.conn.onSnapshot(snap({ me: me(30) }, [self(100, 100)]));
    expect(sfx).toHaveBeenCalledTimes(2);
  });

  it('dispatches every event in the snapshot', () => {
    const evs: GameEvent[] = [{ e: 'defused' }, { e: 'swap' }];
    s.conn.onSnapshot(snap({ ev: evs }, [self(100, 100)]));
    expect(s.handleEvent.mock.calls.map((c) => c[0])).toEqual(evs);
  });
});
