// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_GA_MEASUREMENT_ID,
  OPT_OUT_KEY,
  initAnalytics,
  resetAnalytics,
  resolveMeasurementId,
  track,
  trackMatchEnd,
  trackMatchLeave,
  trackMatchStart,
  trackingAllowed,
} from '../src/analytics.js';

type GaWindow = Window & { dataLayer?: IArguments[]; gtag?: unknown; doNotTrack?: string };

function fakeWindow(nav: Record<string, unknown> = {}, stored: string | null = null): GaWindow {
  return {
    navigator: nav,
    document,
    localStorage: { getItem: (k: string) => (k === OPT_OUT_KEY ? stored : null) },
  } as unknown as GaWindow;
}

const events = (w: GaWindow) =>
  (w.dataLayer ?? []).map((a) => Array.from(a)).filter((a) => a[0] === 'event').map((a) => [a[1], a[2]]);

beforeEach(() => {
  resetAnalytics();
  document.head.innerHTML = '';
});
afterEach(() => vi.restoreAllMocks());

describe('resolveMeasurementId', () => {
  it('uses the default only in production builds when unset or empty', () => {
    expect(resolveMeasurementId(undefined, true)).toBe(DEFAULT_GA_MEASUREMENT_ID);
    expect(resolveMeasurementId('', true)).toBe(DEFAULT_GA_MEASUREMENT_ID);
    expect(resolveMeasurementId(undefined, false)).toBeNull();
    expect(resolveMeasurementId(' ', false)).toBeNull();
  });

  it('honours an explicit ID in any mode, and "off" everywhere', () => {
    expect(resolveMeasurementId('G-ABC1234', false)).toBe('G-ABC1234');
    expect(resolveMeasurementId('off', true)).toBeNull();
    expect(resolveMeasurementId('OFF', false)).toBeNull();
  });

  it('rejects values that are not GA4 IDs', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(resolveMeasurementId('UA-1234-1', true)).toBeNull();
    expect(resolveMeasurementId('G-"><script>', true)).toBeNull();
    expect(warn).toHaveBeenCalledTimes(2);
  });
});

describe('trackingAllowed', () => {
  it('respects Do Not Track, Global Privacy Control and the local opt-out', () => {
    expect(trackingAllowed(fakeWindow())).toBe(true);
    expect(trackingAllowed(fakeWindow({ doNotTrack: '1' }))).toBe(false);
    expect(trackingAllowed(fakeWindow({ globalPrivacyControl: true }))).toBe(false);
    expect(trackingAllowed(fakeWindow({}, 'off'))).toBe(false);
  });

  it('still works when storage throws', () => {
    const w = fakeWindow();
    (w as unknown as { localStorage: unknown }).localStorage = {
      getItem: () => {
        throw new Error('blocked');
      },
    };
    expect(trackingAllowed(w)).toBe(true);
  });
});

describe('initAnalytics', () => {
  it('is a no-op without an ID or when tracking is refused', () => {
    expect(initAnalytics(null, fakeWindow())).toBe(false);
    const dnt = fakeWindow({ doNotTrack: '1' });
    expect(initAnalytics('G-ABC1234', dnt)).toBe(false);
    expect(dnt.dataLayer).toBeUndefined();
    expect(document.head.querySelector('script')).toBeNull();
    track('anything'); // must not throw while off
  });

  it('loads gtag.js once and configures the property', () => {
    const w = fakeWindow();
    expect(initAnalytics('G-ABC1234', w)).toBe(true);
    expect(initAnalytics('G-ABC1234', w)).toBe(false);
    const scripts = document.head.querySelectorAll('script');
    expect(scripts).toHaveLength(1);
    expect(scripts[0]!.src).toBe('https://www.googletagmanager.com/gtag/js?id=G-ABC1234');
    const calls = w.dataLayer!.map((a) => Array.from(a));
    expect(calls[0]![0]).toBe('js');
    expect(calls[1]!.slice(0, 2)).toEqual(['config', 'G-ABC1234']);
  });
});

describe('match events', () => {
  it('reports start, end with result and duration, and no leave after an end', () => {
    const w = fakeWindow();
    initAnalytics('G-ABC1234', w);
    trackMatchStart('quick_match', 'dust2', 'bots', 1_000);
    trackMatchEnd('win', 'dust2', 91_400);
    trackMatchLeave('quit', 95_000);
    expect(events(w)).toEqual([
      ['match_start', { method: 'quick_match', map: 'dust2', mode: 'bots' }],
      ['match_end', { result: 'win', map: 'dust2', duration_sec: 90 }],
    ]);
  });

  it('reports a leave when the player returns to the menu mid-match', () => {
    const w = fakeWindow();
    initAnalytics('G-ABC1234', w);
    trackMatchLeave('quit', 0); // no match yet: ignored
    trackMatchStart('join_code', 'mirage', 'online', 0);
    trackMatchLeave('error', 30_000);
    expect(events(w)).toEqual([
      ['match_start', { method: 'join_code', map: 'mirage', mode: 'online' }],
      ['match_leave', { reason: 'error', duration_sec: 30 }],
    ]);
  });
});
