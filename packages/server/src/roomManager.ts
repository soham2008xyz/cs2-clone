import type { BotDifficulty } from './bots/bot.js';
import { Room, type RoomTimings } from './room.js';

export interface RoomMeta {
  code: string;
  map: string;
  backfillBots: boolean;
  botDifficulty: BotDifficulty;
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

/** Grace period before an empty/bot-only room is reaped (covers create→join latency). */
const REAP_GRACE_MS = 60000;

/** Owns every live Room instance, keyed by a short join code. */
export class RoomManager {
  private rooms = new Map<string, { room: Room; meta: RoomMeta; createdAt: number }>();

  create(map: string, backfillBots: boolean, timings: Partial<RoomTimings> = {}, botDifficulty: BotDifficulty = 'normal'): RoomMeta {
    let code = genCode();
    while (this.rooms.has(code)) code = genCode();
    const room = new Room(map, timings);
    room.start();
    const meta: RoomMeta = { code, map, backfillBots, botDifficulty };
    this.rooms.set(code, { room, meta, createdAt: Date.now() });
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

  /**
   * Stops and drops rooms with no human connections (empty or bots-only, e.g.
   * after backfill replaced every leaver). The grace window keeps freshly
   * created rooms alive until their creator's websocket join lands.
   */
  reap(): void {
    for (const [code, { room, createdAt }] of this.rooms) {
      const hasHuman = [...room.players.values()].some((p) => p.ws !== null);
      if (!hasHuman && Date.now() - createdAt > REAP_GRACE_MS) {
        room.stop();
        this.rooms.delete(code);
      }
    }
  }
}
