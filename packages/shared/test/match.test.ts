import { describe, expect, it } from 'vitest';
import {
  isOvertimeHalfStart,
  isPistolRound,
  isSideSwap,
  matchTarget,
  matchWinner,
  overtimeIndex,
} from '../src/sim/match.js';
import { lossBonus, roundPayout } from '../src/sim/economy.js';

describe('MR12 structure', () => {
  it('pistol rounds are 1 and 13', () => {
    expect(isPistolRound(1)).toBe(true);
    expect(isPistolRound(13)).toBe(true);
    expect(isPistolRound(2)).toBe(false);
    expect(isPistolRound(25)).toBe(false); // OT start is not a pistol round
  });

  it('side swap at halftime only during regulation', () => {
    expect(isSideSwap(13)).toBe(true);
    for (const r of [2, 12, 14, 24, 25]) expect(isSideSwap(r), `round ${r}`).toBe(false);
  });

  it('13 rounds win regulation', () => {
    expect(matchWinner({ T: 13, CT: 5 })).toBe('T');
    expect(matchWinner({ T: 12, CT: 12 })).toBeNull();
    expect(matchWinner({ T: 11, CT: 13 })).toBe('CT');
  });
});

describe('overtime (MR3)', () => {
  it('rounds 25-30 are OT1, 31-36 are OT2', () => {
    expect(overtimeIndex(24)).toBe(0);
    expect(overtimeIndex(25)).toBe(1);
    expect(overtimeIndex(30)).toBe(1);
    expect(overtimeIndex(31)).toBe(2);
  });

  it('OT side swaps before rounds 28, 31, 34', () => {
    expect(isSideSwap(28)).toBe(true);
    expect(isSideSwap(31)).toBe(true);
    expect(isSideSwap(34)).toBe(true);
    for (const r of [25, 26, 27, 29, 30, 32]) expect(isSideSwap(r), `round ${r}`).toBe(false);
  });

  it('OT money resets at each OT half start (25, 28, 31…)', () => {
    expect(isOvertimeHalfStart(25)).toBe(true);
    expect(isOvertimeHalfStart(28)).toBe(true);
    expect(isOvertimeHalfStart(31)).toBe(true);
    expect(isOvertimeHalfStart(26)).toBe(false);
    expect(isOvertimeHalfStart(13)).toBe(false);
  });

  it('16 wins OT1; at 15-15 the target moves to 19', () => {
    expect(matchTarget(1)).toBe(16);
    expect(matchWinner({ T: 16, CT: 14 })).toBe('T');
    expect(matchWinner({ T: 15, CT: 15 })).toBeNull();
    expect(matchWinner({ T: 16, CT: 15 })).toBeNull(); // OT2 needs 19
    expect(matchWinner({ T: 19, CT: 17 })).toBe('T');
  });
});

describe('economy', () => {
  it('loss bonus ladder', () => {
    expect(lossBonus(1)).toBe(1400);
    expect(lossBonus(3)).toBe(2400);
    expect(lossBonus(5)).toBe(3400);
    expect(lossBonus(9)).toBe(3400); // capped
  });

  it('winner streak decrements instead of resetting (CS2)', () => {
    // CT has lost 4 in a row, then wins one, then loses again
    let streaks = { T: 0, CT: 4 };
    const win = roundPayout('bomb_defused', streaks, false);
    expect(win.winner).toBe('CT');
    expect(win.winnerMoney).toBe(3500);
    expect(win.streaks.CT).toBe(3); // decremented, not reset
    expect(win.streaks.T).toBe(1);

    const lose = roundPayout('elimination_t', win.streaks, false);
    // CT streak resumes at 4 → $2900
    expect(lose.streaks.CT).toBe(4);
    expect(lose.loserMoney).toBe(2900);
  });

  it('planted-but-lost Ts get the plant bonus on top of loss bonus', () => {
    const r = roundPayout('bomb_defused', { T: 0, CT: 0 }, true);
    expect(r.winner).toBe('CT');
    expect(r.loserMoney).toBe(1400 + 800);
  });

  it('bomb explosion pays $3500 to T', () => {
    const r = roundPayout('bomb_exploded', { T: 0, CT: 0 }, true);
    expect(r.winner).toBe('T');
    expect(r.winnerMoney).toBe(3500);
  });
});
