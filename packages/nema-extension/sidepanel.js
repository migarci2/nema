/* nema extension: what the side panel adds to the vault page.
 *
 * The side panel is the vault, unchanged: app.js renders it, vault.js owns the
 * document, and the consent modal is the vault's own. This module adds four
 * things above it and is the whole broker. There is no model in the loop.
 *
 *   Onboarding   three choices while the vault is empty (CONTRACT 24.1)
 *   Next         the most urgent need, its rubric, and a way to answer it (24.4)
 *   This page    what the open page offers, the two broker actions, the
 *                alignments it proposes (24.2, 24.3, 24.5)
 *   Automatic    receipts collected as they are earned, with a toast in the page
 *
 * It imports '/vault.js' with the same absolute specifier app.js uses, so both
 * files hold the same module instance: the same document, the same key, the
 * same consent handler. Functions the vault may not have yet (recordSelfCheck,
 * the alignment calls) are feature detected: the panel degrades to saying what
 * an agent would do rather than throwing.
 */

import * as vault from '/vault.js';
import { escapeHtml } from '/shared/brand/brand.js';

const esc = escapeHtml;
const DAY_MS = 86400000;
const REMEMBER_DAYS = 30;
const MANIFEST_KEY = 'nema:manifests';
const AUTO_APPROVE_KEY = 'nema:autoApprove';
const ONBOARDED_KEY = 'nema:onboarded';

const strip = document.querySelector('[data-ext-page]');
const onboard = document.querySelector('[data-ext-onboard]');
const nextCard = document.querySelector('[data-ext-next]');
if (!strip || !onboard || !nextCard) {
  throw new Error('[nema] sidepanel.html is missing an extension container: run scripts/build-extension.sh');
}

/** What the panel is looking at: a tab id and that page's reported tools. */
let current = { tabId: null, page: null };
/** The offer the page described, kept between the actions. */
let manifest = null;
let busy = false;
let collecting = false;
let onboarded = false;
/* app.js finishes vault.init() a tick or two after this module runs. Until it
 * does, an empty vault is not news: it is a vault that has not been read. */
let vaultLive = false;
/* What the last Done said. Kept out of the card's markup because recording a
 * self check redraws the card: the vault announces the change before the call
 * returns, so a line written into the old DOM would never be seen. */
let selfCheckNote = '';
/** Manifests seen this session, by origin, as the service worker cached them. */
let manifestCache = {};
/** Origins whose declared alignments have been handed to the vault already. */
const declaredFor = new Set();
/** What the last Confirm or Reject moved, shown under the alignment list. */
let alignNote = '';
const calls = [];
const refs = {};

/* ----------------------------------------------------------- layout -- */

onboard.innerHTML = `
  <h2 class="n-panel__label" id="p-ext-onboard">Start</h2>
  <div class="n-panel__body">
    <p class="x-onboard__head">Learn it once. It counts everywhere.</p>
    <p class="x-onboard__lede">Learn something on one site, and the next one already knows. You decide what gets shared, every time. Learn anywhere you see the nema mark.</p>
    <div class="x-onboard__choices">
      <button class="n-btn n-btn--primary n-btn--sm" type="button" data-ext-onboard-demo>Load the demo learner</button>
      <button class="n-btn n-btn--secondary n-btn--sm" type="button" data-ext-onboard-import>Import a vault file</button>
      <button class="n-btn n-btn--secondary n-btn--sm" type="button" data-ext-onboard-empty>Start empty</button>
    </div>
    <p class="x-onboard__note">Nothing is sent anywhere. The vault is this browser profile's own.</p>
  </div>`;

nextCard.innerHTML = `
  <h2 class="n-panel__label" id="p-ext-next">Next</h2>
  <div class="n-panel__body" data-ext-next-body></div>`;

strip.innerHTML = `
  <h2 class="n-panel__label" id="p-ext-page">This page</h2>
  <div class="n-panel__body">
    <p class="x-origin" data-ext-origin>Looking for the page you are on.</p>
    <p class="x-state" data-ext-state aria-live="polite"></p>
    <div class="row row--tight x-actions" data-ext-actions hidden>
      <button class="n-btn n-btn--primary n-btn--sm" type="button" data-ext-share>Share what you know</button>
      <button class="n-btn n-btn--secondary n-btn--sm" type="button" data-ext-receipt>Check for receipts now</button>
    </div>
    <div class="x-result" data-ext-result role="status" aria-live="polite"></div>
    <div class="x-aligns" data-ext-aligns hidden></div>
    <details class="n-under">
      <summary class="n-under__summary">Under the hood</summary>
      <div class="n-under__body">
        <p class="x-tools mono" data-ext-tools hidden></p>
        <div class="x-calls" data-ext-calls hidden></div>
      </div>
    </details>
  </div>`;

