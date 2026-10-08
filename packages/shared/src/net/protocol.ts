import type { TeamId } from '../map/types.js';

// ── Input button bitmask ─────────────────────────────────────────────────────
export const BTN = {
  UP: 1,
  DOWN: 2,
  LEFT: 4,
  RIGHT: 8,
  WALK: 16,
  ATTACK: 32,
  RELOAD: 64,
  USE: 128, // plant / defuse / pick up
  DROP: 256,
} as const;

export interface InputMsg {
  t: 'i';
  s: number; // seq
  b: number; // BTN bitmask
  a: number; // aim angle (radians)
  w?: number; // switch to slot (1=primary 2=secondary 3=knife 4=grenade cycle)
  k?: number; // latest server tick the client has seen (drives lag compensation)
  sp?: number; // dead players: id of the teammate being spectated (the server sends only that view)
}

export interface JoinMsg {
  t: 'join';
  name: string;
  team?: TeamId; // omit = auto-balance
}

export interface BuyMsg {
  t: 'buy';
  item: string; // weapon id or 'kevlar' | 'helmet' | 'kit' | grenade id
}

export interface FillBotsMsg {
  t: 'bots';
  perTeam?: number; // total players per team, humans + bots (default 5)
  difficulty?: 'easy' | 'normal' | 'hard';
}

export interface TeamSwitchMsg {
  t: 'team';
  team: TeamId;
}

export interface ChatMsg {
  t: 'chat';
  text: string;
}

export interface PingMsg {
  t: 'ping';
  t0: number;
}

export type ClientMsg = JoinMsg | InputMsg | BuyMsg | FillBotsMsg | TeamSwitchMsg | ChatMsg | PingMsg;

// ── Server → client ──────────────────────────────────────────────────────────

/** Per-player snapshot tuple: [id, x, y, aim, hp, flags, weaponId] */
export type PlayerSnap = [number, number, number, number, number, number, string];

export const PFLAG = {
  ALIVE: 1,
  WALKING: 2, // reserved for footstep audio
  PLANTING: 4,
  DEFUSING: 8,
  HAS_BOMB: 16,
  RELOADING: 32,
} as const;

/** Private fields for the receiving client's own player. */
export interface SelfState {
  ammo: number;
  reserve: number;
  armor: number;
  money: number;
  slot: number; // 1 primary, 2 secondary, 3 knife, 4 grenade
  weapon: string;
  reload: number; // ticks until reload completes (0 = not reloading)
  bomb?: 1; // carrying the bomb
  kit?: 1; // has defuse kit
  helm?: 1; // wearing a helmet (armor absorbs more)
  buy?: 1; // buying currently allowed
  nades?: string[]; // owned grenade ids, throw order
  blind?: number; // ticks of blindness remaining
}

export type GameEvent =
  | { e: 'shot'; id: number; x: number; y: number; tx: number; ty: number; w: string }
  | { e: 'hit'; id: number; target: number; d: number } // shooter feedback
  | { e: 'hurt'; d: number; from: number } // victim feedback (only sent to victim)
  | { e: 'kill'; k: number; v: number; w: string }
  | { e: 'round_start'; rn: number }
  | { e: 'round_end'; winner: TeamId; reason: string }
  | { e: 'planted'; x: number; y: number }
  | { e: 'defused' }
  | { e: 'exploded'; x: number; y: number }
  | { e: 'swap' } // side swap (halftime / OT half)
  | { e: 'match_end'; winner: TeamId }
  | { e: 'nade_throw'; kind: string; x: number; y: number }
  | { e: 'he_pop'; x: number; y: number }
  | { e: 'flash_pop'; x: number; y: number }
  | { e: 'smoke_pop'; x: number; y: number }
  | { e: 'molotov_ignite'; x: number; y: number };

export type MatchPhase = 'waiting' | 'freeze' | 'live' | 'planted' | 'round_end' | 'match_end';

export interface MatchSnap {
  ph: MatchPhase;
  end: number; // ticks until the phase ends (bomb timer while planted)
  rn: number; // round number (1-based)
  st: number; // score of current T side
  sct: number; // score of current CT side
  bomb?: [number, number, 0 | 1]; // x, y, 0 = dropped, 1 = planted
  prog?: number; // own plant/defuse progress 0..1
}

/** Dropped weapon on the ground: [itemId, weaponId, x, y] */
export type GroundItem = [number, string, number, number];

