/* nema brand runtime.
 *
 * The header, footer and small shared affordances every nema app needs.
 * ES module, no dependencies, no fetch: the mark and the wordmark are
 * inlined below as strings so a page renders complete on first paint.
 *
 *   import { injectHeader, injectFooter, toast } from '/shared/brand/brand.js';
 *   injectHeader({ app: 'vault', title: 'Vault' });
 *   injectFooter();
 *
 * Exports
 *   MARK_SVG, WORDMARK_SVG   inline SVG source
 *   markSvg(id)              a copy of the mark with a unique gradient id
 *   APP_LINKS                the five app link descriptors
 *   injectHeader(options)    render the shared header
 *   injectFooter(options)    render the shared footer
 *   mountToolsIndicator(el)  keep a tools pill in sync with modelContext
 *   toast(message, kind)     transient message, bottom right
 *   copyToClipboard(t, btn)  copy with a "Copied" button state
 *   escapeHtml(text)         minimal HTML escaping for interpolation
 */

import { ORIGINS } from '/shared/origins.js';

export const REPO_URL = 'https://github.com/migarci2/nema';
export const PROTOCOL_LABEL = 'nema protocol 0.1';

/* ------------------------------------------------------------ assets -- */

export const MARK_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" aria-hidden="true" focusable="false">
  <defs>
    <linearGradient id="nema-mark-edge" x1="32" y1="4" x2="58" y2="34" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="#00E5FF"/>
      <stop offset="0.5" stop-color="#15C4B4"/>
      <stop offset="1" stop-color="#3A78FF"/>
    </linearGradient>
  </defs>
  <path d="M32 6 L54 19 L54 45 L32 58 L10 45 L10 19 Z" fill="none" stroke="url(#nema-mark-edge)" stroke-width="2" stroke-linejoin="miter"/>
  <g shape-rendering="crispEdges">
    <rect x="29" y="3" width="6" height="6" fill="url(#nema-mark-edge)"/>
    <rect x="51" y="16" width="6" height="6" fill="url(#nema-mark-edge)"/>
    <rect x="51" y="42" width="6" height="6" fill="url(#nema-mark-edge)"/>
    <rect x="29" y="55" width="6" height="6" fill="#FFCA2E"/>
    <rect x="7" y="42" width="6" height="6" fill="url(#nema-mark-edge)"/>
    <rect x="7" y="16" width="6" height="6" fill="url(#nema-mark-edge)"/>
  </g>
  <g fill="#F2F6FF" shape-rendering="crispEdges">
    <rect x="24" y="24" width="16" height="4"/>
    <rect x="24" y="28" width="4" height="12"/>
    <rect x="36" y="28" width="4" height="12"/>
  </g>
</svg>`;

/* Every inline copy of the mark needs its own gradient id: two elements with
 * the same id is invalid HTML, and a footer mark that borrows the header's
 * gradient loses its stroke in Firefox as soon as the header is hidden. */
let markSeq = 0;

/**
 * A copy of the mark whose gradient id is unique on the page.
 * @param {string} [id] explicit gradient id. Defaults to a fresh one.
 */
export function markSvg(id = '') {
  const gradientId = id || `nema-mark-edge-${++markSeq}`;
  return MARK_SVG.split('nema-mark-edge').join(gradientId);
}

export const WORDMARK_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 88 24" aria-hidden="true" focusable="false" shape-rendering="crispEdges">
  <g fill="currentColor">
    <rect x="0" y="0" width="16" height="4"/><rect x="0" y="4" width="4" height="20"/><rect x="12" y="4" width="4" height="20"/>
    <rect x="20" y="0" width="16" height="4"/><rect x="20" y="4" width="4" height="20"/><rect x="32" y="4" width="4" height="4"/><rect x="20" y="8" width="16" height="4"/><rect x="20" y="20" width="16" height="4"/>
    <rect x="40" y="0" width="28" height="4"/><rect x="40" y="4" width="4" height="20"/><rect x="52" y="4" width="4" height="20"/><rect x="64" y="4" width="4" height="20"/>
    <rect x="72" y="0" width="16" height="4"/><rect x="84" y="4" width="4" height="20"/><rect x="72" y="8" width="16" height="4"/><rect x="72" y="12" width="4" height="8"/><rect x="72" y="20" width="16" height="4"/>
  </g>
</svg>`;

/* ----------------------------------------------------------- origins -- */

/* One table, one place: shared/origins.js resolves dev or prod from the host.
 * Contract section 0: shared modules are imported with absolute paths. */

