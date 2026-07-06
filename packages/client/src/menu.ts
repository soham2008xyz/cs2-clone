import { createRoom, listRooms, type RoomListing } from './net/api.js';
import { session } from './session.js';

const ROOM_LIST_REFRESH_MS = 3000;

function el<T extends HTMLElement>(id: string): T {
  return document.getElementById(id) as T;
}

function playerName(): string {
  const raw = el<HTMLInputElement>('menu-name').value.trim();
  return raw || `Player${Math.floor(Math.random() * 1000)}`;
}

function showError(msg: string): void {
  el('menu-error').textContent = msg;
}

function renderRooms(rooms: RoomListing[], onJoin: (code: string) => void): void {
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
    label.textContent = `${r.code}  ·  ${r.map}  ·  ${r.players}/10  ·  ${r.phase}`;
    const btn = document.createElement('button');
    btn.textContent = 'Join';
    btn.onclick = () => onJoin(r.code);
    row.appendChild(label);
    row.appendChild(btn);
    container.appendChild(row);
  }
}

/** Wires the DOM menu overlay; calls onStart() once a room is chosen and session is populated. */
export function initMenu(onStart: () => void): void {
  let refreshTimer: ReturnType<typeof setInterval> | null = null;

  const refreshRooms = () => {
    listRooms()
      .then(({ rooms }) => renderRooms(rooms, join))
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

  const join = (code: string) => {
    showError('');
    enterRoom(code.toUpperCase(), 'dust2');
  };

  el<HTMLButtonElement>('menu-quickplay').onclick = async () => {
    showError('');
    try {
      const { code, map } = await createRoom('dust2', true);
      enterRoom(code, map, { perTeam: 5, difficulty: 'normal' });
    } catch {
      showError('could not create a match — is the server running?');
    }
  };

  el<HTMLButtonElement>('menu-create').onclick = async () => {
    showError('');
    try {
      const map = el<HTMLSelectElement>('menu-map').value;
      const backfillBots = el<HTMLInputElement>('menu-backfill').checked;
      const { code, map: confirmedMap } = await createRoom(map, backfillBots);
      enterRoom(code, confirmedMap);
    } catch {
      showError('could not create a room — is the server running?');
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

  refreshRooms();
  refreshTimer = setInterval(refreshRooms, ROOM_LIST_REFRESH_MS);
}
