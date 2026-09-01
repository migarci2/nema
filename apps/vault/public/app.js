/* nema vault: the screen.
 *
 * app.js owns rendering and the two human affordances an agent can never have:
 * the consent modal and the manual receipt inbox. Every number on this page is
 * derived from the receipt ledger by /shared/inference.js when it is drawn, so
 * a reload can never show a band that evidence does not support.
 */

import { injectHeader, injectFooter, toast, copyToClipboard, escapeHtml } from '/shared/brand/brand.js';
import { mountActivityStrip, isNative } from '/shared/webmcp.js';
import { ABILITIES } from '/shared/inference.js';
import { decodeToken } from '/shared/protocol.js';
import * as vault from '/vault.js';
import { renderGraph } from '/graph.js';
import { register, evidenceRows, disclosureRows } from '/tools.js';

const esc = escapeHtml;
const DAY_MS = 86400000;
const EVIDENCE_PREVIEW = 8;

const BANDS = ['durable', 'usable', 'fragile', 'uncertain', 'unknown'];
const ABILITY_SHORT = {
  recognize: 'rec',
  retrieve: 'ret',
  explain: 'exp',
  apply: 'app',
  transfer: 'tra',
  discriminate: 'dis'
};

const PANEL_IDS = {
  summary: 'p-summary',
  graph: 'p-graph',
  state: 'p-state',
  needs: 'p-needs',
  disclosures: 'p-disclosures',
  evidence: 'p-evidence',
  goals: 'p-goals',
  inbox: 'p-inbox'
};

const refs = {};
let showAllEvidence = false;
let consentState = null;
let consentTimeoutMs = 120000;

/* --------------------------------------------------------- utilities -- */

function $(selector) {
  return document.querySelector(selector);
}

function pillClass(band) {
  return BANDS.includes(band) ? `n-pill n-pill--${band}` : 'n-pill n-pill--unknown';
}

function statusPill(status) {
  if (status === 'verified') return 'n-pill n-pill--durable';
  if (status === 'uncertain') return 'n-pill n-pill--uncertain';
  return 'n-pill n-pill--unknown';
}

function shortConcept(id) {
  return String(id || '').replace(/^nema:/, '');
}

