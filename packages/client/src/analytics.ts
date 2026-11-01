// Google Analytics 4 (gtag.js), loaded only in production builds or when an ID is set explicitly.
//
//   VITE_GA_MEASUREMENT_ID unset or ''  → DEFAULT_GA_MEASUREMENT_ID in `vite build`, off in dev/test
//   VITE_GA_MEASUREMENT_ID=G-XXXXXXX    → that property (also in dev, for the GA DebugView)
//   VITE_GA_MEASUREMENT_ID=off          → never load GA
//
// Players opt out with Do Not Track, Global Privacy Control, or
// localStorage['cs2d:analytics'] = 'off'. Events never carry player names, chat or room codes.

export const DEFAULT_GA_MEASUREMENT_ID = 'G-78Z8QWX50W';
export const OPT_OUT_KEY = 'cs2d:analytics';
const ID_PATTERN = /^G-[A-Z0-9]{4,20}$/;

type Gtag = (...args: unknown[]) => void;
type GaWindow = Window & { dataLayer?: unknown[]; gtag?: Gtag };

export type MatchStartMethod = 'quick_match' | 'create_room' | 'join_code' | 'join_list';

let gtag: Gtag | null = null;
let matchStartedAt: number | null = null;

/** Picks the measurement ID from the build env; null means analytics stays off. */
export function resolveMeasurementId(raw: string | undefined, prod: boolean): string | null {
  const value = (raw ?? '').trim();
  if (value.toLowerCase() === 'off') return null;
  if (value === '') return prod ? DEFAULT_GA_MEASUREMENT_ID : null;
  if (!ID_PATTERN.test(value)) {
    console.warn(`analytics disabled: VITE_GA_MEASUREMENT_ID is not a GA4 ID: ${JSON.stringify(value)}`);
    return null;
  }
  return value;
}

/** False when the player asked not to be tracked (DNT, GPC or the local opt-out flag). */
export function trackingAllowed(win: Window = window): boolean {
  const nav = win.navigator as Navigator & { globalPrivacyControl?: boolean; msDoNotTrack?: string };
  const dnt = nav.doNotTrack ?? (win as Window & { doNotTrack?: string }).doNotTrack ?? nav.msDoNotTrack;
  if (dnt === '1' || dnt === 'yes' || nav.globalPrivacyControl === true) return false;
  try {
    if (win.localStorage.getItem(OPT_OUT_KEY) === 'off') return false;
  } catch {
    // storage blocked: fall through, DNT/GPC already checked
  }
  return true;
}

/** Injects gtag.js and sends the initial page_view. Returns whether GA was started. */
export function initAnalytics(id: string | null, win: Window = window): boolean {
  if (gtag || !id || !trackingAllowed(win)) return false;
  const w = win as GaWindow;
  const doc = win.document;
  w.dataLayer = w.dataLayer ?? [];
  // gtag.js expects the real `arguments` object in dataLayer, not an array
  w.gtag = function gtagShim() {
    w.dataLayer!.push(arguments);
  };
  gtag = w.gtag;
  gtag('js', new Date());
  gtag('config', id, { allow_google_signals: false, allow_ad_personalization_signals: false });

  const script = doc.createElement('script');
  script.async = true;
  script.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(id)}`;
  doc.head.appendChild(script);
  return true;
}

/** Sends a GA event; a no-op while analytics is off. */
export function track(event: string, params: Record<string, string | number | boolean> = {}): void {
  gtag?.('event', event, params);
}

export function trackMatchStart(method: MatchStartMethod, map: string, mode: 'bots' | 'online', now = Date.now()): void {
  matchStartedAt = now;
  track('match_start', { method, map, mode });
}

/** The match reached match_end; result is from the local player's side. */
export function trackMatchEnd(result: 'win' | 'loss', map: string, now = Date.now()): void {
  track('match_end', { result, map, duration_sec: elapsedSec(now) });
  matchStartedAt = null;
}

/** Back at the menu without a match_end (quit, kicked, connection lost). */
export function trackMatchLeave(reason: 'error' | 'quit', now = Date.now()): void {
  if (matchStartedAt === null) return;
  track('match_leave', { reason, duration_sec: elapsedSec(now) });
  matchStartedAt = null;
}

function elapsedSec(now: number): number {
  return matchStartedAt === null ? 0 : Math.max(0, Math.round((now - matchStartedAt) / 1000));
}

/** Test hook: forget the gtag function and match timer. */
export function resetAnalytics(): void {
  gtag = null;
  matchStartedAt = null;
}
