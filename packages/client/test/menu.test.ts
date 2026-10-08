// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const listRooms = vi.fn();
const createRoom = vi.fn();
class CreateRoomError extends Error {
  constructor(readonly status: number) {
    super(`create room failed: ${status}`);
  }
}
vi.mock('../src/net/api.js', () => ({ CreateRoomError, listRooms: (...a: unknown[]) => listRooms(...a), createRoom }));

const { initMenu, resumeMenu } = await import('../src/menu.js');

const IDS = ['menu-name', 'menu-difficulty', 'menu-map', 'menu-backfill', 'menu-join-code'];

beforeEach(() => {
  vi.useFakeTimers();
  createRoom.mockReset();
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

describe('menu capacity handling', () => {
  const flush = () => vi.advanceTimersByTimeAsync(0);

  it('shows a full room as disabled "Full"', async () => {
    listRooms.mockResolvedValue({
      rooms: [
        { code: 'AAAA', map: 'dust2', players: 10, phase: 'live', full: true },
        { code: 'BBBB', map: 'dust2', players: 3, phase: 'live', full: false },
      ],
    });
    initMenu(() => {});
    await flush();
    const buttons = [...document.querySelectorAll<HTMLButtonElement>('#menu-rooms button')];
    expect(buttons.map((b) => [b.textContent, b.disabled])).toEqual([
      ['Full', true],
      ['Join', false],
    ]);
    expect(document.getElementById('menu-rooms')!.textContent).toContain('10/10');
  });

  it('derives "full" from the player count when the server omits it', async () => {
    listRooms.mockResolvedValue({ rooms: [{ code: 'AAAA', map: 'dust2', players: 10, phase: 'live' }] });
    initMenu(() => {});
    await flush();
    expect(document.querySelector<HTMLButtonElement>('#menu-rooms button')!.disabled).toBe(true);
  });

  it.each([
    [429, 'creating rooms too fast'],
    [503, 'server is full'],
  ])('explains a %i from room creation', async (status, text) => {
    createRoom.mockRejectedValue(new CreateRoomError(status));
    initMenu(() => {});
    document.getElementById('menu-create')!.click();
    await flush();
    expect(document.getElementById('menu-error')!.textContent).toContain(text);
  });

  it('explains a 503 on quick play too', async () => {
    createRoom.mockRejectedValue(new CreateRoomError(503));
    initMenu(() => {});
    document.getElementById('menu-quickplay')!.click();
    await flush();
    expect(document.getElementById('menu-error')!.textContent).toContain('server is full');
  });

  it('keeps the generic message for other create failures', async () => {
    createRoom.mockRejectedValue(new Error('network down'));
    initMenu(() => {});
    document.getElementById('menu-create')!.click();
    await flush();
    expect(document.getElementById('menu-error')!.textContent).toContain('is the server running');
  });
});
