import { describe, expect, it } from 'vitest';
import { decideBotBuys } from '../../src/bots/buy.js';

describe('decideBotBuys', () => {
  it('a rich T buys a rifle, armor, and T-exclusive utility (never a kit)', () => {
    const wishlist = decideBotBuys(5000, 'T', false);
    expect(wishlist[0]).toBe('ak47');
    expect(wishlist).toEqual(expect.arrayContaining(['kevlar', 'helmet', 'smoke', 'flash', 'molotov', 'he']));
    expect(wishlist).not.toContain('kit');
    expect(wishlist).not.toContain('incendiary');
  });

  it('a rich CT without a kit buys a rifle, a kit, and CT-exclusive utility', () => {
    const wishlist = decideBotBuys(5000, 'CT', false);
    expect(wishlist[0]).toBe('m4a4');
    expect(wishlist).toContain('kit');
    expect(wishlist).toContain('incendiary');
    expect(wishlist).not.toContain('molotov');
  });

  it('a CT who already owns a kit does not rebuy one', () => {
    const wishlist = decideBotBuys(5000, 'CT', true);
    expect(wishlist).not.toContain('kit');
  });

  it('falls back to an smg when a rifle is unaffordable', () => {
    const wishlist = decideBotBuys(1500, 'T', false); // mac10 (1050) affordable, ak47 (2700) is not
    expect(wishlist[0]).toBe('mac10');
  });

  it('falls back to a deagle when neither rifle nor smg is affordable', () => {
    const wishlist = decideBotBuys(700, 'T', false); // below mac10 (1050), exactly deagle's price
    expect(wishlist[0]).toBe('deagle');
  });

  it('buys no weapon at all when too poor even for a deagle', () => {
    const wishlist = decideBotBuys(100, 'T', false);
    expect(wishlist[0]).toBe('kevlar'); // first item is armor, not a weapon id
  });
});
