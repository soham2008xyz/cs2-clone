import { MAX_PLAYERS_PER_ROOM } from '@cs2d/shared';
import { CreateRoomError, createRoom, listRooms, type RoomListing } from './net/api.js';
import { session } from './session.js';

const ROOM_LIST_REFRESH_MS = 3000;

function el<T extends HTMLElement>(id: string): T {
  return document.getElementById(id) as T;
}

function playerName(): string {
  const raw = el<HTMLInputElement>('menu-name').value.trim();
  return raw || `Player${Math.floor(Math.random() * 1000)}`; // NOSONAR - non-cryptographic: cosmetic default guest name
}

function showError(msg: string): void {
  el('menu-error').textContent = msg;
}

/** Player-facing text for a failed create request; 429/503 come from the server's caps. */
function createFailureMessage(err: unknown, fallback: string): string {
  if (err instanceof CreateRoomError) {
    if (err.status === 429) return 'creating rooms too fast — wait a moment and try again';
    if (err.status === 503) return 'server is full — join an open room or try again later';
  }
  return fallback;
}

function renderRooms(rooms: RoomListing[], onJoin: (code: string, map: string) => void): void {
  const container = el('menu-rooms');
  container.replaceChildren();
  if (rooms.length === 0) {
    const empty = document.createElement('div');
    empty.id = 'menu-rooms-empty';
    empty.textContent = 'No open rooms — create one!';
    container.appendChild(empty);
    return;
  }
  for (const r of rooms) {
    const row = document.createElement('div');
    row.className = 'room-row';
    const label = document.createElement('span');
    label.textContent = `${r.code}  ·  ${r.map}  ·  ${r.players}/${MAX_PLAYERS_PER_ROOM}  ·  ${r.phase}`;
    const btn = document.createElement('button');
    const full = r.full ?? r.players >= MAX_PLAYERS_PER_ROOM;
    btn.textContent = full ? 'Full' : 'Join';
    btn.disabled = full;
    btn.onclick = () => onJoin(r.code, r.map);
    row.appendChild(label);
    row.appendChild(btn);
    container.appendChild(row);
  }
}

let resume: ((error?: string) => void) | null = null;

/** Back to the menu after a match: shows an optional message, refreshes the room list at once and restarts polling. */
export function resumeMenu(error = ''): void {
  resume?.(error);
}

/** Wires the DOM menu overlay; calls onStart() once a room is chosen and session is populated. */
export function initMenu(onStart: () => void): void {
  let refreshTimer: ReturnType<typeof setInterval> | null = null;
  let knownRooms: RoomListing[] = []; // last listing, for map lookup on join-by-code

  const refreshRooms = () => {
    listRooms()
      .then(({ rooms }) => {
        knownRooms = rooms;
        renderRooms(rooms, join);
      })
      .catch(() => showError('cannot reach server — start it with: npm run dev:server'));
  };

  const enterRoom = (code: string, map: string, botsRequested?: typeof session.botsRequested) => {
    session.name = playerName();
    session.roomCode = code;
    session.map = map;
    session.botsRequested = botsRequested;
    if (refreshTimer) clearInterval(refreshTimer);
    onStart();
  };

  resume = (error = '') => {
    showError(error);
    if (refreshTimer) clearInterval(refreshTimer);
    refreshRooms();
    refreshTimer = setInterval(refreshRooms, ROOM_LIST_REFRESH_MS);
  };

  const join = (code: string, map?: string) => {
    showError('');
    const normalized = code.toUpperCase();
    // the server's welcome message corrects any wrong guess (session:restart)
    const roomMap = map ?? knownRooms.find((r) => r.code === normalized)?.map ?? 'dust2';
    enterRoom(normalized, roomMap);
  };

  const selectedDifficulty = (): 'easy' | 'normal' | 'hard' => el<HTMLSelectElement>('menu-difficulty').value as 'easy' | 'normal' | 'hard';

  el<HTMLButtonElement>('menu-quickplay').onclick = async () => {
    showError('');
    try {
      const difficulty = selectedDifficulty();
      const { code, map } = await createRoom('dust2', true, difficulty);
      enterRoom(code, map, { perTeam: 5, difficulty });
    } catch (err) {
      showError(createFailureMessage(err, 'could not create a match — is the server running?'));
    }
  };

  el<HTMLButtonElement>('menu-create').onclick = async () => {
    showError('');
    try {
      const map = el<HTMLSelectElement>('menu-map').value;
      const backfillBots = el<HTMLInputElement>('menu-backfill').checked;
      const { code, map: confirmedMap } = await createRoom(map, backfillBots, selectedDifficulty());
      enterRoom(code, confirmedMap);
    } catch (err) {
      showError(createFailureMessage(err, 'could not create a room — is the server running?'));
    }
  };

  el<HTMLButtonElement>('menu-join').onclick = () => {
    const code = el<HTMLInputElement>('menu-join-code').value.trim();
    if (!code) {
      showError('enter a room code');
      return;
    }
    join(code);
  };
  el<HTMLInputElement>('menu-join-code').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') el<HTMLButtonElement>('menu-join').click();
  });

  resume();
}
