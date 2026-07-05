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

export type ClientMsg = JoinMsg | InputMsg | BuyMsg;

// ── Server → client ──────────────────────────────────────────────────────────

/** Per-player snapshot tuple: [id, x, y, aim, hp, flags] */
export type PlayerSnap = [number, number, number, number, number, number];

export const PFLAG = {
  ALIVE: 1,
  WALKING: 2, // reserved for footstep audio
  PLANTING: 4,
  DEFUSING: 8,
  HAS_BOMB: 16,
} as const;

export interface SnapshotMsg {
  t: 's';
  k: number; // server tick
  a: number; // last processed input seq for the receiving client
  p: PlayerSnap[];
}

export interface RosterEntry {
  id: number;
  name: string;
  team: TeamId;
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