/** In-flight grenade: [id, kind, x, y] */
export type NadeSnap = [number, string, number, number];

/** Active effect zone (smoke cloud or fire patch): [id, kind, x, y, radius, ticksLeft] */
export type ZoneSnap = [number, 'smoke' | 'fire', number, number, number, number];

export interface SnapshotMsg {
  t: 's';
  k: number; // server tick
  a: number; // last processed input seq for the receiving client
  p: PlayerSnap[];
  m?: MatchSnap;
  g?: GroundItem[];
  n?: NadeSnap[];
  z?: ZoneSnap[];
  me?: SelfState;
  ev?: GameEvent[];
}

export interface RosterEntry {
  id: number;
  name: string;
  team: TeamId;
  k: number; // kills
  d: number; // deaths
  bot?: 1;
}

export interface WelcomeMsg {
  t: 'welcome';
  id: number;
  map: string;
  tick: number;
}

export interface RosterMsg {
  t: 'roster';
  players: RosterEntry[];
}

export interface ChatBroadcastMsg {
  t: 'chat';
  from: string;
  team: TeamId | null; // null = server/system message
  text: string;
}

export interface PongMsg {
  t: 'pong';
  t0: number;
}

export type ServerMsg = WelcomeMsg | RosterMsg | SnapshotMsg | ChatBroadcastMsg | PongMsg;

export const encode = (msg: ClientMsg | ServerMsg): string => JSON.stringify(msg);
export const decode = <T>(raw: string): T => JSON.parse(raw) as T;

// ── Untrusted client input ───────────────────────────────────────────────────

export const MAX_NAME_LEN = 64;
export const MAX_CHAT_LEN = 1000;
export const MAX_ITEM_LEN = 32;
const BTN_MASK = Object.values(BTN).reduce((a, b) => a | b, 0);
const DIFFICULTIES = ['easy', 'normal', 'hard'];

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isStr = (v: unknown, max: number): v is string => typeof v === 'string' && v.length <= max;
const isTeam = (v: unknown): v is TeamId => v === 'T' || v === 'CT';

/**
 * Check a decoded value against the `ClientMsg` shape. Returns a copy holding
 * only the known fields, or null when the type or range of any field is wrong.
 */
export function validateClientMsg(v: unknown): ClientMsg | null {
  if (!isObj(v)) return null;
  switch (v.t) {
    case 'join':
      if (!isStr(v.name, MAX_NAME_LEN) || (v.team !== undefined && !isTeam(v.team))) return null;
      return v.team === undefined ? { t: 'join', name: v.name } : { t: 'join', name: v.name, team: v.team };
    case 'i': {
      if (!isNum(v.s) || !isNum(v.a)) return null;
      if (!Number.isInteger(v.b) || (v.b as number) < 0 || ((v.b as number) & ~BTN_MASK) !== 0) return null;
      const msg: InputMsg = { t: 'i', s: v.s, b: v.b as number, a: v.a };
      if (v.w !== undefined) {
        if (!Number.isInteger(v.w) || (v.w as number) < 1 || (v.w as number) > 4) return null;
        msg.w = v.w as number;
      }
      if (v.k !== undefined) {
        if (!isNum(v.k)) return null;
        msg.k = v.k;
      }
      return msg;
    }
    case 'buy':
      return isStr(v.item, MAX_ITEM_LEN) ? { t: 'buy', item: v.item } : null;
    case 'bots': {
      const msg: FillBotsMsg = { t: 'bots' };
      if (v.perTeam !== undefined) {
        if (!isNum(v.perTeam)) return null;
        msg.perTeam = v.perTeam;
      }
      if (v.difficulty !== undefined) {
        if (typeof v.difficulty !== 'string' || !DIFFICULTIES.includes(v.difficulty)) return null;
        msg.difficulty = v.difficulty as FillBotsMsg['difficulty'];
      }
      return msg;
    }
    case 'team':
      return isTeam(v.team) ? { t: 'team', team: v.team } : null;
    case 'chat':
      return isStr(v.text, MAX_CHAT_LEN) ? { t: 'chat', text: v.text } : null;
    case 'ping':
      return isNum(v.t0) ? { t: 'ping', t0: v.t0 } : null;
    default:
      return null;
  }
}

/** Parse and validate a raw client frame. Returns null for bad JSON or a bad shape. */
export function parseClientMsg(raw: string): ClientMsg | null {
  try {
    return validateClientMsg(JSON.parse(raw));
  } catch {
    return null;
  }
}