refs.origin = strip.querySelector('[data-ext-origin]');
refs.state = strip.querySelector('[data-ext-state]');
refs.tools = strip.querySelector('[data-ext-tools]');
refs.actions = strip.querySelector('[data-ext-actions]');
refs.share = strip.querySelector('[data-ext-share]');
refs.receipt = strip.querySelector('[data-ext-receipt]');
refs.result = strip.querySelector('[data-ext-result]');
refs.aligns = strip.querySelector('[data-ext-aligns]');
refs.calls = strip.querySelector('[data-ext-calls]');
refs.next = nextCard.querySelector('[data-ext-next-body]');

/* The "Remember this site for 30 days" checkbox of CONTRACT 24.2. It belongs to
 * the extension, not to the vault, so the panel adds it to the vault's own
 * consent modal and only shows it while an extension request is waiting. */
refs.remember = null;
(function mountRemember() {
  const decide = document.querySelector('.v-consent__decide');
  if (!decide) return;
  const label = document.createElement('label');
  label.className = 'n-check x-remember';
  label.hidden = true;
  label.innerHTML = '<input type="checkbox" data-ext-remember><span>Remember this site for 30 days</span>';
  decide.appendChild(label);
  refs.rememberWrap = label;
  refs.remember = label.querySelector('[data-ext-remember]');
})();

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

/** A site as a person names it: its domain, never its full origin string. */
function siteWords(origin) {
  return shortOrigin(origin).replace(/\/$/, '');
}

function shortConcept(id) {
  return String(id || '').replace(/^nema:/, '');
}

/** `knife-skills` reads as `knife skills`, whoever named it. */
function humanName(id) {
  return shortConcept(id).replace(/[-_]/g, ' ');
}

/**
 * A concept in words. The panel never shows an id: a registry concept reads as
 * its title, a name a site made up reads as that site's words in quotes.
 * Contract section 26.
 */
