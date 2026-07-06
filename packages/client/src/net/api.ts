export interface RoomListing {
  code: string;
  map: string;
  players: number;
  phase: string;
}

export function apiBase(): string {
  return `http://${location.hostname || 'localhost'}:8090`;
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
