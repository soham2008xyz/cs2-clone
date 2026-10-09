import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { MatchSnap, SelfState, TeamId } from '@cs2d/shared';
import { fakeFactory, FakeEmitter, methodsCalled, type FakeObject } from './phaserFakes.js';

vi.mock('phaser', () => ({ default: { Scene: class {} } }));

const { HudScene } = await import('../src/scenes/HudScene.js');

interface HudInternals {
  add: FakeObject;
  scale: { width: number; height: number; on: () => void };
  input: { keyboard: FakeEmitter };
  game: { events: FakeEmitter };
  events: FakeEmitter;
  time: { now: number };
  tweens: { add: () => void };
  hpText: FakeObject;
  ammoText: FakeObject;
  moneyText: FakeObject;
  weaponText: FakeObject;
  nadeText: FakeObject;
  bombHint: FakeObject;
  timerText: FakeObject;
  scoreText: FakeObject;
  teamHintText: FakeObject;
  blindOverlay: FakeObject;
  progressBar: FakeObject;
  buyPanel: FakeObject;
  buyOpen: boolean;
  killfeed: Array<{ text: FakeObject; until: number }>;
  create(): void;
}

interface SelfPayload {
  hp: number;
  alive: boolean;
  me: SelfState | null;
  team: TeamId;
  match: MatchSnap | null;
}

let hud: HudInternals;

const me = (over: Partial<SelfState> = {}): SelfState => ({
  ammo: 20,
  reserve: 120,
  armor: 0,
  money: 800,
  slot: 2,
  weapon: 'glock',
  reload: 0,
  ...over,
});

const match = (over: Partial<MatchSnap> = {}): MatchSnap => ({ ph: 'live', end: 75 * 60, rn: 3, st: 1, sct: 2, ...over });

function sendSelf(over: Partial<SelfPayload> = {}): void {
  const payload: SelfPayload = { hp: 100, alive: true, me: me(), team: 'T', match: match(), ...over };
  hud.game.events.emit('hud:self', payload);
}

beforeEach(() => {
  hud = new HudScene() as unknown as HudInternals;
  hud.add = fakeFactory().add;
  hud.scale = { width: 800, height: 600, on: () => {} };
  hud.input = { keyboard: new FakeEmitter() };
  hud.game = { events: new FakeEmitter() };
  hud.events = new FakeEmitter();
  hud.time = { now: 0 };
  hud.tweens = { add: () => {} };
  hud.create();
});

describe('HudScene self state', () => {
  it('renders health, armor, money, ammo and the C4 hint', () => {
    sendSelf({ hp: 73, me: me({ armor: 50, helm: 1, buy: 1, bomb: 1, money: 2400 }) });
    expect(hud.hpText.text).toBe('♥ 73  ⛨ 50+');
    expect(hud.moneyText.text).toBe('$ 2400  [B] BUY');
    expect(hud.ammoText.text).toBe('20 / 120');
    expect(hud.weaponText.text).toBe('GLOCK');
    expect(hud.bombHint.text).toContain('YOU HAVE THE C4');
  });

  it('lists carried grenades and shows THROW in the grenade slot', () => {
    sendSelf({ me: me({ slot: 4, nades: ['flash', 'smoke'] }) });
    expect(hud.ammoText.text).toBe('THROW');
    expect(hud.weaponText.text).toBe('FLASHBANG');
    expect(hud.nadeText.text).toBe('[4] Flashbang, Smoke Grenade');
  });

  it('whites out the screen in proportion to remaining blindness', () => {
    sendSelf({ me: me({ blind: 1_000_000 }) });
    const fill = hud.blindOverlay.calls.findLast((c) => c.method === 'setFillStyle');
    expect(fill?.args).toEqual([0xffffff, 1]);
  });

  it('blanks health while dead and leaves gun text alone without self state', () => {
    sendSelf({ alive: false, me: null });
    expect(hud.hpText.text).toBe('');
    expect(hud.ammoText.text).toBe('');
  });
});

