/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** GA4 measurement ID; '' uses the default in production builds, 'off' disables analytics. */
  readonly VITE_GA_MEASUREMENT_ID?: string;
}
