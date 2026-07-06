// ── Simulation ────────────────────────────────────────────────────────────────
export const TICK_RATE = 60;
export const TICK_MS = 1000 / TICK_RATE;
export const TICK_DT = 1 / TICK_RATE;
export const SNAPSHOT_RATE = 30;
export const INTERP_DELAY_MS = 100;

export const TILE_SIZE = 32;
export const PLAYER_RADIUS = 12;
export const RUN_SPEED = 175; // px/s with knife; weapons apply a mobility multiplier
export const WALK_SPEED_MULT = 0.52;

export const MAX_HP = 100;
export const MAX_ARMOR = 100;

// ── Round timings (seconds, CS2 competitive) ─────────────────────────────────
export const FREEZE_TIME = 15;
export const ROUND_TIME = 115; // 1:55
export const BOMB_TIME = 40;
export const PLANT_TIME = 3.2;
export const DEFUSE_TIME = 10;
export const DEFUSE_TIME_KIT = 5;
export const ROUND_END_TIME = 7;
export const BUY_WINDOW = 20; // seconds of buy time after freeze ends

// ── Match structure (MR12 + MR3 overtime) ────────────────────────────────────
export const ROUNDS_PER_HALF = 12;
export const ROUNDS_TO_WIN = 13;
export const OT_ROUNDS_PER_HALF = 3;
export const OT_ROUNDS_TO_WIN = 4; // round wins within one overtime to take the match

// ── Economy (CS2) ─────────────────────────────────────────────────────────────
export const START_MONEY = 800;
export const OT_MONEY = 10000;
export const MAX_MONEY = 16000;

export const REWARD_WIN_ELIMINATION = 3250;
export const REWARD_WIN_TIME = 3250;
export const REWARD_WIN_DEFUSE = 3500;
export const REWARD_WIN_EXPLODE = 3500;
/** Consecutive-loss bonus ladder; the counter decrements (not resets) on a win. */
export const LOSS_BONUS = [1400, 1900, 2400, 2900, 3400] as const;
/** Extra paid to every T if they lose a round in which the bomb was planted. */
export const PLANT_LOSS_BONUS = 800;
/** Personal reward for the player who plants the bomb. */
export const PLANT_REWARD = 300;

// ── Equipment prices ──────────────────────────────────────────────────────────
export const PRICE_KEVLAR = 650;
export const PRICE_HELMET = 350;
export const PRICE_DEFUSE_KIT = 400;

// ── Grenades ──────────────────────────────────────────────────────────────────
export const GRENADE_MAX_TOTAL = 4;
export const GRENADE_RADIUS = 6; // physical size for wall-bounce collision
export const SMOKE_FUSE = 2.0;
export const SMOKE_DURATION = 18;
export const SMOKE_RADIUS = 90;
export const SMOKE_BLOOM_TIME = 1.0; // seconds to grow from 0 to full radius
export const FLASH_FUSE = 1.6;
export const FLASH_MAX_BLIND = 2.8; // seconds fully blind at worst case
export const FLASH_RANGE = 500;
export const HE_FUSE = 1.6;
export const HE_MAX_DAMAGE = 98;
export const HE_RADIUS = 130;
export const HE_ARMOR_PEN = 0.6;
export const MOLOTOV_FUSE = 1.6;
export const MOLOTOV_DURATION = 7;
export const MOLOTOV_RADIUS = 70;
export const MOLOTOV_DPS = 40;
export const GRENADE_THROW_SPEED = 500;
export const GRENADE_FRICTION = 0.55; // velocity kept per bounce
export const GRENADE_DRAG = 1.4; // per-second exponential drag
export const MAX_FLASH_CARRY = 2;

// ── Misc ──────────────────────────────────────────────────────────────────────
export const FRIENDLY_FIRE = false;
export const BUYZONE_RADIUS_TILES = 7; // buy allowed within N tiles of own spawn
export const PICKUP_RADIUS = 28;
export const BOMB_PLANT_SITE_ONLY = true;