describe('HudScene timer and scores', () => {
  it.each([
    ['waiting', 'WARMUP', '#aaaaaa'],
    ['freeze', 'BUY  1:15', '#8fd18f'],
    ['live', '1:15', '#ffffff'],
    ['round_end', '', undefined],
    ['match_end', '', undefined],
  ] as const)('shows the %s phase timer', (ph, text, color) => {
    sendSelf({ match: match({ ph }) });
    expect(hud.timerText.text).toBe(text);
    if (color) expect(hud.timerText.color).toBe(color);
  });

  it('counts down whole seconds while the bomb is planted', () => {
    sendSelf({ match: match({ ph: 'planted', end: 40 * 60 }) });
    expect(hud.timerText.text).toBe('⏱ 40');
  });

  it('shows the score line once both teams are present, and the team hint only in warmup', () => {
    sendSelf({ match: match({ ph: 'waiting' }) });
    expect(hud.scoreText.text).toBe('waiting for both teams…');
    expect(hud.teamHintText.visible).toBe(true);

    sendSelf({ match: match() });
    expect(hud.scoreText.text).toBe('T 1  —  2 CT    round 3');
    expect(hud.teamHintText.visible).toBe(false);
  });

  it('announces buy menu open/close to other scenes', () => {
    hud.input.keyboard.emit('keydown-B');
    hud.input.keyboard.emit('keydown-B');
    expect(hud.game.events.payloads('buy:toggle')).toEqual([[true], [false]]);
  });

  it('closes an open buy menu once buying is no longer allowed', () => {
    hud.input.keyboard.emit('keydown-B');
    expect(hud.buyOpen).toBe(true);
    sendSelf({ me: me({ buy: 1 }) });
    expect(hud.buyOpen).toBe(true);
    sendSelf({ me: me() });
    expect(hud.buyOpen).toBe(false);
  });

  it('draws plant/defuse progress only while alive', () => {
    sendSelf({ match: match({ prog: 0.5 }) });
    expect(methodsCalled(hud.progressBar)).toContain('fillRect');

    hud.progressBar.calls.length = 0;
    sendSelf({ alive: false, match: match({ prog: 0.5 }) });
    expect(methodsCalled(hud.progressBar)).toEqual(['clear']);
  });
});

describe('HudScene killfeed', () => {
  it.each([
    [{ meKiller: true, meVictim: false }, '#ffd76b'],
    [{ meKiller: false, meVictim: true }, '#ff6b6b'],
    [{ meKiller: false, meVictim: false }, '#dddddd'],
  ])('colors the line for %o', (who, color) => {
    hud.game.events.emit('hud:kill', { killer: 'A', victim: 'B', weapon: 'AK-47', ...who });
    const line = hud.killfeed.at(-1)!.text;
    expect(line.text).toBe('A  [AK-47]  B');
    expect((line.args as unknown[])[3]).toMatchObject({ color });
  });

  it('shows world kills without a killer name', () => {
    hud.game.events.emit('hud:kill', { killer: '', victim: 'B', weapon: 'C4', meKiller: false, meVictim: false });
    expect(hud.killfeed.at(-1)!.text.text).toBe('☠  [C4]  B');
  });
});

describe('HudScene buy panel', () => {
  it('rebuilds the buy panel for the new side, with the defuse kit only for CT', () => {
    const texts = (panel: FakeObject): string[] =>
      panel.calls
        .filter((c) => c.method === 'add')
        .map((c) => (c.args[0] as FakeObject).factory === 'text' && (c.args[0] as FakeObject).text)
        .filter((t): t is string => typeof t === 'string');

    sendSelf({ team: 'CT' });
    const ctItems = texts(hud.buyPanel);
    expect(ctItems.some((t) => t.startsWith('Defuse Kit'))).toBe(true);
    expect(ctItems.some((t) => t.startsWith('Kevlar')) && ctItems.some((t) => t.startsWith('Helmet'))).toBe(true);

    sendSelf({ team: 'T' });
    expect(texts(hud.buyPanel).some((t) => t.startsWith('Defuse Kit'))).toBe(false);
  });
});

// ── interaction, overlays and panels ─────────────────────────────────────────

interface HudMore extends Omit<HudInternals, 'tweens'> {
  scorePanel: FakeObject;
  matchEndPanel: FakeObject;
  bannerText: FakeObject;
  spectateText: FakeObject;
  pingText: FakeObject;
  hurtOverlay: FakeObject;
  crosshair: FakeObject;
  hitmarker: FakeObject;
  tweens: { add: ReturnType<typeof vi.fn> };
  update(): void;
}

let more: HudMore;
let made: FakeObject[];

