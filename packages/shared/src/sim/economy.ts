import {
  LOSS_BONUS,
  MAX_MONEY,
  PLANT_LOSS_BONUS,
  REWARD_WIN_DEFUSE,
  REWARD_WIN_ELIMINATION,
  REWARD_WIN_EXPLODE,
  REWARD_WIN_TIME,
} from '../constants.js';
import type { TeamId } from '../map/types.js';

export type RoundEndReason = 'elimination_t' | 'elimination_ct' | 'bomb_exploded' | 'bomb_defused' | 'time';

export const winnerOf = (reason: RoundEndReason): TeamId =>
  reason === 'elimination_t' || reason === 'bomb_exploded' ? 'T' : 'CT';

export const winReward = (reason: RoundEndReason): number => {
  switch (reason) {
    case 'bomb_exploded':
      return REWARD_WIN_EXPLODE;
    case 'bomb_defused':
      return REWARD_WIN_DEFUSE;
    case 'time':
      return REWARD_WIN_TIME;
    default:
      return REWARD_WIN_ELIMINATION;
  }
};

/** CS2 loss bonus for a team currently on `streak` consecutive losses (1-based). */
export const lossBonus = (streak: number): number =>
  LOSS_BONUS[Math.max(0, Math.min(LOSS_BONUS.length - 1, streak - 1))];

export const clampMoney = (m: number): number => Math.max(0, Math.min(MAX_MONEY, m));

export interface LossStreaks {
  T: number;
  CT: number;
}

/**
 * End-of-round payouts. Returns per-team money deltas and updated streaks.
 * CS2 behavior: the winner's streak counter decrements rather than resetting.
 */
export function roundPayout(
  reason: RoundEndReason,
  streaks: LossStreaks,
  bombWasPlanted: boolean,
): { winner: TeamId; winnerMoney: number; loserMoney: number; streaks: LossStreaks } {
  const winner = winnerOf(reason);
  const loser: TeamId = winner === 'T' ? 'CT' : 'T';
  const newStreaks: LossStreaks = { ...streaks };
  newStreaks[loser] = streaks[loser] + 1;
  newStreaks[winner] = Math.max(0, streaks[winner] - 1);

  let loserMoney = lossBonus(newStreaks[loser]);
  if (loser === 'T' && bombWasPlanted) loserMoney += PLANT_LOSS_BONUS;

  return { winner, winnerMoney: winReward(reason), loserMoney, streaks: newStreaks };
}
