// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const listRooms = vi.fn();
vi.mock('../src/net/api.js', () => ({ listRooms: (...a: unknown[]) => listRooms(...a), createRoom: vi.fn() }));

const { initMenu, resumeMenu } = await import('../src/menu.js');

const IDS = ['menu-name', 'menu-difficulty', 'menu-map', 'menu-backfill', 'menu-join-code'];

beforeEach(() => {
  vi.useFakeTimers();
  listRooms.mockReset().mockResolvedValue({ rooms: [] });
  document.body.innerHTML =
    IDS.map((id) => `<input id="${id}" />`).join('') +
    '<button id="menu-quickplay"></button><button id="menu-create"></button><button id="menu-join"></button>' +
    '<div id="menu-rooms"></div><div id="menu-error"></div>';
});

afterEach(() => {
  vi.useRealTimers();
});

describe('menu room list refresh', () => {
  it('keeps polling after a match: resumeMenu refreshes at once and restarts the interval', async () => {
    // 3 s poll
    initMenu(() => {});
    expect(listRooms).toHaveBeenCalledTimes(1);

    // enter a room (join) stops the interval
    (document.getElementById('menu-join-code') as HTMLInputElement).value = 'ABCD';
    document.getElementById('menu-join')!.click();
    listRooms.mockClear();
    await vi.advanceTimersByTimeAsync(9000);
    expect(listRooms).not.toHaveBeenCalled();

    resumeMenu('room not found');
    expect(listRooms).toHaveBeenCalledTimes(1);
    expect(document.getElementById('menu-error')!.textContent).toBe('room not found');
    await vi.advanceTimersByTimeAsync(6000);
    expect(listRooms).toHaveBeenCalledTimes(3);
  });

  it('does not stack intervals when resumed twice', async () => {
    initMenu(() => {});
    resumeMenu();
    resumeMenu();
    listRooms.mockClear();
    await vi.advanceTimersByTimeAsync(3000);
    expect(listRooms).toHaveBeenCalledTimes(1);
  });
});
