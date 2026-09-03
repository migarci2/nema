/* nema extension: one calm surface over the vault.
 *
 * The side panel is the vault, unchanged: app.js renders it, vault.js owns the
 * document, and the consent modal is the vault's own. This module puts one
 * card in front of all of it, and is the whole broker. There is no model in
 * the loop.
 *
 * Three states, and nothing else on screen (CONTRACT 22, 24, 26):
 *
 *   away    not a nema page: the mark, "Learn it once. It counts everywhere.",
 *           and one sentence, or the demo learner while the vault is empty
 *   asks    a nema page, not shared yet: "<Site> asks about 3 things you may
 *           already know", the rows in plain words, Review request, Not on
 *           this visit
 *   shared  "Shared with <Site>. 68 minutes became 27.", and what you did here
 *           as the receipts arrive
 *
 * Everything a machine needs and a person does not (tool names, the call log,
 * timings, the transports, the alignments, the thirty day approval, the Next
 * card and its self check, the manual paths, the whole vault page) lives in the
 * one closed "Under the hood" block at the bottom, built by
 * scripts/build-extension.sh and filled from here.
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
/* A side panel is closed and reopened all the time, and a reopened panel that
 * has forgotten it already shared would ask a second time for the same visit.
 * These two live in session storage, which Chrome clears when the browser does. */
const SHARED_KEY = 'nema:sharedWith';
const DECLINED_KEY = 'nema:declined';