function key(emitter: FakeEmitter, name: string, ev: Partial<KeyboardEvent> = {}): void {
  emitter.emit(name, { preventDefault: vi.fn(), ...ev });
}

describe('HudScene interaction', () => {
  beforeEach(() => {
    const factory = fakeFactory();
    made = factory.created;
    more = new HudScene() as unknown as HudMore;
    more.add = factory.add;
    more.scale = { width: 800, height: 600, on: () => {} };
    more.input = { keyboard: new FakeEmitter(), activePointer: { x: 100, y: 120 } } as never;
    more.game = { events: new FakeEmitter() };
    more.events = new FakeEmitter();
    more.time = { now: 1000 };
    more.tweens = { add: vi.fn() };
    more.create();
  });

  it('B toggles the buy menu and tells the game scene', () => {
    key(more.input.keyboard, 'keydown-B');
    expect(more.buyOpen).toBe(true);
    expect(more.game.events.payloads('buy:toggle')).toEqual([[true]]);
    key(more.input.keyboard, 'keydown-B');
    expect(more.buyOpen).toBe(false);
  });

  it('ignores B while the chat box has focus', () => {
    more.game.events.emit('chat:toggle', true);
    key(more.input.keyboard, 'keydown-B');
    expect(more.buyOpen).toBe(false);
    more.game.events.emit('chat:toggle', false);
    key(more.input.keyboard, 'keydown-B');
    expect(more.buyOpen).toBe(true);
  });

  it('buy rows highlight on hover and emit a purchase on click', () => {
    const row = made.find((o) => o.factory === 'text' && String(o.text).startsWith('AK-47'))!;
    expect(row).toBeDefined();
    const handler = (evt: string) => row.calls.find((c) => c.method === 'on' && c.args[0] === evt)!.args[1] as () => void;
    handler('pointerover')();
    expect(row.color).toBe('#ffe680');
    handler('pointerout')();
    expect(row.color).toBe('#dddddd');
    handler('pointerdown')();
    expect(more.game.events.payloads('buy')).toEqual([['ak47']]);
  });

  it('TAB shows the scoreboard (always preventing browser focus change) and releasing hides it', () => {
    const ev = { preventDefault: vi.fn() };
    more.game.events.emit('hud:roster', [
      { id: 1, name: 'Me', team: 'T', k: 3, d: 1 },
      { id: 2, name: 'Foe', team: 'CT', k: 0, d: 3 },
    ]);
    more.input.keyboard.emit('keydown-TAB', ev);
    expect(ev.preventDefault).toHaveBeenCalled();
    expect(methodsCalled(more.scorePanel)).toContain('setVisible');
    expect(more.scorePanel.visible).toBe(true);
    const rows = more.scorePanel.calls.filter((c) => c.method === 'add').map((c) => (c.args[0] as FakeObject).text);
    expect(rows).toEqual(expect.arrayContaining(['COUNTER-TERRORISTS', 'TERRORISTS', 'Me', '3 / 1', 'Foe', '0 / 3']));
    key(more.input.keyboard, 'keyup-TAB');
    expect(more.scorePanel.visible).toBe(false);
  });

  it('TAB does nothing visible while typing in chat, but still prevents default', () => {
    const ev = { preventDefault: vi.fn() };
    more.game.events.emit('chat:toggle', true);
    more.input.keyboard.emit('keydown-TAB', ev);
    expect(ev.preventDefault).toHaveBeenCalled();
    expect(more.scorePanel.visible).not.toBe(true);
  });

  it('refreshes an open scoreboard when the roster changes, and leaves a closed one alone', () => {
    more.game.events.emit('hud:roster', [{ id: 1, name: 'Early', team: 'T', k: 0, d: 0 }]);
    const closedAdds = more.scorePanel.calls.filter((c) => c.method === 'add').length;
    expect(closedAdds).toBe(0);

    key(more.input.keyboard, 'keydown-TAB');
    more.game.events.emit('hud:roster', [{ id: 2, name: 'Late', team: 'CT', k: 1, d: 0 }]);
    const names = more.scorePanel.calls.filter((c) => c.method === 'add').map((c) => (c.args[0] as FakeObject).text);
    expect(names).toContain('Late');
  });

  it('shows who is being spectated and clears the label when back on self', () => {
    more.game.events.emit('hud:spectate', 'Mate');
    expect(more.spectateText.text).toBe('SPECTATING Mate  (SPACE to cycle)');
    more.game.events.emit('hud:spectate', null);
    expect(more.spectateText.text).toBe('');
  });

  it('shows a ping readout', () => {
    more.game.events.emit('hud:ping', 42);
    expect(more.pingText.text).toBe('42ms');
  });

  it('banners appear in their colour and expire after the ttl', () => {
    more.game.events.emit('hud:banner', { text: 'ROUND 2', color: '#ffffff', ttl: 2000 });
    expect(more.bannerText.text).toBe('ROUND 2');
    expect(more.bannerText.visible).toBe(true);
    more.time.now = 2500;
    more.update();
    expect(more.bannerText.visible).toBe(true);
    more.time.now = 3001;
    more.update();
    expect(more.bannerText.visible).toBe(false);
  });

  it('flashes red and fades out when hurt', () => {
    more.game.events.emit('hud:hurt', 20);
    expect(more.hurtOverlay.calls.find((c) => c.method === 'setFillStyle' && c.args[1] === 0.28)).toBeDefined();
    expect(more.tweens.add).toHaveBeenCalledWith(expect.objectContaining({ targets: more.hurtOverlay, fillAlpha: 0 }));
  });

  it('draws a hit marker for a short window only', () => {
    more.game.events.emit('hud:hitmarker');
    more.update();
    expect(methodsCalled(more.hitmarker).filter((m) => m === 'lineBetween')).toHaveLength(4);
    more.hitmarker.calls.length = 0;
    more.time.now = 1200;
    more.update();
    expect(methodsCalled(more.hitmarker)).not.toContain('lineBetween');
  });

  it('hides the crosshair while the buy menu is open', () => {
    more.update();
    expect(methodsCalled(more.crosshair).filter((m) => m === 'lineBetween')).toHaveLength(4);
    key(more.input.keyboard, 'keydown-B');
    more.crosshair.calls.length = 0;
    more.update();
    expect(methodsCalled(more.crosshair)).not.toContain('lineBetween');
  });

  it('expires killfeed lines and stacks the rest', () => {
    more.game.events.emit('hud:kill', { killer: 'A', victim: 'B', weapon: 'AK-47', meKiller: false, meVictim: false });
    more.time.now = 4000;
    more.game.events.emit('hud:kill', { killer: 'C', victim: 'D', weapon: 'AWP', meKiller: false, meVictim: false });
    const [first, second] = more.killfeed.map((k) => k.text);

    more.time.now = 7500; // first (until 7000) expired, second (until 10000) alive
    more.update();
    expect(first.destroyed).toBe(true);
    expect(more.killfeed).toHaveLength(1);
    expect(second.x).toBe(800 - 16);
    expect(second.y).toBe(16);
  });

  it('lists the match result sorted by kills, marking bots', () => {
    more.game.events.emit('hud:matchend', {
      winner: 'CT',
      roster: [
        { id: 1, name: 'Low', team: 'T', k: 1, d: 5 },
        { id: 2, name: 'Top', team: 'CT', k: 9, d: 0, bot: 1 },
      ],
    });
    const texts = more.matchEndPanel.calls.filter((c) => c.method === 'add').map((c) => (c.args[0] as FakeObject).text).filter((t) => typeof t === 'string');
    expect(texts).toContain('COUNTER-TERRORISTS WIN');
    expect(texts.indexOf('Top (bot)')).toBeLessThan(texts.indexOf('Low'));
    expect(texts).toContain('9 / 0');
    expect(more.matchEndPanel.visible).toBe(true);
  });

  it('titles a Terrorist victory', () => {
    more.game.events.emit('hud:matchend', { winner: 'T', roster: [] });
    const texts = more.matchEndPanel.calls.filter((c) => c.method === 'add').map((c) => (c.args[0] as FakeObject).text);
    expect(texts).toContain('TERRORISTS WIN');
  });

  it('detaches every game-event listener on shutdown', () => {
    more.events.emit('shutdown');
    more.game.events.emit('hud:ping', 99);
    more.game.events.emit('hud:spectate', 'X');
    expect(more.pingText.text).toBe(''); // still the initial empty label: handlers were removed
    expect(more.spectateText.text).toBe('');
  });
});
