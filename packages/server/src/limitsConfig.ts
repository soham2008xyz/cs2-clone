import { DEFAULT_MAX_ROOMS } from './roomManager.js';
import { envInt } from './serverUtils.js';

export interface LimitsConfig {
  maxRooms: number;
  createBurst: number; // rooms one IP can create back to back
  createPerMin: number; // sustained rooms per minute per IP
  trustedProxyHops: number;
}

/**
 * Reads the room and rate caps from env. Render terminates TLS at its proxy,
 * which appends the peer address to x-forwarded-for; elsewhere the header is
 * forgeable, so no hops are trusted unless configured.
 */
export function loadLimitsConfig(env: Record<string, string | undefined>): LimitsConfig {
  return {
    maxRooms: envInt(env, 'CS2D_MAX_ROOMS', DEFAULT_MAX_ROOMS),
    createBurst: envInt(env, 'CS2D_CREATE_BURST', 10),
    createPerMin: envInt(env, 'CS2D_CREATE_PER_MIN', 6),
    trustedProxyHops: envInt(env, 'CS2D_TRUSTED_PROXY_HOPS', env.RENDER ? 1 : 0),
  };
}
