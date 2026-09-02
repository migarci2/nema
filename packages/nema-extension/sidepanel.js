/* nema extension: the "This page" strip in the side panel.
 *
 * The side panel is the vault page, unchanged: app.js renders it, vault.js owns
 * the document, and the consent modal is the vault's own. This module adds one
 * strip above the summary and two buttons, and it is the whole broker. There is
 * no model in the loop: a person clicks, the panel calls the page's WebMCP tools
 * through the service worker, and the vault's own functions do the rest.
 *
 * It imports '/vault.js' with the same absolute specifier app.js uses, so both
 * files hold the same module instance: the same document, the same key, the
 * same consent handler.
 */

import * as vault from '/vault.js';
import { escapeHtml } from '/shared/brand/brand.js';

const esc = escapeHtml;
const strip = document.querySelector('[data-ext-page]');

/** What the panel is looking at: a tab id and that page's reported tools. */
let current = { tabId: null, page: null };
/** The offer the page described, kept between the two actions. */
let manifest = null;
let busy = false;
const calls = [];
const refs = {};

/* ----------------------------------------------------------- layout -- */

strip.innerHTML = `
  <h2 class="n-panel__label" id="p-ext-page">This page</h2>
  <div class="n-panel__body">
    <p class="x-origin mono" data-ext-origin>Looking for the page you are on.</p>
    <p class="x-state" data-ext-state aria-live="polite"></p>
    <p class="x-tools mono" data-ext-tools hidden></p>
    <div class="row row--tight x-actions" data-ext-actions hidden>
      <button class="n-btn n-btn--primary n-btn--sm" type="button" data-ext-share>Share bands with this page</button>
      <button class="n-btn n-btn--secondary n-btn--sm" type="button" data-ext-receipt>Take the receipt to my vault</button>
    </div>
    <div class="x-result" data-ext-result role="status" aria-live="polite"></div>
    <div class="x-calls" data-ext-calls hidden></div>
  </div>`;

refs.origin = strip.querySelector('[data-ext-origin]');
refs.state = strip.querySelector('[data-ext-state]');
refs.tools = strip.querySelector('[data-ext-tools]');
refs.actions = strip.querySelector('[data-ext-actions]');
refs.share = strip.querySelector('[data-ext-share]');
refs.receipt = strip.querySelector('[data-ext-receipt]');
refs.result = strip.querySelector('[data-ext-result]');
refs.calls = strip.querySelector('[data-ext-calls]');

/* The panel is not the web: the header nav and the footer would navigate the
 * vault out of the panel, so the nav is hidden by sidepanel.css and every link
 * that survives opens a tab instead. */
function tameLinks() {
  const label = document.querySelector('.n-header__app');
  if (label) label.textContent = 'in your browser';
  for (const link of document.querySelectorAll('.n-header a, .n-footer a')) {
    link.target = '_blank';
    link.rel = 'noreferrer';
  }
}

/* ---------------------------------------------------------- helpers -- */

