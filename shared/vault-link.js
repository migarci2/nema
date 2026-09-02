/**
 * nema vault link: a site talks to the vault by itself (contract section 25).
 *
 * No agent, no extension, only the browser. A site opens the vault's
 * `/connect.html` in a popup with a request in the hash, the learner approves
 * there, and the vault answers this page with `postMessage`. The popup is a top
 * level window, so the vault reads its own first party storage; a third party
 * iframe could not, because Chrome partitions it.
 *
 *   import { connectVault, sendReceiptToVault } from '/shared/vault-link.js';
 *   const result = await connectVault({ vault, request });   // { status, token }
 *   const kept   = await sendReceiptToVault({ vault, token }); // { status, changes }
 *
 * ---------------------------------------------------------------------------
 * Two rules this module lives by
 * ---------------------------------------------------------------------------
 *
 * 1. It resolves nothing against the page. Every URL it builds starts from the
 *    `vault` origin the caller passes, so the file works unchanged when the
 *    hub serves it to a blog on another origin. It has no imports at all.
 * 2. It only opens URLs and listens for messages. It never signs, never
 *    verifies, never reads storage. The vault decides; this side just asks.
 *
 * `window.open` has to run inside the user gesture, so `connectVault` and
 * `sendReceiptToVault` open the window synchronously before they await
 * anything. Call them straight from a click handler.
 *
 * The pure half (encoding, URLs, message parsing) runs in Node with no DOM,
 * which is what `test/vault-link.test.js` exercises.
 */

/** The vault a site talks to when it names none. */
export const DEFAULT_VAULT = 'https://nema-vault.migarci2.dev';

/** The vault page that answers a site. */
export const CONNECT_PATH = '/connect.html';

/** Message types, one per direction of the handshake. */
export const ASSERTION_MESSAGE = 'nema:assertion';
export const RECEIPT_MESSAGE = 'nema:receipt';

export const POPUP_WIDTH = 480;
export const POPUP_HEIGHT = 720;

/** How often the opener checks whether the learner closed the window. */
export const POPUP_POLL_MS = 500;

/** The one sentence a site shows when the browser refused to open the vault. */
export const POPUP_BLOCKED_MESSAGE =
  'Your browser blocked the vault window. Allow popups for this site or use the paste box below.';

/* ------------------------------------------------------------------ pure -- */

/** An origin with no trailing slash, which is what `event.origin` looks like. */
export function trimOrigin(value) {
  return String(value == null ? '' : value).trim().replace(/\/+$/, '');
}

/** True for a string that looks like a web origin and nothing else. */
export function isOrigin(value) {
  const text = trimOrigin(value);
  if (text === '') return false;
  try {
    const url = new URL(text);
    return (url.protocol === 'http:' || url.protocol === 'https:') && url.origin === text;
  } catch {
    return false;
  }
}

/** b64url of the UTF-8 bytes of a JSON object, the same encoding as a token. */
export function encodeRequest(request) {
  const bytes = new TextEncoder().encode(JSON.stringify(request));
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** The inverse. Throws on anything that is not b64url of a JSON object. */
export function decodeRequest(value) {
  const padded = String(value || '').replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(padded + '='.repeat((4 - (padded.length % 4)) % 4));
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  const parsed = JSON.parse(new TextDecoder().decode(bytes));
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('a nema request must be a JSON object');
  }
  return parsed;
}

/** `<vault>/connect.html#request=<b64url>&return=<origin>` */
export function connectUrl({ vault, request, returnOrigin }) {
  return (
    `${trimOrigin(vault || DEFAULT_VAULT)}${CONNECT_PATH}` +
    `#request=${encodeRequest(request)}&return=${encodeURIComponent(trimOrigin(returnOrigin))}`
  );
}

/** `<vault>/connect.html#receipt=<token>&return=<origin>` */
export function receiptUrl({ vault, token, returnOrigin }) {
  return (
    `${trimOrigin(vault || DEFAULT_VAULT)}${CONNECT_PATH}` +
    `#receipt=${encodeURIComponent(String(token || '').trim())}` +
    `&return=${encodeURIComponent(trimOrigin(returnOrigin))}`
  );
}

/**
 * Read one `message` event, or null when it is not the answer we are waiting
 * for. The origin check is the whole security of this side: a message from any
 * other window is not the vault, whatever it says about itself.
 */
export function readVaultMessage(event, { vault, type }) {
  if (!event || event.origin !== trimOrigin(vault)) return null;
  const data = event.data;
  if (!data || typeof data !== 'object' || data.type !== type) return null;
  return data;
}

/**
 * The failure this side can hit, as an Error carrying a `status`:
 * `blocked` (the browser refused the window), `closed` (the learner shut it
 * without answering) or `busy` (a request is already in flight).
 */
export function vaultLinkError(status, message) {
  const error = new Error(message);
  error.name = 'VaultLinkError';
  error.status = status;
  return error;
}

/** One line a site can show for any rejection from this module. */
export function describeFailure(error) {
  const status = error && error.status ? error.status : 'error';
  if (status === 'blocked') return { status, message: POPUP_BLOCKED_MESSAGE };
  if (status === 'closed') {
    return { status, message: 'The vault window closed before it answered. Nothing was shared.' };
  }
  if (status === 'busy') {
    return { status, message: 'The vault window is already open. Finish there first.' };
  }
  return { status, message: (error && error.message) || 'The vault could not be reached.' };
}

/* --------------------------------------------------------------- browser -- */

/* One pending call at a time: two popups asking the same vault two questions is
 * a race the learner would have to arbitrate, and the answer would be posted to
 * whichever listener happened to be first. */
