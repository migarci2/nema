/**
 * nema app origins.
 *
 * The object below is an inlined copy of `shared/origins.json`. JSON import
 * attributes are not supported everywhere we run this file (browsers, Node and
 * Workers), so the values live here and `origins.json` stays as the documented
 * copy. IMPORTANT: both files must always match. If you change one, change the
 * other in the same commit.
 */

export const ORIGINS_BY_ENV = {
  prod: {
    site: 'https://nema.migarci2.dev',
    vault: 'https://nema-vault.migarci2.dev',
    harness: 'https://saucier.migarci2.dev',
    security: 'https://linecook.migarci2.dev',
    coach: 'https://nema-coach.migarci2.dev'
  },
  dev: {
    site: 'http://localhost:8780',
    vault: 'http://localhost:8781',
    harness: 'http://localhost:8782',
    security: 'http://localhost:8783',
    coach: 'http://localhost:8784'
  }
};

/** Fixed dev ports, mirrored in scripts/dev.sh and docs/CONTRACT.md section 1. */
export const DEV_PORTS = {
  site: 8780,
  vault: 8781,
  harness: 8782,
  security: 8783,
  coach: 8784
};

const hostname =
  typeof location !== 'undefined' && location && typeof location.hostname === 'string'
    ? location.hostname
    : '';

/** True when the page is served from a local dev server. */
export const isDev = hostname === 'localhost' || hostname === '127.0.0.1';

/** Origins resolved for the current host. Outside a browser this is prod. */
export const ORIGINS = isDev ? ORIGINS_BY_ENV.dev : ORIGINS_BY_ENV.prod;

/** The app name for the current origin, or null when we are not on a nema origin. */
export const APP =
  typeof location !== 'undefined' && location
    ? Object.entries(ORIGINS).find(([, origin]) => origin === location.origin)?.[0] ?? null
    : null;

/** Look up an app origin by name for a given environment. */
export function originFor(app, env = isDev ? 'dev' : 'prod') {
  return ORIGINS_BY_ENV[env]?.[app] ?? null;
}
