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

export type ClientMsg = JoinMsg | InputMsg | BuyMsg | FillBotsMsg;

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

export type ServerMsg = WelcomeMsg | RosterMsg | SnapshotMsg;

export const encode = (msg: ClientMsg | ServerMsg): string => JSON.stringify(msg);
export const decode = <T>(raw: string): T => JSON.parse(raw) as T;
