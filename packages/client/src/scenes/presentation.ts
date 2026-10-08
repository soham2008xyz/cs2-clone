import { getGrenade, type SelfState, type TeamId } from '@cs2d/shared';

/** Health readout, with armor (and a + for helmet) when worn; blank while dead. */
export function hpLabel(hp: number, alive: boolean, me: SelfState | null): string {
  if (!alive) return '';
  let armor = '';
  if (me && me.armor > 0) {
    const helmet = me.helm ? '+' : '';
    armor = `  ⛨ ${me.armor}${helmet}`;
  }
  return `♥ ${Math.max(0, hp)}${armor}`;
}

/** Ammo line and weapon name for the held item: grenade, knife, reloading gun, or gun. */
export function weaponLines(me: SelfState): { ammo: string; weapon: string } {
  if (me.slot === 4 && me.nades?.length) return { ammo: 'THROW', weapon: getGrenade(me.nades[0]).name.toUpperCase() };
  if (me.weapon === 'knife') return { ammo: '—', weapon: me.weapon.toUpperCase() };
  const weapon = me.weapon.toUpperCase() + (me.kit ? '  +KIT' : '');
  if (me.reload > 0) return { ammo: 'RELOADING', weapon };
  return { ammo: `${me.ammo} / ${me.reserve}`, weapon };
}

export function killfeedColor(k: { meKiller: boolean; meVictim: boolean }): string {
  if (k.meKiller) return '#ffd76b';
  if (k.meVictim) return '#ff6b6b';
  return '#dddddd';
}

/** Chat line color for a sender's team (grey for spectators / system). */
export function teamChatColor(team: TeamId | null | undefined): string {
  if (team === 'T') return '#ffd280';
  if (team === 'CT') return '#9cc4ff';
  return '#aaaaaa';
}

/** In-flight grenade dot color by kind (molotov / incendiary share the fallback). */
const NADE_COLORS: Partial<Record<string, number>> = { flash: 0xdddddd, smoke: 0x999999, he: 0x556b2f };
const FIRE_NADE_COLOR = 0x8b3a1a;

export function nadeColor(kind: string): number {
  return NADE_COLORS[kind] ?? FIRE_NADE_COLOR;
}
