// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  games: [] as Array<{
    config: Record<string, unknown>;
    destroy: ReturnType<typeof vi.fn>;
    handlers: Record<string, (...a: unknown[]) => void>;
    events: { once: (e: string, fn: (...a: unknown[]) => void) => void };
  }>,
  startCb: null as null | (() => void),
}));

vi.mock('phaser', () => {
  class Game {
    destroy = vi.fn();
    handlers: Record<string, (...a: unknown[]) => void> = {};
    events = { once: (e: string, fn: (...a: unknown[]) => void) => (this.handlers[e] = fn) };
    constructor(public config: Record<string, unknown>) {
      state.games.push(this as never);
    }
  }
  return { default: { Game, AUTO: 0, Scale: { RESIZE: 3 }, Scene: class {} } };
});
vi.mock('../src/scenes/BootScene.js', () => ({ BootScene: class Boot {} }));
vi.mock('../src/scenes/GameScene.js', () => ({ GameScene: class Game {} }));
vi.mock('../src/scenes/HudScene.js', () => ({ HudScene: class Hud {} }));
const menu = vi.hoisted(() => ({ initMenu: vi.fn((cb: () => void) => (state.startCb = cb)), resumeMenu: vi.fn() }));
vi.mock('../src/menu.js', () => menu);
const chat = vi.hoisted(() => ({ teardownChat: vi.fn() }));
vi.mock('../src/chat.js', () => chat);

beforeEach(async () => {
  state.games.length = 0;
  state.startCb = null;
  vi.clearAllMocks();
  document.body.innerHTML = '<div id="menu" style="display:flex"></div><div id="game" style="display:none"></div>';
  vi.resetModules();
  await import('../src/main.js'); // module state (`game`) is fresh for every test
});

const display = (id: string) => document.getElementById(id)!.style.display;

describe('main', () => {
  it('registers the menu start callback on load', () => {
    expect(menu.initMenu).toHaveBeenCalledTimes(1);
    expect(state.startCb).toBeTypeOf('function');
  });

  it('starting hides the menu, shows the game and boots Phaser with the three scenes', () => {
    state.startCb!();
    expect(display('menu')).toBe('none');
    expect(display('game')).toBe('block');
    expect(state.games).toHaveLength(1);
    const cfg = state.games[0].config as { parent: string; scene: Array<{ name: string }>; scale: { mode: number } };
    expect(cfg.parent).toBe('game');
    expect(cfg.scale.mode).toBe(3);
    expect(cfg.scene.map((s) => s.name)).toEqual(['Boot', 'Game', 'Hud']);
  });

  it('session:end destroys the game, tears down chat, and returns to the menu with the error', () => {
    state.startCb!();
    state.games[0].handlers['session:end']('server went away');
    expect(state.games[0].destroy).toHaveBeenCalledWith(true);
    expect(chat.teardownChat).toHaveBeenCalledTimes(1);
    expect(display('game')).toBe('none');
    expect(display('menu')).toBe('flex');
    expect(menu.resumeMenu).toHaveBeenCalledWith('server went away');
  });

  it('session:end without a reason resumes the menu cleanly', () => {
    state.startCb!();
    state.games[0].handlers['session:end']();
    expect(menu.resumeMenu).toHaveBeenCalledWith(undefined);
  });

  it('session:restart tears down and relaunches a fresh game without touching the menu', () => {
    state.startCb!();
    state.games[0].handlers['session:restart']();
    expect(state.games[0].destroy).toHaveBeenCalledWith(true);
    expect(chat.teardownChat).toHaveBeenCalledTimes(1);
    expect(state.games).toHaveLength(2);
    expect(menu.resumeMenu).not.toHaveBeenCalled();
    expect(display('game')).toBe('block');
  });
});