function conceptWords(id) {
  const raw = String(id || '');
  if (typeof vault.getConcept === 'function' && vault.getConcept(raw)) return vault.conceptTitle(raw);
  return `"${humanName(raw)}"`;
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

/** Say something in the page's own bar or toast, through the worker. */
function toPage(tabId, message) {
  if (!Number.isInteger(tabId)) return;
  chrome.runtime.sendMessage({ type: 'nema-ext:to-page', tabId, message }).catch(() => {});
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
  refs.calls.innerHTML = '<p class="x-calls__label">Tool calls, newest first</p>' + calls
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

/**
 * One tool call on the page, through the service worker and the bridge.
 * `quiet` keeps the four second poll out of the strip: a person reads the calls
 * they caused, not the ones the extension makes while they read.
 */
async function run(name, args = {}, { tabId = current.tabId, quiet = false } = {}) {
  const answer = await chrome.runtime.sendMessage({
    type: 'nema-ext:execute', tabId, name, args
  });
  if (!answer || !answer.ok) {
    if (!quiet) record(name, answer?.ms || 0, 'error');
    throw new Error(answer?.error || 'the page did not answer');
  }
  if (!quiet) record(name, answer.ms || 0, statusOf(answer.result));
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

/* -------------------------------------------------------- onboarding -- */

function isFresh() {
  return !onboarded && vault.getReceipts().length === 0;
}

function renderOnboarding() {
  if (!vaultLive) return;
  const fresh = isFresh();
  onboard.hidden = !fresh;
  if (fresh) document.body.dataset.nemaOnboarding = 'on';
  else delete document.body.dataset.nemaOnboarding;
}

function clickVault(selector) {
  const button = document.querySelector(selector);
  if (button) button.click();
}

onboard.querySelector('[data-ext-onboard-demo]').addEventListener('click', () => {
  clickVault('[data-action="load-demo"]');
});
onboard.querySelector('[data-ext-onboard-import]').addEventListener('click', () => {
  clickVault('[data-action="import"]');
});
onboard.querySelector('[data-ext-onboard-empty]').addEventListener('click', () => {
  onboarded = true;
  chrome.storage.local.set({ [ONBOARDED_KEY]: true }).catch(() => {});
  renderOnboarding();
  renderNext();
});

/* -------------------------------------------------------- Next card -- */

const KIND_WORDS = {
  acquire: 'meet this for the first time',
  retrieve: 'bring this back from memory',
  apply: 'use this on a real problem',
  transfer: 'carry this into a new setting',
  discriminate: 'tell this apart from its neighbour',
  repair_misconception: 'clear up what you believe about this',
  reassess: 'show this again, better graded'
};

function humanizeReason(reason) {
  return String(reason || '').split('_').join(' ');
}

/** A site seen this session that can teach the concept this need is about. */
function teacherFor(need) {
  const entries = Object.values(manifestCache || {});
  const here = current.page ? current.page.origin : '';
  let best = null;
  for (const entry of entries) {
    /* No point sending the learner to the page they are reading. */
    if (entry.origin === here) continue;
    const teaches = Array.isArray(entry.teaches) ? entry.teaches : [];
    const names = new Set(teaches.map((item) => item.concept));
    let match = names.has(need.concept);
    if (!match && typeof vault.getAlignments === 'function') {
      match = vault.getAlignments(entry.origin)
        .some((align) => align.status === 'confirmed' && align.concept === need.concept && names.has(align.providerConcept));
    }
    if (!match) continue;
    const exact = teaches.some((item) => item.concept === need.concept && item.ability === need.ability);
    if (!best || (exact && !best.exact)) best = { entry, exact };
  }
  return best ? best.entry : null;
}

function renderNext() {
  if (!vaultLive) return;
  if (isFresh()) {
    nextCard.hidden = true;
    return;
  }
  const needs = vault.getNeeds(5);
  const need = needs[0] || null;
  if (!need) {
    nextCard.hidden = false;
    refs.next.innerHTML = '<p class="n-empty">Nothing is due. Open something that teaches and this card fills in.</p>';
    return;
  }
  nextCard.hidden = false;

  const canSelfCheck = typeof vault.recordSelfCheck === 'function';
  const rubric = Array.isArray(need.rubric) ? need.rubric : [];
  const teacher = teacherFor(need);

  /* The card is redrawn on every vault change and every 4 s refresh. Redrawing
   * the checklist would wipe the boxes a person has just ticked, so the card is
   * rebuilt only when the need itself or its note changes. */
  const key = [need.needId, need.kind, need.minutes, rubric.join('|'), selfCheckNote, canSelfCheck].join('\u0001');
  if (refs.next.dataset.nextKey === key && refs.next.querySelector('[data-ext-done]')) return;
  refs.next.dataset.nextKey = key;

  const checklist = rubric.length === 0
    ? '<p class="x-next__none">This need has no rubric in the registry yet.</p>'
    : `<ul class="x-next__rubric" data-ext-rubric>${rubric.map((criterion, index) => `
        <li><label class="n-check">
          <input type="checkbox" data-ext-check="${index}">
          <span>${esc(criterion)}</span>
        </label></li>`).join('')}</ul>`;

  refs.next.innerHTML = `
    <p class="x-next__what">
      <span class="x-next__title">${esc(conceptWords(need.concept))}, ${esc(need.ability)}</span>
      <span class="x-next__minutes mono">${esc(String(need.minutes))} min</span>
    </p>
    <p class="x-next__why">Time to ${esc(KIND_WORDS[need.kind] || need.kind)}.</p>
    <p class="x-next__reason mono">${esc((need.reason || []).map(humanizeReason).join(', '))}</p>
    <p class="x-next__ask">Tick each one you can do now.</p>
    ${checklist}
    <div class="row row--tight x-next__acts">
      <button class="n-btn ${canSelfCheck ? 'n-btn--primary' : 'n-btn--secondary'} n-btn--sm" type="button"
        data-ext-done ${canSelfCheck ? '' : 'disabled'} data-need="${esc(need.needId)}">
        ${canSelfCheck ? 'Done' : 'An agent would grade this and keep the receipt'}
      </button>
      ${teacher ? `<button class="n-btn n-btn--secondary n-btn--sm" type="button" data-ext-teach="${esc(teacher.url || teacher.origin)}">${esc(teacher.provider || shortOrigin(teacher.origin))} teaches this</button>` : ''}
    </div>
    <p class="x-next__agent">A self check counts as self report, the lightest evidence there is. Connect an agent to be asked instead.</p>
    <p class="x-next__status" data-ext-next-status role="status" aria-live="polite">${esc(selfCheckNote)}</p>`;
}

function note(text) {
  selfCheckNote = text;
  renderNext();
}

async function doneWithNeed(button) {
  const needId = button.getAttribute('data-need');
  if (typeof vault.recordSelfCheck !== 'function') return;

  const need = vault.getNeeds(5).find((entry) => entry.needId === needId) || null;
  const rubric = need && Array.isArray(need.rubric) ? need.rubric : [];
  const boxes = [...refs.next.querySelectorAll('[data-ext-check]')];
  const rubricResults = rubric.map((criterion, index) => ({
    criterion,
    met: Boolean(boxes[index] && boxes[index].checked)
  }));
  if (rubricResults.length === 0) {
    note('There is nothing to tick, so there is nothing to record.');
    return;
  }

  button.disabled = true;
  try {
    const result = await runVault('record_self_check', () => vault.recordSelfCheck({ needId, rubricResults }));
    if (result && result.status === 'accepted') {
      const changes = Array.isArray(result.changes) ? result.changes : [];
      note(changes.length > 0
        ? `Kept as a self check: ${bandsMoved(changes)}.`
        : `Kept as a self check, result ${result.result}. No band moved yet.`);
    } else {
      note(`The vault did not take that: ${(result && result.reason) || 'unknown'}.`);
    }
  } catch (err) {
    note(err && err.message ? err.message : String(err));
  } finally {
    button.disabled = false;
  }
}

nextCard.addEventListener('click', (event) => {
  const done = event.target.closest('[data-ext-done]');
  if (done) {
    doneWithNeed(done);
    return;
  }
  const teach = event.target.closest('[data-ext-teach]');
  if (teach) {
    const url = teach.getAttribute('data-ext-teach');
    if (url) chrome.tabs.create({ url }).catch(() => {});
  }
});

/* ------------------------------------------------------- alignments -- */

function alignmentsFor(origin) {
  if (typeof vault.getAlignments === 'function') return vault.getAlignments(origin);
  const doc = vault.getDoc();
  const all = doc && Array.isArray(doc.alignments) ? doc.alignments : [];
  return all.filter((entry) => entry.origin === origin);
}

/**
 * A site may vouch for its own names, so a declared alignment goes straight in,
 * confirmed and marked as the provider's word. Once per origin per session,
 * from whichever read of the manifest happens first: the page detection in
 * content.js, or the panel's own `describe_learning_offer` on Share.
 */
function declareFrom(origin, concepts) {
  if (!origin || declaredFor.has(origin)) return;
  if (typeof vault.declareAlignments !== 'function') return;
  const list = Array.isArray(concepts) ? concepts : [];
  if (list.length === 0) return;
  declaredFor.add(origin);
  try {
    vault.declareAlignments({ origin, concepts: list });
  } catch { /* the vault decides what it accepts; the panel only offers */ }
}

/** The manifest the page detection summarized, as the strip renders it. */
function declareOnce(page) {
  const info = page && page.manifest;
  declareFrom(page && page.origin, info && info.concepts);
}

/** "This site calls Caramelization 'sugar browning'", never a pair of ids. */
function alignWords(entry) {
  const own = `"${humanName(entry.providerConcept)}"`;
  const target = typeof vault.conceptTitle === 'function'
    ? vault.conceptTitle(entry.concept)
    : humanName(entry.concept);
  if (entry.relation === 'narrower') return `This site says ${own} is a part of ${target}`;
  if (entry.relation === 'broader') return `This site says ${own} covers more than ${target}`;
  return `This site calls ${target} ${own}`;
}

function alignmentRow(entry, actions) {
  return `
    <div class="x-align" data-align="${esc(entry.alignmentId)}">
      <span class="x-align__pair">${esc(alignWords(entry))}</span>
      ${entry.rationale ? `<span class="x-align__why">${esc(entry.rationale)}</span>` : ''}
      ${actions ? `<span class="x-align__acts">
        <button class="n-btn n-btn--sm n-btn--primary" type="button" data-ext-confirm="${esc(entry.alignmentId)}">Confirm</button>
        <button class="n-btn n-btn--sm n-btn--secondary" type="button" data-ext-reject="${esc(entry.alignmentId)}">Reject</button>
      </span>` : `<span class="x-align__state">${esc(entry.status)}</span>`}
    </div>`;
}

function renderAlignments() {
  const page = current.page;
  const info = page && page.manifest;
  const local = info && Array.isArray(info.localConcepts) ? info.localConcepts : [];
  if (!page || !page.worksWithNema || local.length === 0) {
    refs.aligns.hidden = true;
    refs.aligns.innerHTML = '';
    return;
  }

  declareOnce(page);
  const list = alignmentsFor(page.origin);
  const proposed = list.filter((entry) => entry.status === 'proposed');
  const confirmed = list.filter((entry) => entry.status === 'confirmed');
  const known = new Set(list.map((entry) => entry.providerConcept));
  const orphans = local.filter((id) => !known.has(id));

  refs.aligns.hidden = false;
  refs.aligns.innerHTML = `
    <p class="x-aligns__label">This site names things its own way</p>
    ${proposed.length > 0 ? proposed.map((entry) => alignmentRow(entry, true)).join('') : ''}
    ${confirmed.length > 0 ? `<div class="x-aligns__done">${confirmed.map((entry) => alignmentRow(entry, false)).join('')}</div>` : ''}
    ${orphans.length > 0 ? `<p class="x-aligns__open">Nothing has said what ${esc(orphans.map((id) => `"${humanName(id)}"`).join(', '))} means. An agent can propose a match, and you decide.</p>` : ''}
    ${alignNote ? `<p class="x-aligns__note">${esc(alignNote)}</p>` : ''}`;
}

strip.addEventListener('click', (event) => {
  const confirm = event.target.closest('[data-ext-confirm]');
  const reject = event.target.closest('[data-ext-reject]');
  if (!confirm && !reject) return;
  const id = (confirm || reject).getAttribute(confirm ? 'data-ext-confirm' : 'data-ext-reject');
  const fn = confirm ? vault.confirmAlignment : vault.rejectAlignment;
  if (typeof fn !== 'function') {
    say(line('This vault build cannot decide alignments yet.', 'warn'));
    return;
  }
  try {
    const result = fn(id);
    const changes = result && Array.isArray(result.changes) ? result.changes : [];
    alignNote = result && result.status === 'ok'
      ? `${confirm ? 'Confirmed' : 'Rejected'}. ${changes.length > 0 ? bandsMoved(changes) + '.' : 'No band moved.'}`
      : `The vault did not take that: ${(result && result.reason) || 'unknown'}.`;
  } catch (err) {
    alignNote = err && err.message ? err.message : String(err);
  }
  renderAlignments();
});

/* ------------------------------------------------------------ render -- */

function render() {
  const page = current.page;

  renderOnboarding();
  renderNext();

  if (!page || !page.url) {
    refs.origin.hidden = true;
    refs.state.textContent = 'No page open in this window. Open something that teaches and this strip fills in.';
    refs.tools.hidden = true;
    refs.actions.hidden = true;
    renderAlignments();
    setBusy(busy);
    return;
  }

  refs.origin.hidden = false;
  refs.origin.textContent = shortOrigin(page.origin || page.url);

  if (!page.worksWithNema) {
    refs.state.textContent = 'This page does not offer nema tools. Nothing was read from it.';
    refs.tools.hidden = true;
    refs.actions.hidden = true;
    renderAlignments();
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
  renderAlignments();
  setBusy(busy);
}

/* ----------------------------------------------- the page the panel sees -- */

let refreshTimer = null;

async function readManifestCache() {
  try {
    const store = await chrome.storage.session.get(MANIFEST_KEY);
    manifestCache = (store && store[MANIFEST_KEY]) || {};
  } catch {
    manifestCache = {};
  }
}

/** The vault owns the auto approvals; the worker and the bar need to see them. */
function mirrorAutoApprovals() {
  try {
    const map = {};
    for (const entry of vault.autoApprovals()) map[entry.audience] = entry.until;
    chrome.storage.local.set({ [AUTO_APPROVE_KEY]: map }).catch(() => {});
  } catch { /* before init there is nothing to mirror */ }
}

async function refresh() {
  try {
    const answer = await chrome.runtime.sendMessage({ type: 'nema-ext:active-page' });
    const next = answer && typeof answer === 'object' ? answer : { tabId: null, page: null };
    /* A different page means the offer we cached is not this page's offer, and
     * that what the last one did is not news about this one. */
    if (!current.page || next.page?.url !== current.page.url) {
      manifest = null;
      alignNote = '';
      say('');
    }
    current = { tabId: next.tabId, page: next.page };
    await readManifestCache();
    render();
    for (const intent of Array.isArray(next.intents) ? next.intents : []) handleIntent(intent);
    autoCollect();
  } catch { /* the service worker is asleep or restarting; the next event retries */ }
}

function scheduleRefresh() {
  clearTimeout(refreshTimer);
  refreshTimer = setTimeout(refresh, 120);
}

chrome.runtime.onMessage.addListener((message) => {
  if (!message || typeof message !== 'object') return undefined;
  if (message.type === 'nema-ext:page-changed') scheduleRefresh();
  /* The worker hands work over as a message rather than leaving it for the
   * panel's own timer: a side panel opened as a background tab, which is what
   * the headless test does, has its timers throttled to a second or worse. */
  if (message.type === 'nema-ext:intent') handleIntent(message.intent);
  return undefined;
});

/** Work a page asked for: the bar's Share, or an activity that turned passed. */
async function handleIntent(intent) {
  if (!intent || (intent.kind !== 'share' && intent.kind !== 'collect')) return;
  if (Number.isInteger(intent.tabId) && intent.tabId !== current.tabId) {
    const answer = await chrome.runtime.sendMessage({ type: 'nema-ext:active-page', tabId: intent.tabId })
      .catch(() => null);
    if (answer && answer.page) {
      current = { tabId: answer.tabId, page: answer.page };
      manifest = null;
      render();
    }
  }
  if (intent.kind === 'share') await shareBands({ fromBar: true });
  else await autoCollect();
}

/* --------------------------------------- action 1: share bands with the page -- */

function requirementRows(rows) {
  if (!Array.isArray(rows) || rows.length === 0) return '';
  return `<div class="x-rows">${rows.map((row) => `
    <div class="x-row">
      <span class="x-row__main">${esc(conceptWords(row.concept))}, ${esc(row.ability)}</span>
      <span class="n-pill n-pill--nodot n-pill--${row.status === 'verified' ? 'durable' : row.status === 'uncertain' ? 'uncertain' : 'unknown'}">${esc(row.status)}</span>
    </div>`).join('')}</div>`;
}

/** One sentence for the page's bar: what the site did with the bands. */
function shareHeadline(result) {
  if (result && result.status === 'personalized') {
    return `The path is ${result.personalMinutes} minutes instead of ${result.fullMinutes}.`;
  }
  if (result && result.status === 'checked') {
    const unlocked = Array.isArray(result.unlocked) ? result.unlocked.length : 0;
    return `${unlocked} activit${unlocked === 1 ? 'y' : 'ies'} unlocked from what you already know.`;
  }
  return 'The page took your bands.';
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

/**
 * Write the 30 day approval the panel's own checkbox promises.
 *
 * ponytail: the vault's auto approval is one hour and it has no setter, so the
 * panel writes the expiry into the document it already holds a reference to and
 * into the storage key the vault owns, then asks the view to redraw. Upgrade
 * path: one vault function, setAutoApproval(audience, ms), that the vault's own
 * checkbox and this one both call.
 */
function rememberSite(origin) {
  const doc = vault.getDoc();
  if (!doc || !doc.settings || !doc.settings.autoApprove) return;
  doc.settings.autoApprove[origin] = new Date(Date.now() + REMEMBER_DAYS * DAY_MS).toISOString();
  try {
    localStorage.setItem(vault.STORAGE_KEY, JSON.stringify(doc));
  } catch { /* a full quota is the vault's problem to report, not the panel's */ }
  mirrorAutoApprovals();
  document.dispatchEvent(new CustomEvent('nema:vault-change', {
    detail: { reason: 'site-remembered', audience: origin }
  }));
}

async function shareBands({ fromBar = false } = {}) {
  if (busy) return;
  const tabId = current.tabId;
  setBusy(true);
  say(line('Reading what this page offers.'));

  try {
    await vaultReady();
    const offer = await run('describe_learning_offer', {});
    manifest = offer && offer.manifest ? offer.manifest : null;
    if (!manifest) throw new Error('the page did not describe an offer');
    /* The site's own word about its own vocabulary, taken here too: a share
     * may be the first time this panel reads the manifest, and a requirement
     * written in the site's names is only answerable once they are aligned. */
    declareFrom(current.page && current.page.origin, manifest.concepts);
    renderAlignments();

    /* What the page asks for: its requirements plus every pair a skipIf or an
     * unlock rule reads, the same set the site's own Connect button sends, so
     * one approval answers everything the path is built from. */
    const seen = new Set();
    const requirements = [];
    const addPair = (entry) => {
      if (!entry || !entry.concept || !entry.ability) return;
      const key = entry.concept + '|' + entry.ability;
      if (seen.has(key)) return;
      seen.add(key);
      requirements.push({ concept: entry.concept, ability: entry.ability });
    };
    for (const entry of manifest.requirements || []) addPair(entry);
    for (const activity of manifest.activities || []) {
      for (const rule of activity.skipIf || []) addPair(rule);
      for (const rule of activity.unlock || activity.unlockIf || []) addPair(rule);
    }
    if (requirements.length === 0) {
      say(line('This page asks for nothing about you. There is nothing to share.'));
      if (fromBar) {
        toPage(tabId, {
          type: 'nema-ext:bar',
          title: 'This site asks nothing about you',
          sub: 'Nothing to share, so nothing was shared.',
          actions: 'none'
        });
      }
      return;
    }

    const audience = current.page.origin;
    const purpose = 'personalize-' + (manifest.unit && manifest.unit.id ? manifest.unit.id : 'unit');
    say(line(`Asking you to approve ${requirements.length} bands for ${shortOrigin(audience)}.`));

    if (refs.rememberWrap) {
      refs.remember.checked = false;
      refs.rememberWrap.hidden = false;
    }

    let assertion;
    try {
      assertion = await runVault(
        'create_readiness_assertion',
        () => vault.createAssertion({ audience, purpose, requirements })
      );
    } finally {
      if (refs.rememberWrap) refs.rememberWrap.hidden = true;
    }

    if (assertion.status === 'denied') {
      say(line('You denied the request. Nothing was shared.', 'warn'));
      if (fromBar) {
        toPage(tabId, {
          type: 'nema-ext:bar',
          title: 'Not shared',
          sub: 'Nothing left your vault.',
          actions: 'offer'
        });
      }
      return;
    }
    if (assertion.status === 'timeout') {
      say(line('The request timed out waiting for you. Nothing was shared.', 'warn'));
      if (fromBar) {
        toPage(tabId, {
          type: 'nema-ext:bar',
          title: 'Nothing was shared',
          sub: 'nema waited two minutes for your answer.',
          actions: 'offer'
        });
      }
      return;
    }
    if (assertion.status !== 'approved') {
      say(line(assertion.error || 'The vault could not build that assertion.', 'warn'));
      return;
    }

    if (refs.remember && refs.remember.checked) rememberSite(audience);

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
    if (fromBar) {
      toPage(tabId, {
        type: 'nema-ext:bar',
        title: 'Shared with this site',
        sub: shareHeadline(result),
        actions: 'none'
      });
    }
  } catch (err) {
    say(line(err && err.message ? err.message : String(err), 'warn'));
    if (fromBar) {
      toPage(tabId, {
        type: 'nema-ext:bar',
        title: 'nema could not share with this site',
        sub: err && err.message ? err.message : String(err),
        actions: 'offer'
      });
    }
  } finally {
    setBusy(false);
  }
}

/* ---------------------------------- action 2: receipts, automatic and by hand -- */

/* One claim lifts every ability under it, so four lines about the same concept
 * are one piece of news. The panel names the furthest ability that moved and
 * counts the rest, the way the vault does. */
const ABILITY_LADDER = ['recognize', 'retrieve', 'explain', 'apply', 'transfer', 'discriminate'];

function bandsMoved(changes) {
  if (!Array.isArray(changes) || changes.length === 0) return 'no band moved yet';
  const best = new Map();
  for (const change of changes) {
    const rank = ABILITY_LADDER.indexOf(change.ability);
    const held = best.get(change.concept);
    if (!held || rank > held.rank) best.set(change.concept, { change, rank, lower: held ? held.lower + 1 : 0 });
    else best.set(change.concept, { ...held, lower: held.lower + 1 });
  }
  return [...best.values()]
    .map(({ change, lower }) => `${conceptWords(change.concept)}, ${change.ability}: ${change.from} to ${change.to}`
      + (lower > 0 ? `, and ${lower} below it` : ''))
    .join('; ');
}

/** The toast wording of CONTRACT 24.3: the bands that moved, in words. */
function bandWords(changes) {
  const best = new Map();
  for (const change of changes) {
    if (!best.has(change.concept)) best.set(change.concept, change.to);
  }
  return [...best.entries()]
    .map(([concept, band]) => `${humanName(concept)}, now ${band}`)
    .join('; ');
}

function receiptRow(title, status, detail) {
  const kind = status === 'accepted' ? 'durable'
    : status === 'waiting' ? 'pending'
      : status === 'already in your vault' ? 'unknown' : 'danger';
  return `
    <div class="x-row x-row--stacked">
      <span class="x-row__main">${esc(title)}</span>
      <span class="n-pill n-pill--nodot n-pill--${kind}">${esc(status)}</span>
      ${detail ? `<span class="x-row__detail">${esc(detail)}</span>` : ''}
    </div>`;
}

/** Receipts already staged for this activity, so a second pass is honest. */
function alreadyStaged(activityId) {
  return vault.getReceipts().some((entry) => entry.payload
    && entry.payload.activity
    && entry.payload.activity.id === activityId);
}

/** The activity's own title, from whichever description of it we have. */
function activityTitle(id) {
  const full = manifest && Array.isArray(manifest.activities)
    ? manifest.activities.find((entry) => entry.id === id) : null;
  if (full && full.title) return full.title;
  const page = current.page;
  const summary = page && page.manifest && Array.isArray(page.manifest.activities)
    ? page.manifest.activities.find((entry) => entry.id === id) : null;
  return (summary && summary.title) || id;
}

/**
 * Collect the receipts this page owes the learner.
 *
 * Automatically, the page has already told us which activities it graded as
 * passed (content.js polls `get_attempt_status` in the tab itself), so this
 * only issues and stages, and stays silent unless something was kept. By hand,
 * from "Check for receipts now", it asks the page about every activity in the
 * manifest and always reports what it found.
 */
async function collect({ manual }) {
  const tabId = current.tabId;
  const page = current.page;
  if (!page || !page.worksWithNema) return;
  if (!page.tools.includes('get_attempt_status') || !page.tools.includes('issue_evidence_receipt')) return;

  await vaultReady();
  let ids = [];

  if (manual) {
    if (!manifest) {
      const offer = await run('describe_learning_offer', {}, { tabId });
      manifest = offer && offer.manifest ? offer.manifest : null;
    }
    if (!manifest) throw new Error('the page did not describe an offer');
    for (const activity of Array.isArray(manifest.activities) ? manifest.activities : []) {
      const attempt = await run('get_attempt_status', { activityId: activity.id }, { tabId });
      if (attempt && attempt.status === 'passed') ids.push(activity.id);
    }
  } else {
    ids = (Array.isArray(page.passed) ? page.passed : []).filter((id) => !alreadyStaged(id));
  }

  if (ids.length === 0) {
    if (manual) say(line('Nothing to collect yet. Pass an activity on the page and it lands here on its own.'));
    return;
  }

  const rows = [];
  const moved = [];
  let kept = 0;
  for (const id of ids) {
    const title = activityTitle(id);
    if (alreadyStaged(id)) {
      rows.push(receiptRow(title, 'already in your vault', ''));
      continue;
    }
    const issued = await run('issue_evidence_receipt', { activityId: id }, { tabId });
    if (!issued || issued.status !== 'issued' || !issued.token) {
      rows.push(receiptRow(title, 'no receipt', issued && issued.reason ? issued.reason : ''));
      continue;
    }
    const staged = await runVault(
      'stage_evidence_receipt',
      () => vault.stageReceipt(issued.token, { source: 'extension' })
    );

    if (staged.status === 'accepted') {
      kept += 1;
      for (const change of staged.changes || []) moved.push(change);
      rows.push(receiptRow(
        title,
        'accepted',
        `${staged.issuerName || siteWords(staged.issuer)} signed it. ${bandsMoved(staged.changes)}.`
      ));
    } else if (staged.status === 'pending') {
      rows.push(receiptRow(title, 'waiting', 'nothing here knows who signed it yet'));
    } else if (staged.status === 'rejected' && staged.reason === 'duplicate') {
      rows.push(receiptRow(title, 'already in your vault', ''));
    } else {
      rows.push(receiptRow(title, 'rejected', staged.reason || ''));
    }
  }

  if (manual || kept > 0) {
    say(line(`${ids.length} ${ids.length === 1 ? 'activity' : 'activities'} you passed on this page.`, 'strong')
      + `<div class="x-rows">${rows.join('')}</div>`
      + line('The evidence ledger below is the record. Nothing was sent anywhere else.'));
  }
  /* Failures and duplicates stay in the panel. The page only hears good news. */
  if (kept > 0 && moved.length > 0) {
    toPage(tabId, { type: 'nema-ext:toast', text: `Kept in your vault: ${bandWords(moved)}` });
  } else if (kept > 0) {
    toPage(tabId, { type: 'nema-ext:toast', text: 'Kept in your vault. No band moved yet.' });
  }
}

/**
 * Keep whatever the page says it has graded as passed. The page raises this the
 * moment it sees a pass, and the panel also runs it on every refresh, so a
 * panel opened after the fact still catches up.
 */
async function autoCollect() {
  if (busy || collecting) return;
  const page = current.page;
  if (!page || !page.worksWithNema || page.visible === false) return;
  if (!Array.isArray(page.passed) || page.passed.length === 0) return;
  collecting = true;
  try {
    await collect({ manual: false });
  } catch { /* the page navigated away mid collect; the next pass tries again */ } finally {
    collecting = false;
  }
}

async function checkReceipts() {
  if (busy) return;
  setBusy(true);
  say(line('Asking the page what you have passed.'));
  try {
    await collect({ manual: true });
  } catch (err) {
    say(line(err && err.message ? err.message : String(err), 'warn'));
  } finally {
    setBusy(false);
  }
}

/* -------------------------------------------------------------- boot -- */

refs.share.addEventListener('click', () => shareBands());
refs.receipt.addEventListener('click', checkReceipts);
document.addEventListener('nema:vault-change', () => {
  /* The vault redraws itself; the panel keeps its own cards honest. */
  setBusy(busy);
  renderOnboarding();
  renderNext();
  renderAlignments();
  mirrorAutoApprovals();
});

chrome.storage.local.get(ONBOARDED_KEY)
  .then((store) => {
    onboarded = Boolean(store && store[ONBOARDED_KEY]);
    renderOnboarding();
    renderNext();
  })
  .catch(() => {});

tameLinks();
render();
vaultReady().then(() => {
  vaultLive = true;
  mirrorAutoApprovals();
  renderOnboarding();
  renderNext();
});
refresh();
setInterval(refresh, 4000);
