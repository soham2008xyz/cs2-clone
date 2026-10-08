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