const onboard = document.querySelector('[data-ext-onboard]');
const card = document.querySelector('[data-ext-page]');
const nextCard = document.querySelector('[data-ext-next]');
const hood = document.querySelector('[data-ext-hood]');
if (!onboard || !card || !nextCard || !hood) {
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
/** One line over the card: the share result, or what went wrong. */
let notice = '';
let noticeKind = '';
/**
 * This visit, by origin: what the site did with the bands, what it gave back,
 * and the sites told "not on this visit".
 */
const sharedWith = new Map();
const collected = new Map();
const declined = new Set();

/**
 * A side panel is closed and reopened constantly, and the module starts again
 * every time. Without this a reopened panel forgets it already shared with the
 * page in front of it and asks a second time for the same visit. Session
 * storage is the right shelf: Chrome empties it when the browser closes, which
 * is exactly how long "this visit" lasts.
 */
function rememberVisits() {
  const shared = {};
  for (const [origin, line] of sharedWith) shared[origin] = line;
  const kept = {};
  for (const [origin, rows] of collected) kept[origin] = rows;
  chrome.storage.session.set({
    [SHARED_KEY]: { shared, kept },
    [DECLINED_KEY]: [...declined]
  }).catch(() => {});
}

async function readVisits() {
  try {
    const store = await chrome.storage.session.get([SHARED_KEY, DECLINED_KEY]);
    const held = (store && store[SHARED_KEY]) || {};
    for (const [origin, line] of Object.entries(held.shared || {})) sharedWith.set(origin, line);
    for (const [origin, rows] of Object.entries(held.kept || {})) collected.set(origin, rows);
    for (const origin of (store && store[DECLINED_KEY]) || []) declined.add(origin);
  } catch { /* no session storage, so the panel asks again: the safe way round */ }
}
const calls = [];
const refs = {};

/* ----------------------------------------------------------- layout -- */

onboard.innerHTML = `
  <h2 class="sr-only" id="p-ext-onboard">Start</h2>
  <p class="x-hero__head">Learn it once. It counts everywhere.</p>
  <p class="x-hero__lede">Learn something on one site, and the next one already knows. You decide what
  gets shared, every time. Learn anywhere you see the nema mark.</p>
  <button class="n-btn n-btn--primary n-btn--block" type="button" data-ext-onboard-demo>Load the demo learner</button>`;

card.innerHTML = `
  <h2 class="sr-only" id="p-ext-page">This page</h2>
  <div class="x-away" data-ext-away hidden>
    <p class="x-away__head">Learn it once. It counts everywhere.</p>
    <p class="x-away__line" data-ext-away-line></p>
  </div>
  <div class="x-ask" data-ext-ask hidden>
    <p class="x-ask__head" data-ext-ask-head></p>
    <div class="x-rows" data-ext-ask-rows></div>
    <div class="x-actions" data-ext-actions hidden>
      <button class="n-btn n-btn--primary" type="button" data-ext-share>Review request</button>
      <button class="x-quiet" type="button" data-ext-notnow>Not on this visit</button>
    </div>
  </div>
  <div class="x-decide" data-ext-decide hidden></div>
  <div class="x-result" data-ext-result role="status" aria-live="polite"></div>`;

nextCard.innerHTML = `
  <h2 class="x-label" id="p-ext-next">Next</h2>
  <div data-ext-next-body></div>`;

hood.innerHTML = `
  <p class="x-hood__label">This page</p>
  <p class="x-origin" data-ext-origin>Looking for the page you are on.</p>
  <p class="x-state" data-ext-state aria-live="polite"></p>
  <p class="x-tools" data-ext-tools hidden></p>
  <p class="x-hood__line" data-ext-moved hidden></p>
  <p class="x-hood__label">Transport</p>
  <p class="x-hood__line" data-ext-transport-page>Page transport: not read yet</p>
  <p class="x-hood__line">Panel transport: extension broker</p>
  <div class="x-aligns" data-ext-aligns hidden></div>
  <div class="x-calls" data-ext-calls hidden></div>
  <p class="x-hood__label">Do it by hand</p>
  <div class="x-hood__acts">
    <button class="n-btn n-btn--secondary n-btn--sm" type="button" data-ext-receipt>Check for receipts now</button>
    <button class="n-btn n-btn--secondary n-btn--sm" type="button" data-ext-onboard-import>Import a vault file</button>
    <button class="n-btn n-btn--secondary n-btn--sm" type="button" data-ext-onboard-empty>Start empty</button>
  </div>`;

refs.away = card.querySelector('[data-ext-away]');
refs.awayLine = card.querySelector('[data-ext-away-line]');
refs.ask = card.querySelector('[data-ext-ask]');
refs.askHead = card.querySelector('[data-ext-ask-head]');
refs.askRows = card.querySelector('[data-ext-ask-rows]');
refs.actions = card.querySelector('[data-ext-actions]');
refs.share = card.querySelector('[data-ext-share]');
refs.notNow = card.querySelector('[data-ext-notnow]');
refs.decide = card.querySelector('[data-ext-decide]');
refs.result = card.querySelector('[data-ext-result]');
refs.next = nextCard.querySelector('[data-ext-next-body]');
refs.origin = hood.querySelector('[data-ext-origin]');
refs.state = hood.querySelector('[data-ext-state]');
refs.tools = hood.querySelector('[data-ext-tools]');
refs.moved = hood.querySelector('[data-ext-moved]');
refs.transport = hood.querySelector('[data-ext-transport-page]');
refs.aligns = hood.querySelector('[data-ext-aligns]');
refs.calls = hood.querySelector('[data-ext-calls]');
refs.receipt = hood.querySelector('[data-ext-receipt]');

/* The "Remember this site for 30 days" checkbox of CONTRACT 24.2. It belongs to
 * the extension, not to the vault, so the panel adds it to the vault's own
 * consent modal. It sits in that modal's block under the hood: an answer good
 * for thirty minutes and an approval good for thirty days are two different
 * promises, and a person meeting nema for the first time reads them as one. */
refs.rememberWrap = document.createElement('label');
refs.rememberWrap.className = 'n-check x-remember';
refs.rememberWrap.innerHTML = '<input type="checkbox" data-ext-remember><span>Remember this site for 30 days</span>';
refs.remember = refs.rememberWrap.querySelector('[data-ext-remember]');
(function mountRemember() {
  const under = document.querySelector('#consent-modal .n-under__body');
  if (under) under.appendChild(refs.rememberWrap);
})();

/* app.js opens every <details> around a panel it flashes: a demo seed import, a
 * self check, an alignment confirmed. In the vault that is right, it shows the
 * learner what moved. In the panel the block holds the whole vault, so an
 * automatic open would undo the one surface a person came for. It opens when a
 * person opens it, and closes again whenever anything else opens it. */
const hoodBox = hood.closest('details');
let hoodByHand = false;
if (hoodBox) {
  const summary = hoodBox.querySelector('summary');
  if (summary) summary.addEventListener('click', () => { hoodByHand = !hoodBox.open; });
  new MutationObserver(() => {
    if (hoodBox.open && !hoodByHand) hoodBox.open = false;
  }).observe(hoodBox, { attributes: true, attributeFilter: ['open'] });
}

/* The consent modal, in the panel, is the same card with the buttons swapped.
 * app.js still owns the modal and still settles the promise: the panel only
 * adds the rows it already showed and one line about how long the answer
 * lasts, and sidepanel.css hides the longer copy underneath. The vault's own
 * page is untouched, and so is every selector the modal is driven by. */
refs.consent = document.createElement('div');
refs.consent.className = 'x-consent';
refs.consent.hidden = true;
refs.consent.innerHTML = `
  <div class="x-rows" data-ext-consent-rows></div>
  <p class="x-consent__line">This answer will be valid for 30 minutes. Nothing else will leave.</p>`;
refs.consentRows = refs.consent.querySelector('[data-ext-consent-rows]');
(function mountConsent() {
  const body = document.querySelector('#consent-modal .n-modal__body');
  if (body) body.insertBefore(refs.consent, body.firstChild);
})();

/** The same rows the card showed, so approving reads as the card going on. */
function showConsentRows(requirements, audience) {
  let rows = [];
  if (typeof vault.previewDisclosure === 'function') {
    try {
      rows = vault.previewDisclosure(requirements, audience);
    } catch { rows = []; }
  }
  refs.consentRows.innerHTML = rows.map(askRow).join('');
  refs.consent.hidden = rows.length === 0;
}



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

/** The name the site gave itself, and its domain only when it gave none. */
function siteName(page) {
  const provider = page && page.manifest && page.manifest.provider;
  if (provider) return provider;
  return siteWords(page ? page.origin : '');
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
  const live = Boolean(current.page && current.page.worksWithNema);
  refs.share.disabled = value || !live;
  refs.notNow.disabled = value || !live;
  refs.receipt.disabled = value || !live;
}

function say(text, kind = '') {
  notice = text;
  noticeKind = kind;
  renderResult();
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
 * `quiet` keeps the four second poll out of the log: a person reads the calls
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

/** One vault call, timed the same way so the log tells the whole story. */
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
hood.querySelector('[data-ext-onboard-import]').addEventListener('click', () => {
  clickVault('[data-action="import"]');
});
hood.querySelector('[data-ext-onboard-empty]').addEventListener('click', () => {
  onboarded = true;
  chrome.storage.local.set({ [ONBOARDED_KEY]: true }).catch(() => {});
  render();
});

/* -------------------------------------------------------- Next card -- */

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
  /* The card is under the hood now (a self reported Done next to a signed
   * receipt reads as the same kind of evidence, and it is not), so the only
   * reason to hide it is a vault with nothing in it yet. */
  if (isFresh()) {
    nextCard.hidden = true;
    return;
  }
  const needs = vault.getNeeds(5);
  const need = needs[0] || null;
  if (!need) {
    nextCard.hidden = false;
    refs.next.dataset.nextKey = 'none';
    refs.next.innerHTML = '<p class="x-next__none">Nothing is due. Open something that teaches and this fills in.</p>';
    return;
  }
  nextCard.hidden = false;

  const canSelfCheck = typeof vault.recordSelfCheck === 'function';
  const rubric = Array.isArray(need.rubric) ? need.rubric : [];
  const teacher = teacherFor(need);

  /* The card is redrawn on every vault change and every 4 s refresh. Redrawing
   * the checklist would wipe the boxes a person has just ticked, so the card is
   * rebuilt only when the need itself or its note changes. */
  const key = [need.needId, need.minutes, rubric.join('|'), selfCheckNote, canSelfCheck,
    teacher ? teacher.origin : ''].join('|');
  if (refs.next.dataset.nextKey === key && refs.next.querySelector('[data-ext-done]')) return;
  refs.next.dataset.nextKey = key;

  const checklist = rubric.length === 0
    ? '<p class="x-next__none">This one has nothing to tick yet.</p>'
    : `<ul class="x-next__rubric" data-ext-rubric>${rubric.map((criterion, index) => `
        <li><label class="n-check">
          <input type="checkbox" data-ext-check="${index}">
          <span>${esc(criterion)}</span>
        </label></li>`).join('')}</ul>`;

  refs.next.innerHTML = `
    <p class="x-next__what">
      <span class="x-next__title">${esc(conceptWords(need.concept))}, ${esc(need.ability)}</span>
      <span class="x-next__minutes">${esc(String(need.minutes))} min</span>
    </p>
    ${checklist}
    <div class="x-next__acts">
      <button class="n-btn ${canSelfCheck ? 'n-btn--primary' : 'n-btn--secondary'}" type="button"
        data-ext-done ${canSelfCheck ? '' : 'disabled'} data-need="${esc(need.needId)}">
        ${canSelfCheck ? 'Done' : 'An agent would grade this and keep the receipt'}
      </button>
      ${teacher ? `<button class="x-quiet" type="button" data-ext-teach="${esc(teacher.url || teacher.origin)}">${esc(teacher.provider || shortOrigin(teacher.origin))} teaches this</button>` : ''}
    </div>
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

/** The manifest the page detection summarized, as the hood renders it. */
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

/** Every alignment for this page, in the hood: the whole list, always. */
function renderAlignments() {
  const page = current.page;
  const info = page && page.manifest;
  const local = info && Array.isArray(info.localConcepts) ? info.localConcepts : [];
  if (!page || !page.worksWithNema || local.length === 0) {
    refs.aligns.hidden = true;
    refs.aligns.innerHTML = '';
    renderDecide();
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
  renderDecide();
}

/**
 * The one alignment line the card is allowed: a name this site uses that
 * somebody proposed a meaning for and only the learner can settle. One at a
 * time, and nothing at all when there is nothing to decide.
 */
function renderDecide() {
  const page = current.page;
  if (!page || !page.worksWithNema || stateName() === 'away') {
    refs.decide.hidden = true;
    refs.decide.innerHTML = '';
    return;
  }
  const waiting = alignmentsFor(page.origin).filter((entry) => entry.status === 'proposed');
  const entry = waiting[0] || null;
  if (!entry) {
    refs.decide.hidden = true;
    refs.decide.innerHTML = '';
    return;
  }
  refs.decide.hidden = false;
  refs.decide.innerHTML = `
    <span class="x-decide__text">${esc(alignWords(entry))}.</span>
    <button class="x-quiet" type="button" data-ext-confirm="${esc(entry.alignmentId)}">Confirm</button>
    <button class="x-quiet" type="button" data-ext-reject="${esc(entry.alignmentId)}">Not that</button>`;
}

function decideAlignment(event) {
  const confirm = event.target.closest('[data-ext-confirm]');
  const reject = event.target.closest('[data-ext-reject]');
  if (!confirm && !reject) return;
  const id = (confirm || reject).getAttribute(confirm ? 'data-ext-confirm' : 'data-ext-reject');
  const fn = confirm ? vault.confirmAlignment : vault.rejectAlignment;
  if (typeof fn !== 'function') {
    alignNote = 'This vault build cannot decide alignments yet.';
    renderAlignments();
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
}

hood.addEventListener('click', decideAlignment);
refs.decide.addEventListener('click', decideAlignment);

/* ------------------------------------------------------------ render -- */

/** Which of the three states the panel is in. */
function stateName() {
  const page = current.page;
  if (!page || !page.url || !page.worksWithNema) return 'away';
  if (sharedWith.has(page.origin)) return 'shared';
  if (declined.has(page.origin)) return 'away';
  return 'asks';
}

/** What the page asks about the learner: its requirements and every skip rule. */
function askedPairs(page) {
  const info = page && page.manifest;
  const rows = info && Array.isArray(info.requires) ? info.requires : [];
  const seen = new Set();
  const out = [];
  for (const entry of rows) {
    if (!entry || !entry.concept || !entry.ability) continue;
    const key = entry.concept + '|' + entry.ability;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ concept: entry.concept, ability: entry.ability });
  }
  return out;
}

const STATUS_WORDS = {
  verified: 'verified',
  uncertain: 'not sure yet',
  missing: 'not yet'
};

/* The protocol's abilities, said the way a person would say them. The words
 * themselves are the vocabulary of the ladder, and they belong under the hood:
 * "Ratios, in practice" is the same claim as "nema:ratios, apply". */
const ABILITY_WORDS = {
  recognize: 'recognise',
  retrieve: 'from memory',
  explain: 'in your own words',
  apply: 'in practice',
  transfer: 'in a new situation',
  discriminate: 'tell apart'
};

function abilityWords(ability) {
  return ABILITY_WORDS[ability] || String(ability || '');
}

/** One thing a site asks about: its name in words, and what your vault says. */
function askRow(row) {
  const kind = row.status === 'verified' ? 'good' : '';
  return `
    <div class="x-row">
      <span class="x-row__main">${esc(conceptWords(row.concept))}, ${esc(abilityWords(row.ability))}</span>
      <span class="x-row__state${kind ? ' x-row__state--' + kind : ''}">${esc(STATUS_WORDS[row.status] || row.status)}</span>
    </div>`;
}

/** The rows the site asks about, in plain words, with what your vault says. */
function renderAsk() {
  const page = current.page;
  const pairs = askedPairs(page);
  const site = siteName(page);
  let rows = [];
  if (vaultLive && typeof vault.previewDisclosure === 'function' && pairs.length > 0) {
    try {
      rows = vault.previewDisclosure(pairs, page.origin);
    } catch { rows = []; }
  }
  const read = Boolean(page && page.manifest);
  refs.askHead.textContent = !read
    ? `${site} works with nema. Reading what it asks about you.`
    : pairs.length === 0
      ? `${site} asks nothing about you.`
      : `${site} asks about ${pairs.length} thing${pairs.length === 1 ? '' : 's'} you may already know.`;
  refs.askRows.innerHTML = rows.map(askRow).join('');
}

/** The receipts this page gave back, as they arrive. */
function renderResult() {
  const page = current.page;
  const state = stateName();
  const rows = (page && collected.get(page.origin)) || null;
  const parts = [];

  /* What is happening now wins; otherwise the line this visit already earned. */
  const lead = notice || (state === 'shared' && page ? sharedWith.get(page.origin) || '' : '');
  if (lead) parts.push(`<p class="x-lead${notice && noticeKind ? ' x-lead--' + noticeKind : ''}">${esc(lead)}</p>`);

  if (state === 'shared' || (rows && rows.list.length > 0)) {
    parts.push('<p class="x-did__label">What you did here</p>');
    if (!rows || rows.list.length === 0) {
      parts.push('<p class="x-did__none">Nothing yet. Pass something here and nema will keep the receipt.</p>');
    } else {
      parts.push(`<div class="x-rows">${rows.list.map((row) => `
        <div class="x-row">
          <span class="x-row__main">${esc(row.title)}</span>
          <span class="x-row__state x-row__state--${esc(row.kind)}">${esc(row.status)}</span>
        </div>`).join('')}</div>`);
      if (rows.moved) parts.push(`<p class="x-did__moved">${esc(rows.moved)}</p>`);
    }
  }

  refs.result.innerHTML = parts.join('');
}

function render() {
  renderOnboarding();

  const page = current.page;
  const state = stateName();
  const fresh = vaultLive && isFresh();

  /* The hood always tells the whole truth about the page, whatever the card
   * is showing. CONTRACT 26: the tool names live here and nowhere else. */
  const holds = page && collected.get(page.origin);
  refs.moved.hidden = !(holds && holds.detail);
  if (holds && holds.detail) refs.moved.textContent = holds.detail;
  refs.transport.textContent = 'Page transport: ' + (
    !page || !page.worksWithNema ? 'no nema tools on this page'
      : page.transport === 'polyfill' ? 'WebMCP polyfill'
        : page.transport === 'native' ? 'native WebMCP' : 'not read yet');

  if (!page || !page.url) {
    refs.origin.hidden = true;
    refs.state.textContent = 'No page open in this window. Open something that teaches and this fills in.';
    refs.tools.hidden = true;
  } else {
    refs.origin.hidden = false;
    refs.origin.textContent = shortOrigin(page.origin || page.url);
    if (!page.worksWithNema) {
      refs.state.textContent = 'This page does not offer nema tools. Nothing was read from it.';
      refs.tools.hidden = true;
    } else {
      const count = page.tools.length;
      refs.state.textContent =
        `Works with nema. ${count} tool${count === 1 ? '' : 's'} on this page` +
        `${page.title ? ': ' + page.title : ''}.`;
      refs.tools.hidden = false;
      refs.tools.textContent = page.tools.join('  ');
    }
  }

  /* The card. One state at a time, and never more than one. */
  card.hidden = fresh;
  card.classList.toggle('n-panel--quiet', state === 'away');
  refs.away.hidden = state !== 'away';
  refs.ask.hidden = state !== 'asks';
  refs.actions.hidden = state !== 'asks';
  if (state === 'away') {
    refs.awayLine.textContent = page && page.worksWithNema && declined.has(page.origin)
      ? `Nothing was shared with ${siteName(page)} on this visit. Reload the page to see the request again.`
      : 'Open a page with the nema mark. It will ask here before anything is shared.';
  }
  if (state === 'asks') renderAsk();

  renderAlignments();
  renderResult();
  renderNext();
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
      notice = '';
      noticeKind = '';
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

/** The one line the card keeps: what the site did, in the site's own numbers. */
function sharedLine(result, page) {
  const site = siteName(page);
  if (result && result.status === 'personalized') {
    return `Shared with ${site}. ${result.fullMinutes} minutes became ${result.personalMinutes}.`;
  }
  if (result && result.status === 'checked') {
    const unlocked = Array.isArray(result.unlocked) ? result.unlocked.length : 0;
    return `Shared with ${site}. ${unlocked} activit${unlocked === 1 ? 'y' : 'ies'} opened from what you already know.`;
  }
  if (result && result.status === 'rejected') {
    return `${site} did not take it: ${result.reason}. Nothing changed there.`;
  }
  return `Shared with ${site}.`;
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
  say('Reading what this page offers.');

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
      say('This page asks for nothing about you. There is nothing to share.');
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
    say('Waiting for you to approve.');

    refs.remember.checked = false;
    showConsentRows(requirements, audience);

    let assertion;
    try {
      assertion = await runVault(
        'create_readiness_assertion',
        () => vault.createAssertion({ audience, purpose, requirements })
      );
    } finally {
      refs.consent.hidden = true;
    }

    if (assertion.status === 'denied') {
      declined.add(audience);
      rememberVisits();
      say('You denied the request. Nothing was shared.', 'warn');
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
      say('The request timed out waiting for you. Nothing was shared.', 'warn');
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
      say(assertion.error || 'The vault could not build that assertion.', 'warn');
      return;
    }

    if (refs.remember.checked) rememberSite(audience);

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

    if (!result || result.status !== 'rejected') {
      sharedWith.set(audience, sharedLine(result, current.page));
      declined.delete(audience);
      rememberVisits();
      notice = '';
      noticeKind = '';
    } else {
      notice = sharedLine(result, current.page);
      noticeKind = 'warn';
    }
    render();
    if (fromBar) {
      toPage(tabId, {
        type: 'nema-ext:bar',
        title: 'Shared with this site',
        sub: shareHeadline(result),
        actions: 'none'
      });
    }
  } catch (err) {
    say(err && err.message ? err.message : String(err), 'warn');
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

/**
 * The one sentence the card gets: the furthest band each concept reached.
 * "Cooking ratios is now usable." The ability by ability transition is true and
 * technical, so it goes under the hood next to the tool calls.
 */
function bandSentence(changes) {
  if (!Array.isArray(changes) || changes.length === 0) return '';
  const best = new Map();
  for (const change of changes) {
    const rank = ABILITY_LADDER.indexOf(change.ability);
    const held = best.get(change.concept);
    if (!held || rank > held.rank) best.set(change.concept, { to: change.to, rank });
  }
  return [...best.entries()]
    .map(([concept, reached]) => `${conceptWords(concept)} is now ${reached.to}.`)
    .join(' ');
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
 * from "Check for receipts now" under the hood, it asks the page about every
 * activity in the manifest and always reports what it found.
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
    if (manual) say('Nothing to collect yet. Pass an activity on the page and it lands here on its own.');
    return;
  }

  const rows = [];
  const moved = [];
  let kept = 0;
  for (const id of ids) {
    const title = activityTitle(id);
    if (alreadyStaged(id)) {
      rows.push({ title, status: 'already in your vault', kind: 'held' });
      continue;
    }
    const issued = await run('issue_evidence_receipt', { activityId: id }, { tabId });
    if (!issued || issued.status !== 'issued' || !issued.token) {
      rows.push({ title, status: 'not kept', kind: 'bad' });
      continue;
    }
    const staged = await runVault(
      'stage_evidence_receipt',
      () => vault.stageReceipt(issued.token, { source: 'extension' })
    );

    if (staged.status === 'accepted') {
      kept += 1;
      for (const change of staged.changes || []) moved.push(change);
      /* "kept", not "verified": nema verified a signature, not the learner. */
      rows.push({ title, status: 'kept', kind: 'good' });
    } else if (staged.status === 'pending') {
      rows.push({ title, status: 'waiting', kind: 'wait' });
    } else if (staged.status === 'rejected' && staged.reason === 'duplicate') {
      rows.push({ title, status: 'already in your vault', kind: 'held' });
    } else {
      rows.push({ title, status: 'not kept', kind: 'bad' });
    }
  }

  /* By hand replaces the list; on its own it adds to it, so a page a person
   * works through fills the card one line at a time. */
  const held = collected.get(page.origin) || { list: [], moved: '', detail: '' };
  const list = manual ? rows : held.list.concat(rows);
  const movedLine = moved.length > 0 ? bandSentence(moved) : (manual ? '' : held.moved);
  const detail = moved.length > 0 ? bandsMoved(moved) + '.' : (manual ? '' : held.detail);
  collected.set(page.origin, { list, moved: movedLine, detail });
  rememberVisits();
  if (manual) say('');
  else renderResult();

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
  say('Asking the page what you have passed.');
  try {
    await collect({ manual: true });
  } catch (err) {
    say(err && err.message ? err.message : String(err), 'warn');
  } finally {
    setBusy(false);
  }
}

/* -------------------------------------------------------------- boot -- */

refs.share.addEventListener('click', () => shareBands());
refs.notNow.addEventListener('click', () => {
  const page = current.page;
  if (!page) return;
  declined.add(page.origin);
  rememberVisits();
  say('');
  render();
});
refs.receipt.addEventListener('click', checkReceipts);
document.addEventListener('nema:vault-change', () => {
  /* The vault redraws itself; the panel keeps its own cards honest. */
  render();
  mirrorAutoApprovals();
});

chrome.storage.local.get(ONBOARDED_KEY)
  .then((store) => {
    onboarded = Boolean(store && store[ONBOARDED_KEY]);
    render();
  })
  .catch(() => {});

tameLinks();
render();
vaultReady().then(() => {
  vaultLive = true;
  mirrorAutoApprovals();
  render();
});
readVisits().then(() => {
  render();
  refresh();
});
setInterval(refresh, 4000);
