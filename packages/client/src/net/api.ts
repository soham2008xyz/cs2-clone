export interface RoomListing {
  code: string;
  map: string;
  players: number;
  phase: string;
}

const VITE_DEV_PORT = '5173';

export function apiBase(): string {
  // vite dev server: game server runs separately on :8090; otherwise same origin
  if (location.port === VITE_DEV_PORT) return `http://${location.hostname || 'localhost'}:8090`;
  return location.origin;
}

export async function listRooms(): Promise<{ maps: string[]; rooms: RoomListing[] }> {
  const res = await fetch(`${apiBase()}/rooms`);
  if (!res.ok) throw new Error(`list rooms failed: ${res.status}`);
  return res.json();
}

export async function createRoom(map: string, backfillBots: boolean): Promise<{ code: string; map: string }> {
  const res = await fetch(`${apiBase()}/rooms`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ map, backfillBots }),
  });
  if (!res.ok) throw new Error(`create room failed: ${res.status}`);
  return res.json();
}
