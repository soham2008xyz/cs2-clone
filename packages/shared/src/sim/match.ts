import { OT_ROUNDS_PER_HALF, ROUNDS_PER_HALF, ROUNDS_TO_WIN } from '../constants.js';
import type { TeamId } from '../map/types.js';

/**
 * Pure MR12 + MR3-overtime match arithmetic. Scores are tracked against the
 * *current* side labels; callers swap both scores and player teams at side
 * swaps (that is what `swapSides` signals).
 */

export interface MatchScore {
  T: number;
  CT: number;
}

export const totalRounds = (s: MatchScore): number => s.T + s.CT;

/** Which overtime a given upcoming round belongs to (0 = regulation). */
export function overtimeIndex(roundNumber: number): number {
  if (roundNumber <= 2 * ROUNDS_PER_HALF) return 0;
  return Math.floor((roundNumber - 2 * ROUNDS_PER_HALF - 1) / (2 * OT_ROUNDS_PER_HALF)) + 1;
}

/** Score a team must reach to win, given how many overtimes have started. */
export function matchTarget(otIndex: number): number {
  return ROUNDS_TO_WIN + otIndex * OT_ROUNDS_PER_HALF;
}

/**
 * Did `score` just win the match?
 * A final score is always exactly 13+3k (k = overtimes played) with the loser
 * at least 2 behind — 16-15 continues to the next OT, 16-14 is final.
 */
export function matchWinner(s: MatchScore): TeamId | null {
  const hi = Math.max(s.T, s.CT);
  const lo = Math.min(s.T, s.CT);
  if (hi < ROUNDS_TO_WIN) return null;
  if ((hi - ROUNDS_TO_WIN) % OT_ROUNDS_PER_HALF !== 0) return null;
  if (lo > hi - 2) return null;
  return s.T === hi ? 'T' : 'CT';
}

/** Do teams swap sides before the given upcoming round? */
export function isSideSwap(upcomingRound: number): boolean {
  if (upcomingRound === ROUNDS_PER_HALF + 1) return true; // regulation halftime
  if (upcomingRound <= 2 * ROUNDS_PER_HALF) return false;
  // OT: swap before each OT half except the very first (rounds 28, 31, 34, …)
  const intoOt = upcomingRound - 2 * ROUNDS_PER_HALF; // 1-based round within all OT play
  return (intoOt - 1) % OT_ROUNDS_PER_HALF === 0 && intoOt !== 1;
}

/** Does the given upcoming round start a fresh overtime (money reset to OT money)? */
export function isOvertimeStart(upcomingRound: number): boolean {
  if (upcomingRound <= 2 * ROUNDS_PER_HALF) return false;
  const intoOt = upcomingRound - 2 * ROUNDS_PER_HALF;
  return (intoOt - 1) % (2 * OT_ROUNDS_PER_HALF) === 0;
}

/** Does the upcoming round start an OT half (fresh OT money in CS2)? */
export function isOvertimeHalfStart(upcomingRound: number): boolean {
  if (upcomingRound <= 2 * ROUNDS_PER_HALF) return false;
  const intoOt = upcomingRound - 2 * ROUNDS_PER_HALF;
  return (intoOt - 1) % OT_ROUNDS_PER_HALF === 0;
}

/** Is the upcoming round a pistol round (fresh $800 economy)? */
export function isPistolRound(upcomingRound: number): boolean {
  return upcomingRound === 1 || upcomingRound === ROUNDS_PER_HALF + 1;
}
