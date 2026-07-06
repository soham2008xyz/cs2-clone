import { Room, type RoomTimings } from './room.js';

export interface RoomMeta {
  code: string;
  map: string;
  backfillBots: boolean;
}

const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // excludes ambiguous chars (0/O, 1/I)

function genCode(len = 4): string {
  let s = '';
  for (let i = 0; i < len; i++) s += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
  return s;
}

export interface RoomListing {
  code: string;
  map: string;
  players: number;
  phase: string;
}

/** Owns every live Room instance, keyed by a short join code. */
export class RoomManager {
  private rooms = new Map<string, { room: Room; meta: RoomMeta }>();

  create(map: string, backfillBots: boolean, timings: Partial<RoomTimings> = {}): RoomMeta {
    let code = genCode();
    while (this.rooms.has(code)) code = genCode();
    const room = new Room(map, timings);
    room.start();
    const meta: RoomMeta = { code, map, backfillBots };
    this.rooms.set(code, { room, meta });
    return meta;
  }

  get(code: string): { room: Room; meta: RoomMeta } | undefined {
    return this.rooms.get(code.toUpperCase());
  }

  list(): RoomListing[] {
    return [...this.rooms.values()]
      .filter(({ room }) => room.players.size > 0)
      .map(({ room, meta }) => ({ code: meta.code, map: meta.map, players: room.players.size, phase: room.phase }));
  }

  /** Stops and drops rooms nobody is connected to (call periodically). */
  reap(): void {
    for (const [code, { room }] of this.rooms) {
      if (room.players.size === 0) {
        room.stop();
        this.rooms.delete(code);
      }
    }
  }
}