export const APP_LINKS = [
  { app: 'site', label: 'Hub' },
  { app: 'vault', label: 'Vault' },
  { app: 'harness', label: 'Harness Lab' },
  { app: 'security', label: 'Agent Security' },
  { app: 'coach', label: 'Coach' }
];

/** Resolved origin for an app key. Falls back to the current origin. */
export function originFor(app) {
  return ORIGINS[app] || (globalThis.location ? globalThis.location.origin : '');
}

/* ------------------------------------------------------------- utils -- */

/** Escape the five characters that matter when interpolating into HTML. */
export function escapeHtml(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/* ------------------------------------------------------------ header -- */

/**
 * Render the shared header.
 *
 * @param {object}   options
 * @param {string}   options.app     app key: site, vault, harness, security, coach
 * @param {string}   options.title   short app name shown in mono next to the wordmark
 * @param {Array}    [options.links] override the nav: [{ href, label, app? }]
 * @param {Element}  [options.mount] explicit mount point
 * @returns {HTMLElement} the header element
 */
export function injectHeader({ app = 'site', title = '', links = null, mount = null } = {}) {
  const host = mount
    || document.querySelector('[data-nema-header]')
    || createHeaderHost();

  host.classList.add('n-header');
  host.setAttribute('data-nema-header', '');

  const nav = (links || APP_LINKS.map((l) => ({ ...l, href: originFor(l.app) + '/' })))
    .map((l) => {
      const current = l.app && l.app === app ? ' aria-current="page"' : '';
      const key = l.app ? ` data-nema-app-link="${escapeHtml(l.app)}"` : '';
      return `<a class="n-header__link" href="${escapeHtml(l.href)}"${key}${current}>${escapeHtml(l.label)}</a>`;
    })
    .join('');

  /* Contract section 2: mark and wordmark left, app name in mono right, then
   * the tools pill. The nav joins them in the right group. */
  host.innerHTML = `
    <a class="n-header__brand" href="${escapeHtml(originFor('site'))}/" aria-label="nema, go to the hub">
      <span class="n-header__mark">${markSvg()}</span>
      <span class="n-header__wordmark">${WORDMARK_SVG}</span>
    </a>
    <div class="n-header__end">
      <nav class="n-header__nav" aria-label="nema apps">${nav}</nav>
      ${title ? `<span class="n-header__app">${escapeHtml(title)}</span>` : ''}
      <span class="n-tools" data-tools-indicator data-live="false" role="status" aria-live="polite" title="WebMCP tools registered on this page">
        <span class="n-tools__dot" aria-hidden="true"></span>
        <span>tools</span>
        <span class="n-tools__count" data-tools-count>0</span>
      </span>
    </div>`;

  mountToolsIndicator(host.querySelector('[data-tools-indicator]'));
  return host;
}

function createHeaderHost() {
  const el = document.createElement('header');
  el.setAttribute('data-nema-header', '');
  const app = document.querySelector('.n-app');
  if (app) app.prepend(el);
  else document.body.prepend(el);
  return el;
}

/* ---------------------------------------------------- tools indicator -- */

const POLL_MS = 1500;

/* One live mount per pill. Re-mounting the same element stops the old timer
 * instead of stacking a second one on top of it. */
const mounted = new WeakMap();

/**
 * Keep a tools pill in sync with document.modelContext.
 * Polls getTools() every 1500 ms and reacts to the 'toolchange' event.
 *
 * @param {Element} [el] the pill. Defaults to every [data-tools-indicator].
 * @returns {Function} stop function, safe to call more than once
 */
export function mountToolsIndicator(el = null) {
  if (el && mounted.has(el)) mounted.get(el)();
  const targets = () => (el ? [el] : Array.from(document.querySelectorAll('[data-tools-indicator]')));

  const paint = (count) => {
    for (const pill of targets()) {
      if (!pill) continue;
      const out = pill.querySelector('[data-tools-count]');
      const next = String(count);
      if (out && out.textContent !== next) out.textContent = next;
      pill.setAttribute('data-live', count > 0 ? 'true' : 'false');
      pill.setAttribute('title', count > 0
        ? `${count} WebMCP tool${count === 1 ? '' : 's'} registered on this page`
        : 'No WebMCP tool registered on this page yet');
    }
  };

  const read = async () => {
    try {
      const mc = document.modelContext;
      if (!mc || typeof mc.getTools !== 'function') return paint(0);
      const tools = await mc.getTools();
      paint(Array.isArray(tools) ? tools.length : 0);
    } catch {
      paint(0);
    }
  };

  read();
  let timer = setInterval(read, POLL_MS);

  const onChange = () => read();
  document.addEventListener('toolchange', onChange);

  /* Keep the handle: document.modelContext can be replaced later, and stop()
   * must detach from the exact object it attached to. */
  let contextTarget = null;
  try {
    const mc = document.modelContext;
    if (mc && typeof mc.addEventListener === 'function') {
      mc.addEventListener('toolchange', onChange);
      contextTarget = mc;
    }
  } catch {
    /* Some polyfills expose modelContext as a plain object. Polling covers it. */
  }

  function stop() {
    if (timer === null) return;
    clearInterval(timer);
    timer = null;
    document.removeEventListener('toolchange', onChange);
    if (contextTarget && typeof contextTarget.removeEventListener === 'function') {
      try {
        contextTarget.removeEventListener('toolchange', onChange);
      } catch {
        /* Nothing to do: the listener goes away with the context object. */
      }
    }
    if (el) mounted.delete(el);
  }

  if (el) mounted.set(el, stop);
  return stop;
}

/* ------------------------------------------------------------ footer -- */

/**
 * Render the shared footer.
 *
 * @param {object} [options]
 * @param {string} [options.note] extra line shown before the links
 * @returns {HTMLElement}
 */
export function injectFooter({ note = '' } = {}) {
  const host = document.querySelector('[data-nema-footer]') || createFooterHost();
  host.classList.add('n-footer');
  host.setAttribute('data-nema-footer', '');
  host.innerHTML = `
    <span class="n-footer__mark">${markSvg()}</span>
    <span>${escapeHtml(PROTOCOL_LABEL)}</span>
    ${note ? `<span class="dim">${escapeHtml(note)}</span>` : ''}
    <span class="n-footer__links">
      <a href="${escapeHtml(originFor('site'))}/" data-nema-app-link="site">Hub</a>
      <a href="${escapeHtml(REPO_URL)}" rel="noopener">Repository</a>
    </span>`;
  return host;
}

function createFooterHost() {
  const el = document.createElement('footer');
  el.setAttribute('data-nema-footer', '');
  const app = document.querySelector('.n-app');
  if (app) app.append(el);
  else document.body.append(el);
  return el;
}

/* ------------------------------------------------------------- toast -- */

const TOAST_MS = 3400;

/**
 * Show a transient message in the bottom right corner.
 *
 * @param {string} message
 * @param {'info'|'ok'|'warn'|'error'} [kind]
 * @returns {HTMLElement} the toast element
 */
export function toast(message, kind = 'info') {
  let stack = document.querySelector('.n-toasts');
  if (!stack) {
    stack = document.createElement('div');
    stack.className = 'n-toasts';
    stack.setAttribute('role', 'status');
    stack.setAttribute('aria-live', 'polite');
    document.body.append(stack);
  }
  const el = document.createElement('div');
  el.className = `n-toast n-toast--${kind}`;
  el.textContent = message;
  stack.append(el);

  setTimeout(() => {
    el.classList.add('n-toast--leaving');
    setTimeout(() => el.remove(), 240);
  }, TOAST_MS);

  return el;
}

/* --------------------------------------------------------- clipboard -- */

const COPIED_MS = 1400;

/**
 * Copy text and flip a button to a "Copied" state for 1400 ms.
 *
 * @param {string} text
 * @param {HTMLElement} [buttonEl]
 * @returns {Promise<boolean>} whether the copy succeeded
 */
export async function copyToClipboard(text, buttonEl = null) {
  const ok = await writeClipboard(String(text == null ? '' : text));

  if (buttonEl) {
    if (!buttonEl.dataset.copyLabel) buttonEl.dataset.copyLabel = buttonEl.textContent;
    buttonEl.textContent = ok ? 'Copied' : 'Copy failed';
    buttonEl.setAttribute('data-copied', ok ? 'true' : 'false');
    clearTimeout(Number(buttonEl.dataset.copyTimer || 0));
    buttonEl.dataset.copyTimer = String(setTimeout(() => {
      buttonEl.textContent = buttonEl.dataset.copyLabel;
      buttonEl.removeAttribute('data-copied');
    }, COPIED_MS));
  } else {
    toast(ok ? 'Copied to clipboard' : 'Could not copy', ok ? 'ok' : 'error');
  }
  return ok;
}

async function writeClipboard(text) {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* Fall through to the selection based path below. */
  }
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.cssText = 'position:fixed;top:0;left:0;opacity:0;pointer-events:none';
    document.body.append(ta);
    ta.select();
    const done = document.execCommand('copy');
    ta.remove();
    return done;
  } catch {
    return false;
  }
}
