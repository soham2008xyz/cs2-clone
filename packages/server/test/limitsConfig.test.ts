import { describe, expect, it } from 'vitest';
import { loadLimitsConfig } from '../src/limitsConfig.js';

describe('loadLimitsConfig', () => {
  it('uses defaults and trusts no proxy outside Render', () => {
    expect(loadLimitsConfig({})).toEqual({ maxRooms: 50, createBurst: 10, createPerMin: 6, trustedProxyHops: 0 });
  });

  it('trusts one proxy hop on Render', () => {
    expect(loadLimitsConfig({ RENDER: 'true' }).trustedProxyHops).toBe(1);
  });

  it('lets env vars override every value, and ignores bad ones', () => {
    expect(
      loadLimitsConfig({ CS2D_MAX_ROOMS: '7', CS2D_CREATE_BURST: '2', CS2D_CREATE_PER_MIN: '3', CS2D_TRUSTED_PROXY_HOPS: '2', RENDER: 'true' }),
    ).toEqual({ maxRooms: 7, createBurst: 2, createPerMin: 3, trustedProxyHops: 2 });
    expect(loadLimitsConfig({ CS2D_MAX_ROOMS: 'lots' }).maxRooms).toBe(50);
  });
});