function shortOrigin(origin) {
  return String(origin || '').replace(/^https?:\/\//, '');
}

function isoDate(iso) {
  if (!iso) return '';
  return String(iso).slice(0, 10);
}

/** "in 3 days", "4 days ago", "in 28 minutes". Plain words, no abbreviations. */
function relTime(iso, nowMs = Date.now()) {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return 'unknown';
  const delta = ms - nowMs;
  const ahead = delta >= 0;
  const abs = Math.abs(delta);
  const minutes = Math.round(abs / 60000);
  const hours = Math.round(abs / 3600000);
  const days = Math.round(abs / DAY_MS);
  let value;
  if (minutes < 1) value = 'less than a minute';
  else if (minutes < 90) value = `${minutes} minute${minutes === 1 ? '' : 's'}`;
  else if (hours < 36) value = `${hours} hour${hours === 1 ? '' : 's'}`;
  else value = `${days} day${days === 1 ? '' : 's'}`;
  return ahead ? `in ${value}` : `${value} ago`;
}

function humanize(token) {
  return String(token || '').replace(/_/g, ' ');
}

function plural(count, word, many) {
  if (count === 1) return `${count} ${word}`;
  return `${count} ${many || `${word}s`}`;
}

/* ------------------------------------------------------------ summary -- */

function renderSummary() {
  const { summary } = vault.derived();
  const receipts = vault.getReceipts();
  const pending = receipts.filter((entry) => entry.status === 'pending').length;
  const agent = receipts.filter((entry) => entry.payload && entry.payload.keyId === 'agent').length;
  const verified = receipts.length - pending - agent;
  const registrySize = vault.getConcepts().length;

  const stats = [
    { value: summary.concepts, label: 'concepts tracked', className: 'n-stat n-stat--accent' },
    { value: summary.durable, label: 'durable' },
    { value: summary.usable, label: 'usable' },
    { value: summary.fragile, label: 'fragile' },
    { value: summary.uncertain, label: 'uncertain' },
    { value: summary.reviewsDue, label: 'reviews due', className: 'n-stat v-stat--due' },
    { value: receipts.length, label: 'receipts held' }
  ];

  refs.summaryStats.innerHTML = stats.map((stat) => `
    <div class="${stat.className || 'n-stat'}">
      <span class="n-stat__value">${stat.value}</span>
      <span class="n-stat__label">${esc(stat.label)}</span>
    </div>`).join('');

  const parts = [`${registrySize} concepts in registry, ${summary.concepts} with evidence`];
  if (receipts.length === 0) {
    parts.push('no receipts yet, load the demo learner to see a vault that has been used');
  } else {
    const receiptBits = [`${plural(verified, 'signed receipt')} verified`];
    if (agent > 0) receiptBits.push(`${agent} agent assessed`);
    if (pending > 0) receiptBits.push(`${pending} pending`);
    parts.push(receiptBits.join(', '));
    parts.push(`${plural(vault.getGoals().length, 'goal')}, ${plural(vault.getDisclosures().length, 'disclosure')} approved`);
  }
  refs.summaryLine.textContent = `${parts.join('. ')}.`;
}

/* -------------------------------------------------------------- graph -- */

function renderGraphPanel() {
  const { state } = vault.derived();
  renderGraph(refs.graph, {
    concepts: vault.getConcepts(),
    state,
    onSelect: showGraphDetail
  });

  refs.graphLegend.innerHTML = BANDS
    .map((band) => `<span class="${pillClass(band)}">${band}</span>`)
    .join('') + '<span class="v-legend__due mono">review due</span>';
}

function showGraphDetail(conceptId) {
  if (!conceptId) {
    refs.graphDetail.innerHTML = '<span class="dim mono">Focus or hover a node to read its bands.</span>';
    return;
  }
  const { state } = vault.derived();
  const abilities = state[conceptId] || {};
  const { nextReview, reviewDue } = vault.nextReviewFor(conceptId);
  const bands = ABILITIES
    .filter((ability) => abilities[ability])
    .map((ability) => `<span class="${pillClass(abilities[ability].band)}">${ABILITY_SHORT[ability]} ${abilities[ability].band}</span>`)
    .join('');

  refs.graphDetail.innerHTML = `
    <span class="v-graph__name">${esc(vault.conceptTitle(conceptId))}</span>
    <span class="mono dim">${esc(conceptId)}</span>
    ${bands || '<span class="dim mono">no evidence yet</span>'}
    ${nextReview
      ? `<span class="${reviewDue ? 'n-pill n-pill--due' : 'mono dim'}">review ${relTime(nextReview)}</span>`
      : ''}`;
}

/* ------------------------------------------------------- state table -- */

function renderStateTable() {
  const { state, now } = vault.derived();
  const nowMs = Date.parse(now);
  const concepts = vault.getConcepts();
  const withEvidence = concepts.filter((entry) => state[entry.id]);
  const without = concepts.filter((entry) => !state[entry.id]);

  if (withEvidence.length === 0) {
    refs.stateTable.innerHTML = `
      <p class="n-empty">No evidence yet</p>
      <p class="n-panel__note">Every band on this page comes from a signed receipt. Load the demo learner, or stage a receipt from a provider, and the table fills in.</p>`;
    return;
  }

  const head = `
    <tr>
      <th scope="col">concept</th>
      ${ABILITIES.map((ability) => `<th scope="col"><abbr title="${ability}">${ABILITY_SHORT[ability]}</abbr></th>`).join('')}
      <th scope="col">next review</th>
    </tr>`;

  const rows = withEvidence.map((concept) => {
    const abilities = state[concept.id] || {};
    const cells = ABILITIES.map((ability) => {
      const entry = abilities[ability];
      if (!entry) {
        return `<td><span class="v-none"><span class="sr-only">${ability} unknown</span></span></td>`;
      }
      return `<td><span class="${pillClass(entry.band)}" title="${ability} ${entry.band}, confidence ${entry.confidence}">${entry.band}</span></td>`;
    }).join('');

    const { nextReview, reviewDue } = vault.nextReviewFor(concept.id);
    const review = nextReview
      ? (reviewDue
        ? `<span class="n-pill n-pill--due">due ${relTime(nextReview, nowMs)}</span>`
        : `<span class="mono dim">${relTime(nextReview, nowMs)}</span>`)
      : '<span class="mono dim">none</span>';

    return `
      <tr data-concept="${esc(concept.id)}">
        <th scope="row"><span class="v-table__title">${esc(concept.title)}</span><span class="v-table__id mono">${esc(shortConcept(concept.id))}</span></th>
        ${cells}
        <td class="v-table__review">${review}</td>
      </tr>`;
  }).join('');

  const missing = without.length > 0
    ? `<p class="v-table__missing mono">${plural(without.length, 'concept')} in the registry with no evidence yet: ${without.map((entry) => esc(shortConcept(entry.id))).join(', ')}</p>`
    : '';

  refs.stateTable.innerHTML = `
    <div class="v-table__wrap"><table class="v-table">
      <caption class="sr-only">Learner state, one row per concept and one column per ability</caption>
      <thead>${head}</thead>
      <tbody>${rows}</tbody>
    </table></div>${missing}`;
}

/* -------------------------------------------------------------- needs -- */

function currentBudget() {
  const value = Number(refs.budgetInput.value);
  return Number.isFinite(value) && value > 0 ? Math.round(value) : null;
}

function renderNeeds(explicitNeeds, budgetOverride) {
  const budget = budgetOverride === undefined ? currentBudget() : budgetOverride;
  const needs = explicitNeeds || vault.getNeeds(budget || undefined);

  if (needs.length === 0) {
    refs.needsList.innerHTML = vault.getReceipts().length === 0
      ? '<p class="n-empty">Nothing to plan yet</p>'
      : '<p class="n-empty">Nothing is due inside that budget</p>';
    return;
  }

  const minutes = needs.reduce((total, need) => total + (need.minutes || 0), 0);
  const rows = needs.map((need, index) => `
    <div class="n-path__row">
      <span class="n-path__index">${String(index + 1).padStart(2, '0')}</span>
      <span class="n-path__main">
        <span class="n-path__title"><span class="v-need__kind mono">${esc(humanize(need.kind))}</span> ${esc(vault.conceptTitle(need.concept))}, ${esc(need.ability)}</span>
        <span class="n-path__reason">${esc((need.reason || []).map(humanize).join(', '))}${need.confusableWith ? `, against ${esc(shortConcept(need.confusableWith))}` : ''}</span>
      </span>
      <span class="n-path__minutes">${need.minutes} min</span>
    </div>`).join('');

  refs.needsList.innerHTML = `${rows}
    <div class="n-path__total"><span>planned</span><b>${minutes}</b><span>minutes over ${plural(needs.length, 'need')}</span></div>`;
}

/* ------------------------------------------------- disclosure ledger -- */

function renderDisclosures() {
  const rows = disclosureRows();
  if (rows.length === 0) {
    refs.disclosureLedger.innerHTML = `
      <p class="n-empty">Nothing has left the vault</p>
      <p class="n-panel__note">A provider has to ask, and you have to approve, before a single band is shared. Approved disclosures are listed here with what was shared and when it expires.</p>`;
    return;
  }

  const auto = vault.autoApprovals();
  const autoRow = auto.map((entry) => `
      <div class="n-ledger__row n-ledger__row--flag">
        <span class="n-ledger__id">auto</span>
        <span class="n-ledger__main">
          <span class="n-ledger__title">${esc(vault.audienceName(entry.audience))} is auto approved</span>
          <span class="n-ledger__meta"><span>ends ${esc(relTime(entry.until))}</span><span>you can stop this at any time</span></span>
        </span>
        <span class="n-ledger__end"><button class="n-btn n-btn--sm n-btn--secondary" type="button" data-stop-auto="${esc(entry.audience)}">Stop</button></span>
      </div>`).join('');

  refs.disclosureLedger.innerHTML = autoRow + rows.map((row, index) => {
    const shared = row.shared
      .map((item) => `<span class="v-claim v-claim--${item.status}">${esc(shortConcept(item.concept))}.${esc(item.ability)} ${esc(item.status)}</span>`)
      .join('');
    return `
      <div class="n-ledger__row">
        <span class="n-ledger__id" title="${esc(row.audience)}">${esc(shortOrigin(row.audience))}</span>
        <span class="n-ledger__main">
          <span class="n-ledger__title">${esc(row.audienceName)}</span>
          <span class="n-ledger__meta"><span>${esc(row.purpose)}</span><span>${plural(row.shared.length, 'band')} shared</span><span>${plural(row.withheld.length, 'category', 'categories')} withheld</span></span>
          <span class="v-claims">${shared}</span>
        </span>
        <span class="n-ledger__end">
          <span class="n-pill n-pill--pending" data-expires="${esc(row.expiresAt)}">expires</span>
          <button class="n-btn n-btn--sm n-btn--secondary" type="button" data-copy-token="${index}">Copy token</button>
        </span>
      </div>`;
  }).join('');

  tickExpiries();
}

/* --------------------------------------------------- evidence ledger -- */

function signaturePill(signature) {
  if (signature === 'pending') return '<span class="n-pill n-pill--pending">pending</span>';
  if (signature === 'agent') return '<span class="n-pill n-pill--agent">agent assessed</span>';
  return '<span class="n-pill n-pill--durable">verified</span>';
}

function renderEvidence() {
  const receipts = vault.getReceipts();
  if (receipts.length === 0) {
    refs.evidenceLedger.innerHTML = `
      <p class="n-empty">The ledger is empty</p>
      <p class="n-panel__note">Receipts arrive from a provider through the agent, or by hand in the receipt inbox below. Every one of them is verified against the issuer list before it can move a band.</p>`;
    refs.evidenceToggle.hidden = true;
    return;
  }

  const rows = evidenceRows();
  const visible = showAllEvidence ? rows : rows.slice(0, EVIDENCE_PREVIEW);

  refs.evidenceLedger.innerHTML = visible.map((row) => {
    const entry = receipts.find((item) => item.receiptId === row.receiptId);
    const demo = entry ? vault.isSeedReceipt(entry) : false;
    const claims = row.claims
      .map((claim) => `<span class="v-claim v-claim--${esc(claim.result)}">${esc(shortConcept(claim.concept))}.${esc(claim.ability)} ${esc(claim.result)}</span>`)
      .join('');
    const effect = (row.effect || []).join('. ');
    return `
      <div class="n-ledger__row${row.signature === 'pending' ? ' n-ledger__row--flag' : ''}">
        <span class="n-ledger__id" title="${esc(row.receiptId)}">${esc(row.receiptId)}</span>
        <span class="n-ledger__main">
          <span class="n-ledger__title">${esc(row.activity)}</span>
          <span class="n-ledger__meta">
            <span>${esc(row.issuerName)}</span>
            <span>grader ${esc(row.grader)}</span>
            <span>${esc(isoDate(entry && entry.payload ? entry.payload.issuedAt : row.receivedAt))}</span>
          </span>
          <span class="v-claims">${claims}</span>
          ${effect ? `<span class="v-effect mono">${esc(effect)}</span>` : ''}
        </span>
        <span class="n-ledger__end">
          ${demo ? '<span class="n-pill n-pill--nodot v-demo">Demo seed</span>' : ''}
          ${signaturePill(row.signature)}
        </span>
      </div>`;
  }).join('');

  refs.evidenceToggle.hidden = rows.length <= EVIDENCE_PREVIEW;
  refs.evidenceToggle.textContent = showAllEvidence
    ? `Show the ${EVIDENCE_PREVIEW} newest receipts`
    : `Show all ${rows.length} receipts`;
}

/* -------------------------------------------------------------- goals -- */

function renderGoals() {
  const goals = vault.getGoals();
  if (goals.length === 0) {
    refs.goalList.innerHTML = '<p class="n-empty">No active goal</p>';
    return;
  }
  refs.goalList.innerHTML = goals.map((goal) => `
    <div class="n-ledger__row">
      <span class="n-ledger__main">
        <span class="n-ledger__title">${esc(goal.title)}</span>
        <span class="v-claims">${goal.concepts.map((id) => `<span class="v-claim">${esc(shortConcept(id))}</span>`).join('')}</span>
      </span>
      <span class="n-ledger__end">
        <button class="n-btn n-btn--sm n-btn--secondary" type="button" data-remove-goal="${esc(goal.goalId)}">Remove</button>
      </span>
    </div>`).join('');
}

/* ------------------------------------------------------------- render -- */

function render() {
  renderSummary();
  renderGraphPanel();
  renderStateTable();
  renderNeeds();
  renderDisclosures();
  renderEvidence();
  renderGoals();
}

/* ------------------------------------------------------- expiry ticks -- */

function tickExpiries() {
  const nowMs = Date.now();
  for (const pill of document.querySelectorAll('[data-expires]')) {
    const iso = pill.getAttribute('data-expires');
    const ms = Date.parse(iso);
    if (!Number.isFinite(ms)) continue;
    if (ms <= nowMs) {
      pill.className = 'n-pill n-pill--unknown';
      pill.textContent = 'expired';
    } else {
      pill.className = 'n-pill n-pill--pending';
      pill.textContent = `expires ${relTime(iso, nowMs)}`;
    }
  }
}

/* ------------------------------------------------------ consent modal -- */

function focusables() {
  return Array.from(refs.modal.querySelectorAll('button, input, [href], [tabindex]:not([tabindex="-1"])'))
    .filter((el) => !el.hasAttribute('disabled'));
}

function trapFocus(event) {
  if (!consentState) return;
  if (event.key === 'Escape') {
    event.preventDefault();
    consentState.settle({ approved: false });
    return;
  }
  if (event.key !== 'Tab') return;
  const items = focusables();
  if (items.length === 0) return;
  const first = items[0];
  const last = items[items.length - 1];
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}

/**
 * Ask the learner. Returns a promise the vault awaits before it signs
 * anything, so no token exists until a human clicks Approve.
 */
function askForConsent(request, { signal }) {
  return new Promise((resolve) => {
    /* One question at a time. A second request while the learner is reading the
     * first would swap the words under the buttons, which is the one thing a
     * consent dialog must never do. */
    if (consentState !== null) {
      resolve({ approved: false, busy: true });
      return;
    }
    const modal = refs.modal;
    $('[data-consent-title]').textContent = `${request.audienceName} asks to know`;
    $('[data-consent-origin]').textContent = request.audience;
    $('[data-consent-purpose]').textContent = `Purpose: ${request.purpose}`;
    $('[data-consent-key]').textContent = `Learner id for this site: ${request.learnerKeyId}`;
    $('[data-consent-shared]').innerHTML = request.shared.map((item) => `
      <div class="n-ledger__row">
        <span class="n-ledger__main">
          <span class="n-ledger__title">${esc(item.title)}</span>
          <span class="n-ledger__meta"><span class="mono">${esc(item.concept)}.${esc(item.ability)}</span></span>
        </span>
        <span class="n-ledger__end"><span class="${statusPill(item.status)}">${esc(item.status)}</span></span>
      </div>`).join('');
    $('[data-consent-withheld]').innerHTML = request.withheld
      .map((item) => `<li>${esc(item)}</li>`).join('');
    $('[data-consent-expiry]').textContent = `Expires in ${request.ttlMinutes} minutes`;
    refs.consentAuto.checked = false;

    const previous = document.activeElement;
    modal.hidden = false;
    refs.modalDialog.focus();

    let countdown = Math.round(consentTimeoutMs / 1000);
    const paintTimer = () => {
      refs.consentTimer.textContent = `${countdown} s to decide`;
    };
    paintTimer();
    const timer = setInterval(() => {
      countdown -= 1;
      if (countdown < 0) countdown = 0;
      paintTimer();
    }, 1000);

    const settle = (result) => {
      if (consentState === null) return;
      if (result.timedOut) toast('The disclosure request timed out. Nothing was shared.', 'warn');
      else if (result.approved) toast(`Disclosure approved for ${request.audienceName}, 30 minutes.`, 'ok');
      else toast('Disclosure denied. Nothing was shared.', 'info');
      consentState = null;
      clearInterval(timer);
      modal.hidden = true;
      document.removeEventListener('keydown', trapFocus, true);
      refs.consentApprove.removeEventListener('click', onApprove);
      refs.consentDeny.removeEventListener('click', onDeny);
      if (previous && typeof previous.focus === 'function') previous.focus();
      resolve(result);
    };

    function onApprove() {
      settle({ approved: true, autoApprove: refs.consentAuto.checked });
    }
    function onDeny() {
      settle({ approved: false });
    }

    consentState = { settle };
    refs.consentApprove.addEventListener('click', onApprove);
    refs.consentDeny.addEventListener('click', onDeny);
    document.addEventListener('keydown', trapFocus, true);
    signal.addEventListener('abort', () => settle({ approved: false, timedOut: true }), { once: true });
  });
}

/* -------------------------------------------------------------- inbox -- */

function describeToken(token) {
  try {
    const { payload } = decodeToken(token);
    if (payload && payload.type === 'evidence-receipt') {
      return {
        issuerName: vault.issuerName(payload),
        activity: payload.activity ? payload.activity.title : 'an activity'
      };
    }
  } catch {
    /* An unreadable token is still allowed into the box: staging names why. */
  }
  return null;
}

/* A claim lifts every ability below it, so the box names the highest one that
 * moved for each concept and counts the rest. */
function condenseChanges(changes) {
  const best = new Map();
  for (const change of changes || []) {
    const rank = ABILITIES.indexOf(change.ability);
    const held = best.get(change.concept);
    if (!held || rank > held.rank) best.set(change.concept, { change, rank, lower: (held ? held.lower + 1 : 0) });
    else best.set(change.concept, { ...held, lower: held.lower + 1 });
  }
  return [...best.values()].map((entry) => ({ ...entry.change, lower: entry.lower }));
}

function showInboxResult(result) {
  const box = refs.inboxResult;
  if (!result) {
    box.innerHTML = '';
    return;
  }
  if (result.status === 'accepted') {
    const condensed = condenseChanges(result.changes);
    const changes = condensed.length > 0
      ? condensed.map((change) => `<li class="mono">${esc(shortConcept(change.concept))}.${esc(change.ability)} ${esc(change.from)} to ${esc(change.to)}${change.lower > 0 ? `, with ${plural(change.lower, 'ability', 'abilities')} below it on the ladder` : ''}</li>`).join('')
      : '<li class="mono">no band moved, the evidence is recorded</li>';
    const reviews = result.reviewsScheduled.length > 0
      ? `<p class="mono dim">next review ${esc(relTime(result.reviewsScheduled[0].nextReview))} for ${esc(shortConcept(result.reviewsScheduled[0].concept))}</p>`
      : '';
    box.innerHTML = `
      <div class="v-result__box v-result__box--ok">
        <p><b>Accepted.</b> Signature verified against ${esc(result.issuerName)}, receipt ${esc(result.receiptId)}.</p>
        <ul class="v-result__list">${changes}</ul>
        ${reviews}
      </div>`;
    return;
  }
  if (result.status === 'pending') {
    box.innerHTML = `
      <div class="v-result__box v-result__box--warn">
        <p><b>Stored as pending.</b> ${esc(result.issuer || 'That issuer')} is not in the trusted issuer list, so nothing moved. The receipt is in the ledger with a pending badge.</p>
      </div>`;
    return;
  }
  const reasons = {
    'bad-signature': 'The signature does not match the issuer key. Nothing changed.',
    duplicate: 'This receipt is already in the ledger. Nothing changed.',
    malformed: 'That is not a readable nema receipt token. Nothing changed.'
  };
  box.innerHTML = `
    <div class="v-result__box v-result__box--bad">
      <p><b>Rejected: ${esc(result.reason)}.</b> ${esc(reasons[result.reason] || 'Nothing changed.')}</p>
    </div>`;
}

async function stageFromInbox() {
  const token = refs.inboxToken.value.trim();
  if (token === '') {
    showInboxResult({ status: 'rejected', reason: 'malformed' });
    return;
  }
  const result = await vault.stageReceipt(token, { source: 'manual' });
  showInboxResult(result);
  if (result.status === 'accepted') {
    refs.inboxToken.value = '';
    refs.inboxNote.hidden = true;
    /* A staged receipt should not come back on the next reload, so the token
     * leaves the address bar once it is in the ledger. */
    if (location.hash.startsWith('#receipt=')) {
      history.replaceState(null, '', location.pathname + location.search);
    }
    toast(`Receipt accepted. ${result.changes.length} band${result.changes.length === 1 ? '' : 's'} moved.`, 'ok');
  } else if (result.status === 'pending') {
    toast('Receipt stored as pending: unknown issuer.', 'warn');
  } else {
    toast(`Receipt rejected: ${result.reason}.`, 'error');
  }
  flash('evidence', `inbox ${result.status}`);
}

function readHashReceipt() {
  const match = /^#receipt=(.+)$/.exec(location.hash || '');
  if (!match) return;
  let token = match[1];
  try {
    token = decodeURIComponent(token);
  } catch {
    /* A hash that is not percent encoded is used as it stands. */
  }
  refs.inboxToken.value = token;
  const described = describeToken(token);
  refs.inboxNote.hidden = false;
  refs.inboxNote.textContent = described
    ? `A receipt arrived from ${described.issuerName} for "${described.activity}". Nothing has been staged yet. Read it, then press Stage receipt.`
    : 'A token arrived in the page address. Nothing has been staged yet. Read it, then press Stage receipt.';
  showInboxResult(null);
  const calm = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  refs.inboxNote.scrollIntoView({ block: 'center', behavior: calm ? 'auto' : 'smooth' });
  refs.stageButton.focus();
}

/* ---------------------------------------------------------- highlight -- */

function flash(panel, note) {
  const id = PANEL_IDS[panel];
  if (!id) return;
  const heading = document.getElementById(id);
  const section = heading ? heading.closest('.n-panel') : null;
  if (!section) return;

  section.classList.remove('v-flash');
  /* Restart the flash even when the same panel is touched twice in a row. */
  void section.offsetWidth;
  section.classList.add('v-flash');
  setTimeout(() => section.classList.remove('v-flash'), 1400);

  if (!note) return;
  let readout = heading.querySelector('.v-read');
  if (!readout) {
    readout = document.createElement('span');
    readout.className = 'v-read mono';
    heading.appendChild(readout);
  }
  readout.textContent = note;
}

/* --------------------------------------------------------------- boot -- */

function collectRefs() {
  refs.summaryStats = $('[data-summary-stats]');
  refs.summaryLine = $('[data-summary-line]');
  refs.graph = $('[data-graph]');
  refs.graphDetail = $('[data-graph-detail]');
  refs.graphLegend = $('[data-graph-legend]');
  refs.stateTable = $('[data-state-table]');
  refs.needsForm = $('[data-needs-form]');
  refs.budgetInput = $('#budget-minutes');
  refs.needsList = $('[data-needs-list]');
  refs.disclosureLedger = $('[data-disclosure-ledger]');
  refs.evidenceLedger = $('[data-evidence-ledger]');
  refs.evidenceToggle = $('[data-action="toggle-evidence"]');
  refs.goalForm = $('[data-goal-form]');
  refs.goalList = $('[data-goal-list]');
  refs.goalStatus = $('[data-goal-status]');
  refs.inboxToken = $('[data-inbox-token]');
  refs.inboxNote = $('[data-inbox-note]');
  refs.inboxResult = $('[data-inbox-result]');
  refs.stageButton = $('[data-action="stage"]');
  refs.activity = $('[data-activity-strip]');
  refs.toolsList = $('[data-tools-list]');
  refs.toolsMode = $('[data-tools-mode]');
  refs.importFile = $('[data-import-file]');
  refs.modal = $('#consent-modal');
  refs.modalDialog = refs.modal.querySelector('.n-modal__dialog');
  refs.consentApprove = $('[data-consent-approve]');
  refs.consentDeny = $('[data-consent-deny]');
  refs.consentAuto = $('[data-consent-auto]');
  refs.consentTimer = $('[data-consent-timer]');
}

function wireActions() {
  document.addEventListener('click', async (event) => {
    const button = event.target.closest('[data-action], [data-remove-goal], [data-copy-token], [data-stop-auto]');
    if (!button) return;

    const removeGoal = button.getAttribute('data-remove-goal');
    if (removeGoal) {
      vault.removeGoal(removeGoal);
      toast('Goal removed.', 'info');
      return;
    }

    const stopAuto = button.getAttribute('data-stop-auto');
    if (stopAuto) {
      vault.clearAutoApproval(stopAuto);
      toast('Auto approval stopped. The next request will ask you again.', 'info');
      return;
    }

    const copyToken = button.getAttribute('data-copy-token');
    if (copyToken !== null) {
      const disclosure = vault.getDisclosures().slice().reverse()[Number(copyToken)];
      await copyToClipboard(disclosure ? disclosure.token : '', button);
      return;
    }

    const action = button.getAttribute('data-action');
    if (action === 'load-demo') {
      button.disabled = true;
      button.textContent = 'Verifying receipts';
      try {
        const result = await vault.loadDemoSeed();
        toast(`Demo learner loaded: ${plural(result.added, 'receipt')} verified.`, 'ok');
        flash('evidence', 'demo seed imported');
      } catch (err) {
        toast('Could not load the demo learner.', 'error');
        console.warn('[nema] seed import failed:', err);
      } finally {
        button.disabled = false;
        button.textContent = 'Load demo learner';
      }
      return;
    }

    if (action === 'export') {
      const blob = new Blob([vault.exportJson()], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `nema-vault-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      toast('Vault exported. The file holds your private key, keep it to yourself.', 'info');
      return;
    }

    if (action === 'import') {
      refs.importFile.click();
      return;
    }

    if (action === 'reset') {
      const ok = window.confirm('Reset the vault? Every receipt, goal and disclosure in this browser is deleted and a new vault key is generated. This cannot be undone.');
      if (!ok) return;
      await vault.reset();
      showInboxResult(null);
      toast('Vault reset. A new key pair was generated.', 'info');
      return;
    }

    if (action === 'stage') {
      await stageFromInbox();
      return;
    }

    if (action === 'clear-inbox') {
      refs.inboxToken.value = '';
      refs.inboxNote.hidden = true;
      showInboxResult(null);
      return;
    }

    if (action === 'toggle-evidence') {
      showAllEvidence = !showAllEvidence;
      renderEvidence();
    }
  });

  refs.importFile.addEventListener('change', async () => {
    const file = refs.importFile.files && refs.importFile.files[0];
    if (!file) return;
    const text = await file.text();
    const result = await vault.importJson(text);
    refs.importFile.value = '';
    if (result.status === 'ok') {
      toast(`Vault imported: ${plural(result.receipts, 'receipt')}.`, 'ok');
    } else {
      toast(`Import rejected: ${result.reason}.`, 'error');
    }
  });

  refs.needsForm.addEventListener('submit', (event) => {
    event.preventDefault();
    renderNeeds();
    flash('needs', `planned for ${currentBudget() || 0} minutes`);
  });

  refs.goalForm.addEventListener('submit', (event) => {
    event.preventDefault();
    const data = new FormData(refs.goalForm);
    const title = String(data.get('title') || '');
    const raw = String(data.get('concepts') || '');
    const ids = raw.split(',').map((value) => value.trim()).filter(Boolean);

    /* The declarative WebMCP contract decorates the submit event from another
     * listener, so the work waits one tick: by then `agentInvoked` and
     * `respondWith` are there to be read. An agent submit is routed through the
     * canonical imperative tool, which is what times it and puts it in the
     * activity strip. A person pressing the button writes to the vault
     * directly, because a click by a human is not a tool call. */
    setTimeout(async () => {
      let result;
      if (event.agentInvoked) {
        const tools = await document.modelContext.getTools();
        const tool = tools.find((entry) => entry.name === 'set_learning_goal');
        result = tool
          ? await document.modelContext.executeTool(tool, { title, concepts: ids })
          : vault.addGoal({ title, concepts: ids });
      } else {
        result = vault.addGoal({ title, concepts: ids });
      }

      if (result.status === 'ok') {
        refs.goalStatus.textContent = `Goal set over ${plural(result.concepts.length, 'concept')}.`;
        /* Resetting the form would cancel a declarative tool call: the WebMCP
         * form contract reads a reset as "the human backed out". After an agent
         * submit the fields stay filled, which also shows what it asked for. */
        if (!event.agentInvoked) refs.goalForm.reset();
        flash('goals', 'goal set');
      } else {
        refs.goalStatus.textContent = result.error || 'That goal could not be set.';
      }
      if (typeof event.respondWith === 'function') event.respondWith(result);
    }, 0);
  });

  document.addEventListener('nema:vault-staged', (event) => showInboxResult(event.detail));
  document.addEventListener('nema:vault-change', () => render());
  document.addEventListener('nema:vault-highlight', (event) => {
    flash(event.detail.panel, event.detail.note);
  });
  document.addEventListener('nema:vault-needs', (event) => {
    renderNeeds(event.detail.needs, event.detail.budgetMinutes);
    if (event.detail.budgetMinutes) refs.budgetInput.value = String(event.detail.budgetMinutes);
  });
  window.addEventListener('hashchange', readHashReceipt);
}

async function boot() {
  injectHeader({ app: 'vault', title: 'Vault' });
  injectFooter({ note: 'Your vault, your key, your call.' });
  collectRefs();

  await vault.init();
  consentTimeoutMs = vault.CONSENT_TIMEOUT_MS;
  vault.setConsentHandler(askForConsent);

  render();
  mountActivityStrip(refs.activity);
  wireActions();

  const registered = await register();
  refs.toolsList.textContent = `${registered.length} tools plus 1 form`;
  refs.toolsMode.textContent = isNative() ? 'native WebMCP' : 'WebMCP polyfill';

  readHashReceipt();
  setInterval(tickExpiries, 1000);
}

boot().catch((err) => {
  console.error('[nema] vault failed to start:', err);
  toast('The vault could not start. Check the console.', 'error');
});