function shortOrigin(origin) {
  return String(origin || '').replace(/^https?:\/\//, '');
}

function shortConcept(id) {
  return String(id || '').replace(/^nema:/, '');
}

function statusOf(result) {
  if (result && typeof result === 'object' && typeof result.status === 'string') return result.status;
  return 'ok';
}

function setBusy(value) {
  busy = value;
  const disabled = value || !current.page || !current.page.worksWithNema;
  refs.share.disabled = disabled;
  refs.receipt.disabled = disabled;
}

function say(html) {
  refs.result.innerHTML = html;
}

function line(text, kind = '') {
  return `<p class="x-line${kind ? ' x-line--' + kind : ''}">${esc(text)}</p>`;
}

/** Wait until app.js has finished vault.init(). The registry is the signal. */
async function vaultReady() {
  for (let i = 0; i < 200; i += 1) {
    if (vault.getConcepts().length > 0) return true;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return false;
}

/* ------------------------------------------------------ tool activity -- */

function record(name, ms, status) {
  calls.push({ name, ms, status });
  while (calls.length > 12) calls.shift();
  renderCalls();
}

function renderCalls() {
  if (calls.length === 0) {
    refs.calls.hidden = true;
    return;
  }
  refs.calls.hidden = false;
  refs.calls.innerHTML = calls
    .slice()
    .reverse()
    .map((entry) => `
      <div class="x-call" data-status="${esc(entry.status)}">
        <span class="x-call__name mono">${esc(entry.name)}</span>
        <span class="x-call__ms mono">${esc(String(entry.ms))} ms</span>
        <span class="x-call__status">${esc(entry.status)}</span>
      </div>`)
    .join('');
}

/** One tool call on the page, through the service worker and the bridge. */
async function run(name, args = {}) {
  const answer = await chrome.runtime.sendMessage({
    type: 'nema-ext:execute', tabId: current.tabId, name, args
  });
  if (!answer || !answer.ok) {
    record(name, answer?.ms || 0, 'error');
    throw new Error(answer?.error || 'the page did not answer');
  }
  record(name, answer.ms || 0, statusOf(answer.result));
  return answer.result;
}

/** One vault call, timed the same way so the strip tells the whole story. */
async function runVault(name, work) {
  const startedAt = performance.now();
  try {
    const result = await work();
    record(name, Math.round(performance.now() - startedAt), statusOf(result));
    return result;
  } catch (err) {
    record(name, Math.round(performance.now() - startedAt), 'error');
    throw err;
  }
}

/* ------------------------------------------------------------ render -- */

function render() {
  const page = current.page;

  if (!page || !page.url) {
    refs.origin.textContent = 'No page open in this window.';
    refs.state.textContent = 'Open a page that teaches something and this strip fills in.';
    refs.tools.hidden = true;
    refs.actions.hidden = true;
    setBusy(busy);
    return;
  }

  refs.origin.textContent = shortOrigin(page.origin || page.url);

  if (!page.worksWithNema) {
    refs.state.textContent = 'This page does not offer nema tools. Nothing was read from it.';
    refs.tools.hidden = true;
    refs.actions.hidden = true;
    setBusy(busy);
    return;
  }

  const count = page.tools.length;
  refs.state.textContent =
    `Works with nema. ${count} tool${count === 1 ? '' : 's'} on this page` +
    `${page.title ? ': ' + page.title : ''}.`;
  refs.tools.hidden = false;
  refs.tools.textContent = page.tools.join('  ');
  refs.actions.hidden = false;
  setBusy(busy);
}

/* ----------------------------------------------- the page the panel sees -- */

let refreshTimer = null;

async function refresh() {
  try {
    const answer = await chrome.runtime.sendMessage({ type: 'nema-ext:active-page' });
    const next = answer && typeof answer === 'object' ? answer : { tabId: null, page: null };
    /* A different page means the offer we cached is not this page's offer. */
    if (!current.page || next.page?.url !== current.page.url) manifest = null;
    current = next;
    render();
  } catch { /* the service worker is asleep or restarting; the next event retries */ }
}

function scheduleRefresh() {
  clearTimeout(refreshTimer);
  refreshTimer = setTimeout(refresh, 120);
}

chrome.runtime.onMessage.addListener((message) => {
  if (message && message.type === 'nema-ext:page-changed') scheduleRefresh();
  return undefined;
});

/* --------------------------------------- action 1: share bands with the page -- */

function requirementRows(rows) {
  if (!Array.isArray(rows) || rows.length === 0) return '';
  return `<div class="x-rows">${rows.map((row) => `
    <div class="x-row">
      <span class="x-row__main mono">${esc(shortConcept(row.concept))} ${esc(row.ability)}</span>
      <span class="n-pill n-pill--nodot n-pill--${row.status === 'verified' ? 'durable' : row.status === 'uncertain' ? 'uncertain' : 'unknown'}">${esc(row.status)}</span>
    </div>`).join('')}</div>`;
}

function shareSummary(result, assertion) {
  const parts = [];

  if (result && result.status === 'personalized') {
    const skipped = Array.isArray(result.skipped) ? result.skipped.length : 0;
    parts.push(line(
      `The page rebuilt the path: ${result.personalMinutes} minutes of ${result.fullMinutes}` +
      `${skipped > 0 ? `, ${skipped} step${skipped === 1 ? '' : 's'} struck through` : ''}.`,
      'strong'
    ));
    parts.push(requirementRows(result.requirements));
  } else if (result && result.status === 'checked') {
    const unlocked = Array.isArray(result.unlocked) ? result.unlocked.length : 0;
    const locked = Array.isArray(result.locked) ? result.locked.length : 0;
    parts.push(line(
      `The page checked the prerequisites: ${unlocked} unlocked, ${locked} still locked` +
      `${result.recommendedFirst ? `, start with ${result.recommendedFirst}` : ''}.`,
      'strong'
    ));
    parts.push(requirementRows(result.recognized));
  } else if (result && result.status === 'rejected') {
    parts.push(line(`The page rejected the token: ${result.reason}. Nothing changed there.`, 'warn'));
  } else {
    parts.push(line('The page took the token.', 'strong'));
  }

  const shared = Array.isArray(assertion.shared) ? assertion.shared.length : 0;
  parts.push(line(
    `${shared} band${shared === 1 ? '' : 's'} shared with ${shortOrigin(current.page.origin)}. ` +
    'The disclosure is in your ledger below.'
  ));
  return parts.join('');
}

async function shareBands() {
  if (busy) return;
  setBusy(true);
  say(line('Reading what this page offers.'));

  try {
    await vaultReady();
    const offer = await run('describe_learning_offer', {});
    manifest = offer && offer.manifest ? offer.manifest : null;
    if (!manifest) throw new Error('the page did not describe an offer');

    const requirements = (manifest.requirements || [])
      .filter((entry) => entry && entry.concept && entry.ability)
      .map((entry) => ({ concept: entry.concept, ability: entry.ability }));
    if (requirements.length === 0) {
      say(line('This page asks for nothing about you. There is nothing to share.'));
      return;
    }

    const audience = current.page.origin;
    const purpose = 'personalize-' + (manifest.unit && manifest.unit.id ? manifest.unit.id : 'unit');
    say(line(`Asking you to approve ${requirements.length} bands for ${shortOrigin(audience)}.`));

    const assertion = await runVault(
      'create_readiness_assertion',
      () => vault.createAssertion({ audience, purpose, requirements })
    );

    if (assertion.status === 'denied') {
      say(line('You denied the request. Nothing was shared.', 'warn'));
      return;
    }
    if (assertion.status === 'timeout') {
      say(line('The request timed out waiting for you. Nothing was shared.', 'warn'));
      return;
    }
    if (assertion.status !== 'approved') {
      say(line(assertion.error || 'The vault could not build that assertion.', 'warn'));
      return;
    }

    /* present_assertion is the declarative form every provider ships; the two
     * imperative tools are the same code path on the pages that have them. */
    const offered = new Set(current.page.tools);
    const order = ['present_assertion', 'personalize_learning_path', 'check_prerequisites']
      .filter((name) => offered.has(name));
    if (order.length === 0) throw new Error('this page has no way to take an assertion');

    let result = null;
    let lastError = null;
    for (const name of order) {
      try {
        result = await run(name, { assertionToken: assertion.token });
        if (result && result.status !== 'rejected') break;
      } catch (err) {
        lastError = err;
      }
    }
    if (!result && lastError) throw lastError;

    say(shareSummary(result, assertion));
  } catch (err) {
    say(line(err && err.message ? err.message : String(err), 'warn'));
  } finally {
    setBusy(false);
  }
}

/* ------------------------------- action 2: take the receipt to the vault -- */

function bandsMoved(changes) {
  if (!Array.isArray(changes) || changes.length === 0) return 'no band moved yet';
  return changes
    .map((change) => `${shortConcept(change.concept)} ${change.ability} ${change.from} to ${change.to}`)
    .join(', ');
}

function receiptRow(title, status, detail) {
  const kind = status === 'accepted' ? 'durable'
    : status === 'pending' ? 'pending'
      : status === 'already in your vault' ? 'unknown' : 'danger';
  return `
    <div class="x-row x-row--stacked">
      <span class="x-row__main">${esc(title)}</span>
      <span class="n-pill n-pill--nodot n-pill--${kind}">${esc(status)}</span>
      ${detail ? `<span class="x-row__detail">${esc(detail)}</span>` : ''}
    </div>`;
}

/** Receipts already staged for this activity, so a second click is honest. */
function alreadyStaged(activityId) {
  return vault.getReceipts().some((entry) => entry.payload
    && entry.payload.activity
    && entry.payload.activity.id === activityId);
}

async function takeReceipt() {
  if (busy) return;
  setBusy(true);
  say(line('Asking the page what you have passed.'));

  try {
    await vaultReady();
    if (!manifest) {
      const offer = await run('describe_learning_offer', {});
      manifest = offer && offer.manifest ? offer.manifest : null;
    }
    if (!manifest) throw new Error('the page did not describe an offer');

    const activities = Array.isArray(manifest.activities) ? manifest.activities : [];
    const passed = [];
    for (const activity of activities) {
      const attempt = await run('get_attempt_status', { activityId: activity.id });
      if (attempt && attempt.status === 'passed') passed.push(activity);
    }

    if (passed.length === 0) {
      say(line('Nothing to collect yet. Pass an activity on the page, then press this again.'));
      return;
    }

    const rows = [];
    for (const activity of passed) {
      if (alreadyStaged(activity.id)) {
        rows.push(receiptRow(activity.title, 'already in your vault', ''));
        continue;
      }
      const issued = await run('issue_evidence_receipt', { activityId: activity.id });
      if (!issued || issued.status !== 'issued' || !issued.token) {
        rows.push(receiptRow(activity.title, 'no receipt', issued && issued.reason ? issued.reason : ''));
        continue;
      }
      const staged = await runVault(
        'stage_evidence_receipt',
        () => vault.stageReceipt(issued.token, { source: 'extension' })
      );

      if (staged.status === 'accepted') {
        rows.push(receiptRow(
          activity.title,
          'accepted',
          `${staged.issuerName || staged.issuer}, trust ${staged.trust}. ${bandsMoved(staged.changes)}.`
        ));
      } else if (staged.status === 'pending') {
        rows.push(receiptRow(activity.title, 'pending', 'the issuer is not in the trusted list yet'));
      } else if (staged.status === 'rejected' && staged.reason === 'duplicate') {
        rows.push(receiptRow(activity.title, 'already in your vault', ''));
      } else {
        rows.push(receiptRow(activity.title, 'rejected', staged.reason || ''));
      }
    }

    say(line(`${passed.length} activity result${passed.length === 1 ? '' : 's'} on this page.`, 'strong')
      + `<div class="x-rows">${rows.join('')}</div>`
      + line('The evidence ledger below is the record. Nothing was sent anywhere else.'));
  } catch (err) {
    say(line(err && err.message ? err.message : String(err), 'warn'));
  } finally {
    setBusy(false);
  }
}

/* -------------------------------------------------------------- boot -- */

refs.share.addEventListener('click', shareBands);
refs.receipt.addEventListener('click', takeReceipt);
document.addEventListener('nema:vault-change', () => {
  /* The vault redraws itself; the strip only needs its buttons to stay honest. */
  setBusy(busy);
});

tameLinks();
render();
refresh();
setInterval(refresh, 4000);