let pending = null;

/** True while a vault window opened by this module is waiting for an answer. */
export function isPending() {
  return pending !== null;
}

function currentOrigin() {
  return typeof location !== 'undefined' && location ? location.origin : '';
}

function openVaultWindow(url) {
  const screenLeft = typeof window.screenX === 'number' ? window.screenX : 0;
  const screenTop = typeof window.screenY === 'number' ? window.screenY : 0;
  const width = window.outerWidth || POPUP_WIDTH;
  const height = window.outerHeight || POPUP_HEIGHT;
  const left = Math.max(0, Math.round(screenLeft + (width - POPUP_WIDTH) / 2));
  const top = Math.max(0, Math.round(screenTop + (height - POPUP_HEIGHT) / 3));
  return window.open(
    url,
    'nemaVault',
    `popup=yes,width=${POPUP_WIDTH},height=${POPUP_HEIGHT},left=${left},top=${top}`
  );
}

/**
 * Open the vault, wait for one answer. The window is opened synchronously so a
 * click handler can call this and keep its gesture.
 */
function askTheVault({ vault, url, type }) {
  const origin = trimOrigin(vault || DEFAULT_VAULT);
  return new Promise((resolve, reject) => {
    if (pending !== null) {
      reject(vaultLinkError('busy', 'A vault window is already open for this page.'));
      return;
    }

    const popup = openVaultWindow(url);
    if (!popup) {
      reject(vaultLinkError('blocked', POPUP_BLOCKED_MESSAGE));
      return;
    }

    let timer = null;
    /* Settled once, by this call: a local flag rather than the shared `pending`
     * so a late timer tick can never clear the next call's slot. */
    let settled = false;
    const settle = (finish, value) => {
      if (settled) return;
      settled = true;
      pending = null;
      window.removeEventListener('message', onMessage);
      clearInterval(timer);
      finish(value);
    };

    function onMessage(event) {
      const data = readVaultMessage(event, { vault: origin, type });
      /* The vault says "shared, you can close this window" for a moment and
       * closes itself, so the answer is taken and the window is left alone. */
      if (data) settle(resolve, data);
    }

    pending = { origin, type };
    window.addEventListener('message', onMessage);
    timer = setInterval(() => {
      if (popup.closed) {
        settle(reject, vaultLinkError('closed', 'The vault window was closed before it answered.'));
      }
    }, POPUP_POLL_MS);
  });
}

/**
 * Ask the learner's vault for a ReadinessAssertion addressed to this site.
 *
 * @param {{ vault?: string, request: object, returnOrigin?: string }} options
 *        `request` is a ReadinessRequest: `{ audience, purpose, requirements }`.
 *        `audience` must be this site's origin, which is what the vault checks.
 * @returns {Promise<{ type: string, status: 'approved'|'denied'|string, token?: string }>}
 *          Rejects with an Error carrying `status` `blocked`, `closed` or `busy`.
 */
export function connectVault({ vault, request, returnOrigin = currentOrigin() } = {}) {
  const origin = trimOrigin(vault || DEFAULT_VAULT);
  return askTheVault({
    vault: origin,
    type: ASSERTION_MESSAGE,
    url: connectUrl({ vault: origin, request, returnOrigin })
  });
}

/**
 * Hand the learner's vault a signed receipt and hear what it did with it.
 *
 * @param {{ vault?: string, token: string, returnOrigin?: string }} options
 * @returns {Promise<{ type: string, status: string, receiptId?: string, trust?: string, changes?: Array, reason?: string }>}
 *          Rejects the same way `connectVault` does.
 */
export function sendReceiptToVault({ vault, token, returnOrigin = currentOrigin() } = {}) {
  const origin = trimOrigin(vault || DEFAULT_VAULT);
  return askTheVault({
    vault: origin,
    type: RECEIPT_MESSAGE,
    url: receiptUrl({ vault: origin, token, returnOrigin })
  });
}

/* The ladder, for reading a list of changes out loud and nothing else. A claim
 * about `apply` also lifts every rung under it, so a receipt that moved four
 * rungs of one concept is four changes and one piece of news. */
const ABILITY_ORDER = ['recognize', 'retrieve', 'explain', 'apply', 'transfer'];
const BAND_ORDER = ['unknown', 'uncertain', 'fragile', 'usable', 'durable'];

/* `discriminate` is off the ladder, so it never outranks a ladder rung and is
 * reported when it is the only thing that moved on that concept. */
function reach(change) {
  const ability = ABILITY_ORDER.indexOf(change.ability);
  const band = BAND_ORDER.indexOf(change.to);
  return (ability < 0 ? -1 : ability) * 10 + (band < 0 ? 0 : band);
}

/**
 * The bands a staged receipt moved, in words: "ratios, now usable".
 *
 * One phrase per concept, naming the furthest ability that moved, because that
 * is the news. Shared by the two courses and the embed so all three say the
 * same sentence about the same answer.
 */
export function describeChanges(changes, shortName = defaultShortName) {
  const best = new Map();
  for (const change of Array.isArray(changes) ? changes : []) {
    if (!change || typeof change.concept !== 'string') continue;
    const standing = best.get(change.concept);
    if (!standing || reach(change) > reach(standing)) best.set(change.concept, change);
  }
  return [...best.values()].map((change) => `${shortName(change.concept)}, now ${change.to}`).join('; ');
}

function defaultShortName(concept) {
  return String(concept || '').replace(/^nema:/, '').replace(/-/g, ' ');
}
