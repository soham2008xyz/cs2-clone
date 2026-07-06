import { getWeapon, type TeamId } from '@cs2d/shared';

const PRIMARY: Record<TeamId, string> = { T: 'ak47', CT: 'm4a4' };
const SMG: Record<TeamId, string> = { T: 'mac10', CT: 'mp9' };

/**
 * A reasonable human-like buy order. The room validates money/team/ownership
 * on every purchase, so this is just a wishlist — items the bot can't afford
 * or isn't allowed are silently skipped by Room.handleBuy.
 */
export function decideBotBuys(money: number, team: TeamId, hasKit: boolean): string[] {
  const wishlist: string[] = [];
  const primary = getWeapon(PRIMARY[team]);
  const smg = getWeapon(SMG[team]);

  if (money >= primary.price) wishlist.push(primary.id);
  else if (money >= smg.price) wishlist.push(smg.id);
  else if (money >= 700) wishlist.push('deagle');

  wishlist.push('kevlar', 'helmet'); // helmet requires armor, so it must follow kevlar
  if (team === 'CT' && !hasKit) wishlist.push('kit');
  wishlist.push('smoke', 'flash');
  wishlist.push(team === 'T' ? 'molotov' : 'incendiary');
  wishlist.push('he');
  return wishlist;
}
