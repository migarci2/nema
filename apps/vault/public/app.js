/* nema vault: the screen.
 *
 * app.js owns rendering and the two human affordances an agent can never have:
 * the consent modal and the manual receipt inbox. Every number on this page is
 * derived from the receipt ledger by /shared/inference.js when it is drawn, so
 * a reload can never show a band that evidence does not support.
 */

import { injectHeader, injectFooter, toast, copyToClipboard, escapeHtml } from '/shared/brand/brand.js';
import { ORIGINS } from '/shared/origins.js';
import { mountActivityStrip, isNative } from '/shared/webmcp.js';
import { ABILITIES, bestBand } from '/shared/inference.js';
import { decodeToken } from '/shared/protocol.js';
import * as vault from '/vault.js';
import { renderGraph } from '/graph.js';
import { register, evidenceRows, disclosureRows } from '/tools.js';

const esc = escapeHtml;
const DAY_MS = 86400000;
const EVIDENCE_PREVIEW = 3;
const STATE_PREVIEW = 10;

const BANDS = ['durable', 'usable', 'fragile', 'uncertain', 'unknown'];
const BAND_RANK = { unknown: 0, uncertain: 1, fragile: 2, usable: 3, durable: 4 };
const PANEL_IDS = {
  summary: 'p-summary',
  graph: 'p-graph',
  state: 'p-state',
  needs: 'p-needs',
  disclosures: 'p-disclosures',
  evidence: 'p-evidence',
  alignments: 'p-alignments',
  goals: 'p-goals',
  inbox: 'p-inbox',
  share: 'p-share'
};

const refs = {};
let showAllEvidence = false;
let showAllState = false;
let showRejectedAlignments = false;
let consentState = null;
let consentTimeoutMs = 120000;
let shareToken = '';

/* --------------------------------------------------------- utilities -- */

function $(selector) {
  return document.querySelector(selector);
}

/* A band is a dot and a word. Pills are kept for the few states that carry a
 * decision: requirement status, receipt signature, disclosure expiry. */
function bandChip(band, label) {
  const known = BANDS.includes(band) ? band : 'unknown';
  return `<span class="v-band v-band--${known}">${esc(label || band)}</span>`;
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

/* --------------------------------------------------- under the hood -- */

/* Contract section 26. Ids, keys, signatures and tokens never appear on the
 * normal path: every panel that holds any of them holds one closed block, and
 * these three helpers are the only way anything gets written into it. */

function underLine(key, value) {
  if (value === undefined || value === null || value === '') return '';
  return `<p class="n-under__row"><span class="n-under__key">${esc(key)}</span>${esc(String(value))}</p>`;
}

function underList(items) {
  if (items.length === 0) return '<p class="n-under__row">Nothing yet.</p>';
  return `<ul class="n-under__list">${items.map((item) => `<li>${item}</li>`).join('')}</ul>`;
}

function paintUnder(ref, html) {
  if (ref) ref.innerHTML = html;
}

/* ----------------------------------------------------------- wording -- */

/** `knife-skills` reads as `knife skills`, whoever named it. */
function humanName(id) {
  return shortConcept(id).replace(/[-_]/g, ' ');
}

/**
 * A concept in words. A registry concept is its title; a name a site made up
 * for itself is that site's own words, in quotes, so the two can never be
 * mistaken for each other and neither reads as an id.
 */
function conceptWords(id) {
  const raw = String(id || '');
  if (vault.getConcept(raw)) return vault.conceptTitle(raw);
  return `"${humanName(raw)}"`;
}

/** The site as a person would name it: its own name, or its domain. */
function siteWords(origin) {
  const name = vault.audienceName(origin);
  return name === origin ? shortOrigin(origin) : name;
}

/* Why a site is asking, in words. Every purpose nema ships is a personalise
 * request, which is one sentence in the learner's language; anything else is
 * at least read as words rather than as a machine string. */
function purposeWords(purpose) {
  const raw = String(purpose || '').trim();
  if (raw === '') return 'to adapt what it shows you';
  if (/^personalize|^personalise|path|unlock/i.test(raw)) return 'to skip what you already know';
  if (/hand-delivered/i.test(raw)) return 'to skip what you already know';
  return `for ${humanize(raw.replace(/-/g, ' '))}`;
}

/* ------------------------------------------------------------ summary -- */

function renderSummary() {
  const { summary } = vault.derived();
  const receipts = vault.getReceipts();
  const pending = receipts.filter((entry) => entry.status === 'pending').length;
  const agent = receipts.filter((entry) => entry.payload && entry.payload.keyId === 'agent').length;

  /* Four numbers, and only numbers that move while the demo runs. "Verified"
   * is the protocol word for a band a provider would accept: usable or
   * durable. */
  const stats = [
    { value: summary.concepts, label: 'concepts with evidence' },
    { value: summary.durable + summary.usable, label: 'verified' },
    { value: summary.fragile, label: 'fragile' },
    { value: summary.reviewsDue, label: 'reviews due', className: summary.reviewsDue > 0 ? 'n-stat v-stat--due' : 'n-stat' }
  ];

  refs.summaryStats.innerHTML = stats.map((stat) => `
    <div class="${stat.className || 'n-stat'}">
      <span class="n-stat__value">${stat.value}</span>
      <span class="n-stat__label">${esc(stat.label)}</span>
    </div>`).join('');

  if (receipts.length === 0) {
    refs.summaryLine.textContent = 'No receipts yet.';
  } else {
    const held = [`${plural(receipts.length, 'receipt')} held`];
    if (agent > 0) held.push(`${agent} agent assessed`);
    if (pending > 0) held.push(`${pending} pending`);
    refs.summaryLine.textContent = `${held.join(', ')}. ${plural(vault.getGoals().length, 'goal')}, ${plural(vault.getDisclosures().length, 'disclosure')}.`;
  }

  /* The primary button has one job, and it is done once evidence is in. */
  refs.demoButton.hidden = receipts.length > 0;
}

/* -------------------------------------------------------------- graph -- */

/* The graph draws the concepts the learner has touched plus whatever an active
 * goal points at. The rest of the registry is not part of this learner's
 * picture, so it is not drawn. */
function graphConcepts(state) {
  const wanted = new Set(Object.keys(state));
  for (const goal of vault.getGoals()) {
    for (const id of goal.concepts || []) wanted.add(id);
  }
  return vault.getConcepts().filter((entry) => wanted.has(entry.id));
}

function renderGraphPanel() {
  const { state } = vault.derived();
  const concepts = graphConcepts(state);

  if (concepts.length === 0) {
    refs.graph.innerHTML = '<p class="n-empty">The graph draws itself once the vault holds evidence.</p>';
    refs.graphLegend.innerHTML = '';
    refs.graphDetail.innerHTML = '';
    return;
  }

  renderGraph(refs.graph, { concepts, state, onSelect: showGraphDetail });

  const present = new Set(concepts.map((entry) => bestBand(state[entry.id] || {})));
  const anyDue = concepts.some((entry) => vault.nextReviewFor(entry.id).reviewDue);
  refs.graphLegend.innerHTML = BANDS
    .filter((band) => present.has(band))
    .map((band) => bandChip(band))
    .join('') + (anyDue ? bandChip('due', 'review due') : '');
}

function showGraphDetail(conceptId) {
  if (!conceptId) {
    refs.graphDetail.innerHTML = '';
    return;
  }
  const { state } = vault.derived();
  const abilities = state[conceptId] || {};
  const { nextReview, reviewDue } = vault.nextReviewFor(conceptId);
  const bands = ABILITIES
    .filter((ability) => abilities[ability])
    .map((ability) => bandChip(abilities[ability].band, `${ability} ${abilities[ability].band}`))
    .join('');

  refs.graphDetail.innerHTML = `
    <span class="v-graph__name">${esc(vault.conceptTitle(conceptId))}</span>
    ${bands || '<span class="v-band v-band--unknown">no evidence yet</span>'}
    ${nextReview
      ? `<span class="v-review${reviewDue ? ' v-review--due' : ''}">review ${relTime(nextReview)}</span>`
      : ''}`;
}

/* ------------------------------------------------------- state table -- */

/* One line per concept: title, best band, next review. The per ability
 * breakdown is a row you open, not a wall of pills. Reviews that are due come
 * first, then the weakest bands, because that is the order a learner acts in. */
function renderStateTable() {
  const { state, now } = vault.derived();
  const nowMs = Date.parse(now);
  const concepts = vault.getConcepts()
    .filter((entry) => state[entry.id])
    .map((entry) => ({
      concept: entry,
      band: bestBand(state[entry.id]),
      review: vault.nextReviewFor(entry.id)
    }))
    .sort((a, b) => (
      Number(b.review.reviewDue) - Number(a.review.reviewDue)
      || BAND_RANK[a.band] - BAND_RANK[b.band]
      || a.concept.title.localeCompare(b.concept.title)
    ));

  if (concepts.length === 0) {
    refs.stateTable.innerHTML = '<p class="n-empty">No evidence yet, so there is no state to derive.</p>';
    refs.stateToggle.hidden = true;
    paintUnder(refs.stateUnder, underList([]));
    return;
  }

  const visible = showAllState ? concepts : concepts.slice(0, STATE_PREVIEW);

  paintUnder(refs.stateUnder, underList(visible.map(({ concept }) => {
    const abilities = state[concept.id] || {};
    const bands = ABILITIES
      .filter((ability) => abilities[ability])
      .map((ability) => `${ability} ${abilities[ability].band}`)
      .join(', ');
    return `${esc(concept.id)} ${esc(bands)}`;
  })));

  refs.stateTable.innerHTML = visible.map(({ concept, band, review }) => {
    const abilities = state[concept.id] || {};
    const breakdown = ABILITIES
      .filter((ability) => abilities[ability])
      .map((ability) => bandChip(abilities[ability].band, `${ability} ${abilities[ability].band}`))
      .join('');
    const next = review.nextReview
      ? (review.reviewDue
        ? `<span class="v-review v-review--due v-row__review">due ${relTime(review.nextReview, nowMs)}</span>`
        : `<span class="v-review v-row__review">${relTime(review.nextReview, nowMs)}</span>`)
      : '<span class="v-review v-row__review"></span>';

    return `
      <details class="v-row" data-concept="${esc(concept.id)}">
        <summary class="v-row__head">
          <span class="v-row__title">${esc(concept.title)}</span>
          <span class="v-row__band">${bandChip(band)}</span>
          ${next}
        </summary>
        <div class="v-row__body">
          ${breakdown}
        </div>
      </details>`;
  }).join('');

  refs.stateToggle.hidden = concepts.length <= STATE_PREVIEW;
  refs.stateToggle.textContent = showAllState
    ? `Show ${STATE_PREVIEW}`
    : `Show all ${concepts.length}`;
}

/* Misconceptions are part of the learner model and are named in the fixed
 * "Not shared" list of every disclosure. Showing them here is what makes that
 * promise legible: this is the sort of thing a provider never gets to see. */
function renderMisconceptions() {
  const items = vault.getMisconceptions();
  if (items.length === 0) {
    refs.misconceptions.innerHTML = '<p class="n-empty">Nothing recorded, and these never leave the vault.</p>';
    return;
  }
  refs.misconceptions.innerHTML = `
    <ul class="v-mis">
      ${items.map((item) => `
        <li class="v-mis__row">
          <span class="v-mis__text">${esc(item.text)}</span>
          <span class="v-mis__meta">${esc(conceptWords(item.concept))}, ${esc(isoDate(item.recordedAt))}</span>
        </li>`).join('')}
    </ul>`;
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
      ? '<p class="n-empty">Nothing to plan yet.</p>'
      : '<p class="n-empty">Nothing is due inside that budget.</p>';
    return;
  }

  const minutes = needs.reduce((total, need) => total + (need.minutes || 0), 0);
  const rows = needs.map((need, index) => `
    <div class="n-path__row">
      <span class="n-path__index">${String(index + 1).padStart(2, '0')}</span>
      <span class="n-path__main">
        <span class="n-path__title">${esc(vault.conceptTitle(need.concept))}, <span class="v-need__ability">${esc(need.ability)}</span></span>
        <span class="n-path__reason">${esc((need.reason || []).map(humanize).join(', '))}${need.confusableWith ? `, against ${esc(conceptWords(need.confusableWith))}` : ''}</span>
      </span>
      <span class="n-path__minutes">${need.minutes} min</span>
    </div>${index === 0 ? selfCheck(need) : ''}`).join('');

  refs.needsList.innerHTML = `${rows}
    <p class="v-path__total">${minutes} minutes over ${plural(needs.length, 'need')}.</p>`;
}

/* The first need, answerable with no agent in the room. The rubric is the same
 * list an agent would grade against, so ticking it honestly is worth something:
 * 0.3, a self report, the weakest evidence the vault will write down. */
function selfCheck(need) {
  const rubric = Array.isArray(need.rubric) ? need.rubric : [];
  if (rubric.length === 0) return '';
  return `
    <div class="v-check" data-self-check="${esc(need.needId)}">
      <ul class="v-check__list">
        ${rubric.map((criterion, index) => `
          <li>
            <label class="n-check">
              <input type="checkbox" data-check-criterion="${index}">
              <span>${esc(criterion)}</span>
            </label>
          </li>`).join('')}
      </ul>
      <div class="row row--tight">
        <button class="n-btn n-btn--sm n-btn--secondary" type="button" data-action="self-check">Done</button>
        <span class="n-help" data-self-check-status role="status" aria-live="polite">Tick what you can already do. An agent would ask you to prove it, and that is worth more.</span>
      </div>
    </div>`;
}

/**
 * Record the ticked rubric as a self check. Nothing ticked records nothing: a
 * receipt saying the learner failed their own review is not what an empty
 * checklist means, it means they have not answered yet.
 */
async function runSelfCheck(button) {
  const box = button.closest('[data-self-check]');
  if (!box) return;
  const needId = box.getAttribute('data-self-check');
  const status = box.querySelector('[data-self-check-status]');
  const boxes = [...box.querySelectorAll('[data-check-criterion]')];
  const rubricResults = boxes.map((input) => ({
    criterion: input.parentElement.querySelector('span').textContent,
    met: input.checked
  }));

  if (!rubricResults.some((entry) => entry.met)) {
    status.textContent = 'Tick at least one thing you can already do.';
    return;
  }

  const result = await vault.recordSelfCheck({
    needId,
    rubricResults,
    note: 'Ticked by the learner in the vault, with no agent and no grader.'
  });
  if (result.status !== 'accepted') {
    status.textContent = 'That need is no longer on the list. Plan the session again.';
    return;
  }
  toast(`Self check recorded as ${result.result}, at the self report weight.`, 'ok');
  flash('evidence', 'self check recorded');
}

/* ------------------------------------------------- disclosure ledger -- */

function renderDisclosures() {
  const rows = disclosureRows();
  if (rows.length === 0) {
    refs.disclosureLedger.innerHTML = '<p class="n-empty">Nothing has left the vault.</p>';
    paintUnder(refs.disclosureUnder, underList([]));
    return;
  }

  const auto = vault.autoApprovals();
  const autoRow = auto.map((entry) => `
      <div class="v-erow v-erow--flag">
        <div class="v-erow__head">
          <span class="v-erow__title">${esc(vault.audienceName(entry.audience))} is auto approved</span>
          <span class="v-erow__meta">ends ${esc(relTime(entry.until))}</span>
          <span class="v-erow__end"><button class="n-btn n-btn--sm n-btn--secondary" type="button" data-stop-auto="${esc(entry.audience)}">Stop</button></span>
        </div>
      </div>`).join('');

  const stored = vault.getDisclosures().slice().reverse();

  /* Site, what was shared, until when. Nothing else is what left the vault. */
  refs.disclosureLedger.innerHTML = autoRow + rows.map((row, index) => {
    const shared = row.shared
      .map((item) => `<span class="v-claim v-claim--${item.status}">${esc(conceptWords(item.concept))}, ${esc(item.ability)}: ${esc(item.status)}</span>`)
      .join('');
    const viaAuto = Boolean(stored[index] && stored[index].auto);
    return `
      <details class="v-erow">
        <summary class="v-erow__head">
          <span class="v-erow__title">${esc(row.audienceName)}${viaAuto ? ', auto approved' : ''}</span>
          <span class="v-erow__meta">${plural(row.shared.length, 'band')}</span>
          <span class="v-erow__date">${esc(isoDate(row.sharedAt))}</span>
          <span class="v-erow__end"><span class="n-pill n-pill--pending" data-expires="${esc(row.expiresAt)}">expires</span></span>
        </summary>
        <div class="v-erow__body">
          <span class="v-claims">${shared}</span>
          <span class="v-effect">Asked ${esc(purposeWords(row.purpose))}. ${plural(row.withheld.length, 'category', 'categories')} withheld.</span>
        </div>
      </details>`;
  }).join('');

  paintUnder(refs.disclosureUnder, underList(rows.map((row, index) => `
    ${esc(row.audience)} ${esc(row.purpose)} until ${esc(row.expiresAt)}
    ${row.shared.map((item) => `<span class="n-under__pair">${esc(item.concept)}.${esc(item.ability)} ${esc(item.status)}</span>`).join(' ')}
    <button class="n-btn n-btn--sm n-btn--secondary" type="button" data-copy-token="${index}">Copy token</button>`)));

  tickExpiries();
}

/* --------------------------------------------------- evidence ledger -- */

/**
 * One word for what the vault could check about a row, and only one.
 *
 * "verified" is a receipt whose signature checked out against a key the vault
 * trusts; "self issued" is one signed with a key the site made for itself, and
 * it is worth a self report whatever it says; "waiting" is a receipt nothing
 * here can check yet. The tier, the grader and the signature are three facts
 * about the same question, so the row answers it once and the rest is under
 * the hood. Contract section 26.
 */
function stateWord(row) {
  if (row.signature === 'pending') return { word: 'waiting', tone: 'unknown' };
  if (row.signature === 'agent') return { word: 'agent assessed', tone: 'agent' };
  if (row.signature === 'self-check') return { word: 'self check', tone: 'agent' };
  if (row.trust === 'self') return { word: 'self issued', tone: 'uncertain' };
  return { word: 'verified', tone: 'durable' };
}

function statePill(row) {
  const { word, tone } = stateWord(row);
  return `<span class="n-pill n-pill--${tone}" data-state-word>${esc(word)}</span>`;
}

/* A claim a site wrote in its own words says what the vault reads it as, or
 * that it is still waiting for the learner to say. Contract section 23. */
function claimNote(claim) {
  if (claim.pendingAlignment) return ', a name this vault has not been taught';
  if (claim.alignedTo) return `, read as ${esc(conceptWords(claim.alignedTo))}`;
  return '';
}

/**
 * The vault writes its effect sentences in the protocol's shorthand, which is
 * what an agent reads back through `get_evidence_ledger`. The ledger on screen
 * says the same thing in words, and the shorthand stays under the hood.
 */
function effectWords(line) {
  return String(line || '')
    .replace(/^([A-Za-z0-9:_-]+)\.([a-z]+)\b/, (match, concept, ability) => {
      const id = vault.getConcept(`nema:${concept}`) ? `nema:${concept}` : concept;
      return `${conceptWords(id)}, ${ability}:`;
    })
    .replace(/waiting on an alignment for (.+)$/, (match, names) =>
      `waiting for you to say what ${names.split(', ').map((name) => `"${humanName(name)}"`).join(', ')} means`);
}

function renderEvidence() {
  const receipts = vault.getReceipts();
  if (receipts.length === 0) {
    refs.evidenceLedger.innerHTML = '<p class="n-empty">No receipts yet.</p>';
    refs.evidenceToggle.hidden = true;
    paintUnder(refs.evidenceUnder, underList([]));
    return;
  }

  const rows = evidenceRows();
  const visible = showAllEvidence ? rows : rows.slice(0, EVIDENCE_PREVIEW);

  /* Activity, who signed it, the date, one word for the state. */
  refs.evidenceLedger.innerHTML = visible.map((row) => {
    const entry = receipts.find((item) => item.receiptId === row.receiptId);
    const claims = row.claims
      .map((claim) => `<span class="v-claim v-claim--${esc(claim.result)}">${esc(conceptWords(claim.concept))}, ${esc(claim.ability)}: ${esc(claim.result)}${claimNote(claim)}</span>`)
      .join('');
    const effect = (row.effect || []).map(effectWords).join('. ');
    /* Two reasons a row asks for a look: nothing could check the signature, or
     * the vault cannot read one of the names in it yet. */
    const waiting = row.claims.some((item) => item.pendingAlignment);
    return `
      <details class="v-erow${row.signature === 'pending' || waiting ? ' v-erow--flag' : ''}">
        <summary class="v-erow__head">
          <span class="v-erow__title">${esc(row.activity)}</span>
          <span class="v-erow__meta">${esc(row.issuerName)}</span>
          <span class="v-erow__date">${esc(isoDate(entry && entry.payload ? entry.payload.issuedAt : row.receivedAt))}</span>
          <span class="v-erow__end">${statePill(row)}</span>
        </summary>
        <div class="v-erow__body">
          <span class="v-claims">${claims}</span>
          ${effect ? `<span class="v-effect">${esc(effect)}</span>` : ''}
        </div>
      </details>`;
  }).join('');

  /* The fold mirrors the rows on screen: the same receipts, in the words a
   * verifier reads. "Show all" opens both at once. */
  paintUnder(refs.evidenceUnder, underList(visible.map((row) => {
    const entry = receipts.find((item) => item.receiptId === row.receiptId);
    const payload = entry ? entry.payload : null;
    const claims = row.claims
      .map((claim) => `${esc(claim.concept)}.${esc(claim.ability)} ${esc(claim.result)}${claim.alignedTo ? ` -> ${esc(claim.alignedTo)}` : ''}`)
      .join(' ');
    return `${esc(row.receiptId)} ${esc(row.activity)}
      grader ${esc(row.grader)}${payload && payload.conditions && payload.conditions.graderVersion ? ` v${esc(payload.conditions.graderVersion)}` : ''}
      signature ${esc(row.signature)}${row.trust ? `, trust ${esc(row.trust)}` : ''}
      ${payload ? `key ${esc(payload.keyId)}` : ''}
      ${claims}`;
  })));

  refs.evidenceToggle.hidden = rows.length <= EVIDENCE_PREVIEW;
  refs.evidenceToggle.textContent = showAllEvidence
    ? `Show ${EVIDENCE_PREVIEW}`
    : `Show all ${rows.length}`;
}

/* --------------------------------------------------------- alignments -- */

/* A site says "browning-science", the registry says nema:maillard-reaction, and
 * the learner is the only one who can say those are the same thing. Proposals
 * carry the rationale and two buttons; a confirmed alignment is one quiet line;
 * a rejected one is out of the way but never deleted, because the vault holding
 * the answer is the point. */
function alignmentLine(entry) {
  const site = esc(siteWords(entry.origin));
  const own = esc(`"${humanName(entry.providerConcept)}"`);
  const registry = esc(vault.conceptTitle(entry.concept));
  if (entry.relation === 'narrower') return `${site} says ${own} is a part of ${registry}`;
  if (entry.relation === 'broader') return `${site} says ${own} covers more than ${registry}`;
  return `${site} calls ${registry} ${own}`;
}

/** The same fact for the block under the hood: the ids, as they are written. */
function alignmentRaw(entry) {
  return `${esc(entry.alignmentId)} ${esc(entry.origin)} ${esc(entry.providerConcept)} ${esc(entry.relation)} ${esc(entry.concept)} ${esc(entry.status)}`;
}

/* Names a receipt in the ledger used and this vault cannot read. They are the
 * reason the panel exists, so they are what it shows when there is nothing else
 * in it: a word, who signed it, and one button to say what it means. */
function waitingNames() {
  const out = new Map();
  for (const entry of vault.getReceipts()) {
    if (!entry.payload || !Array.isArray(entry.claims)) continue;
    const origin = entry.payload.issuer;
    for (const note of entry.claims) {
      if (!note.pendingAlignment) continue;
      const key = `${origin}|${note.concept}`;
      if (!out.has(key)) out.set(key, { origin, name: note.concept, receipts: new Set() });
      out.get(key).receipts.add(entry.receiptId);
    }
  }
  return [...out.values()].map((entry) => ({ ...entry, receipts: entry.receipts.size }));
}

function waitingRow(entry) {
  return `
    <div class="v-align v-align--waiting">
      <p class="v-align__claim">${esc(siteWords(entry.origin))} says "${esc(humanName(entry.name))}", and nobody has said what it means</p>
      <p class="v-align__why">It signed ${plural(entry.receipts, 'receipt')} with that name, so until you say what it means ${entry.receipts === 1 ? 'it counts' : 'they count'} for nothing. An agent can propose it, or you can say it yourself.</p>
      <div class="row row--tight">
        <button class="n-btn n-btn--sm n-btn--secondary" type="button" data-align-name="${esc(entry.origin)}" data-align-word="${esc(entry.name)}">Say what it means</button>
      </div>
    </div>`;
}

function renderAlignments() {
  const all = vault.getAlignments();
  const waiting = waitingNames().map(waitingRow).join('');
  paintUnder(refs.alignmentUnder, underList(all.map(alignmentRaw)));
  if (all.length === 0) {
    refs.alignmentList.innerHTML = waiting || '<p class="n-empty">No site has asked to be understood yet.</p>';
    return;
  }

  const proposed = all.filter((entry) => entry.status === 'proposed');
  const confirmed = all.filter((entry) => entry.status === 'confirmed');
  const rejected = all.filter((entry) => entry.status === 'rejected');

  const proposedRows = proposed.map((entry) => `
    <div class="v-align v-align--proposed" data-alignment="${esc(entry.alignmentId)}">
      <p class="v-align__claim">${alignmentLine(entry)}</p>
      <p class="v-align__why">${esc(entry.rationale || 'No reason given.')}</p>
      <p class="v-align__meta">proposed by the ${esc(entry.proposedBy)}</p>
      <div class="row row--tight">
        <button class="n-btn n-btn--sm n-btn--primary" type="button" data-confirm-alignment="${esc(entry.alignmentId)}">Confirm</button>
        <button class="n-btn n-btn--sm n-btn--secondary" type="button" data-reject-alignment="${esc(entry.alignmentId)}">Reject</button>
      </div>
    </div>`).join('');

  const confirmedRows = confirmed.map((entry) => `
    <div class="v-align" data-alignment="${esc(entry.alignmentId)}">
      <p class="v-align__claim">${alignmentLine(entry)}
        <span class="v-align__meta">${entry.proposedBy === 'provider' ? 'declared by the site' : `you confirmed this${entry.proposedBy === 'learner' ? '' : ', an agent proposed it'}`}</span>
        <button class="v-text-btn" type="button" data-reject-alignment="${esc(entry.alignmentId)}">Undo</button>
      </p>
    </div>`).join('');

  const rejectedRows = rejected.length === 0 ? '' : `
    <details class="v-align__more"${showRejectedAlignments ? ' open' : ''}>
      <summary class="v-more__summary">More: ${plural(rejected.length, 'rejected name')}</summary>
      ${rejected.map((entry) => `
        <div class="v-align" data-alignment="${esc(entry.alignmentId)}">
          <p class="v-align__claim v-align__claim--off">${alignmentLine(entry)}
            <button class="v-text-btn" type="button" data-confirm-alignment="${esc(entry.alignmentId)}">Confirm after all</button>
          </p>
        </div>`).join('')}
    </details>`;

  refs.alignmentList.innerHTML = waiting + proposedRows + confirmedRows + rejectedRows;
}

/**
 * The learner naming a concept themselves, with no agent in the room. It is
 * stored as `proposedBy: 'learner'` and confirmed in the same breath, because
 * the person doing the proposing is the person who decides.
 */
function alignByHand() {
  const data = new FormData(refs.alignForm);
  const result = vault.proposeAlignment({
    origin: String(data.get('origin') || '').trim(),
    providerConcept: String(data.get('providerConcept') || '').trim(),
    concept: String(data.get('concept') || '').trim(),
    relation: String(data.get('relation') || 'equivalent'),
    rationale: 'You said so, in the vault.',
    proposedBy: 'learner'
  });

  if (result.status === 'error') {
    refs.alignStatus.textContent = result.error;
    return;
  }
  if (result.status === 'exists') {
    refs.alignStatus.textContent = `That name is already ${result.current.status} as ${result.current.concept}.`;
    return;
  }

  const confirmed = vault.confirmAlignment(result.alignmentId);
  const moved = confirmed.changes.length;
  refs.alignStatus.textContent = '';
  refs.alignForm.reset();
  refs.alignBox.open = false;
  toast(moved > 0
    ? `Aligned. ${plural(moved, 'band')} moved from evidence already in the vault.`
    : 'Aligned. Nothing to move yet.', 'ok');
  flash(moved > 0 ? 'state' : 'alignments', 'aligned by hand');
}

/* -------------------------------------------------------------- goals -- */

function renderGoals() {
  const goals = vault.getGoals();
  if (goals.length === 0) {
    refs.goalList.innerHTML = '<p class="n-empty">No active goal.</p>';
    return;
  }
  refs.goalList.innerHTML = goals.map((goal) => `
    <div class="v-erow">
      <div class="v-erow__head">
        <span class="v-erow__title">${esc(goal.title)}</span>
        <span class="v-erow__end">
          <button class="v-text-btn" type="button" data-remove-goal="${esc(goal.goalId)}">Remove</button>
        </span>
      </div>
      <div class="v-erow__body">
        <span class="v-claims">${goal.concepts.map((id) => `<span class="v-claim">${esc(conceptWords(id))}</span>`).join('')}</span>
      </div>
    </div>`).join('');
}

/* ------------------------------------------------------------- render -- */

function render() {
  renderSummary();
  renderGraphPanel();
  renderStateTable();
  renderMisconceptions();
  renderNeeds();
  renderDisclosures();
  renderEvidence();
  renderAlignments();
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
    $('[data-consent-purpose]').textContent = `${request.audienceName} is asking ${purposeWords(request.purpose)}.`;
    /* What the site would learn, in the words the learner uses for it. The ids
     * it asked with, and the pseudonym it would be answered under, are under
     * the hood. Contract section 26. */
    $('[data-consent-shared]').innerHTML = request.shared.map((item) => `
      <div class="n-ledger__row">
        <span class="n-ledger__main">
          <span class="n-ledger__title">${esc(consentTitle(item))}, ${esc(item.ability)}</span>
          <span class="n-ledger__meta">${item.reason === 'unaligned'
            ? 'a name this vault has not been taught, so it can only answer missing'
            : item.alignedTo
              ? `their name for ${esc(conceptWords(item.alignedTo))}, and how sure your vault is`
              : 'how sure your vault is, and nothing else'}</span>
        </span>
        <span class="n-ledger__end"><span class="${statusPill(item.status)}">${esc(item.status)}</span></span>
      </div>`).join('');
    $('[data-consent-withheld]').innerHTML = request.withheld
      .map((item) => `<li>${esc(item)}</li>`).join('');
    $('[data-consent-expiry]').textContent = `They can use this answer for the next ${request.ttlMinutes} minutes`;
    paintUnder($('[data-consent-under]'), [
      underLine('purpose', request.purpose),
      underLine('learner id', request.learnerKeyId),
      underList(request.shared.map((item) => `${esc(item.concept)}.${esc(item.ability)} ${esc(item.status)}${item.alignedTo ? ` read from ${esc(item.alignedTo)}` : ''}`))
    ].join(''));
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


/* A site that asked in its own words is answered in its own words, and the
 * modal says so the same way: the site's name, then what the vault read it
 * as. Contract sections 23 and 26. */
function consentTitle(item) {
  if (item.alignedTo || item.reason === 'unaligned') return `"${humanName(item.concept)}"`;
  return item.title;
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

/* What the tier means, in the learner's words, for the receipt just staged. */
function trustNote(result) {
  if (result.trust === 'self') {
    return `<p>${esc(result.issuerName)} signed this with a key it made for itself, so it counts as a self report.</p>`;
  }
  if (result.trust === 'origin') {
    return `<p>${esc(result.issuerName)} publishes that key on its own domain, so the whole of it counts.</p>`;
  }
  return '';
}

function showInboxResult(result) {
  const box = refs.inboxResult;
  if (!result) {
    box.innerHTML = '';
    paintUnder(refs.inboxUnder, '');
    return;
  }
  if (result.status === 'accepted') {
    const condensed = condenseChanges(result.changes);
    const changes = condensed.length > 0
      ? condensed.map((change) => `<li>${esc(conceptWords(change.concept))}, ${esc(change.ability)}: ${esc(change.from)} to ${esc(change.to)}${change.lower > 0 ? `, with ${plural(change.lower, 'ability', 'abilities')} below it on the ladder` : ''}</li>`).join('')
      : '<li>nothing moved, and the work is on file</li>';
    const reviews = result.reviewsScheduled.length > 0
      ? `<p>Next review ${esc(relTime(result.reviewsScheduled[0].nextReview))} for ${esc(conceptWords(result.reviewsScheduled[0].concept))}.</p>`
      : '';
    /* A claim in words this vault has not been taught is not a rejection and
     * not a silence: the receipt is kept, and the learner is told what would
     * make it count. Contract section 23. */
    const waiting = Array.isArray(result.pendingAlignment) && result.pendingAlignment.length > 0
      ? `<p>${esc(result.pendingAlignment.map((name) => `"${humanName(name)}"`).join(', '))} ${result.pendingAlignment.length === 1 ? 'is a name' : 'are names'} this site uses and nobody has said what ${result.pendingAlignment.length === 1 ? 'it means' : 'they mean'}, so ${result.pendingAlignment.length === 1 ? 'that claim' : 'those claims'} moved nothing. Say so under Alignments and this receipt starts counting.</p>`
      : '';
    box.innerHTML = `
      <div class="v-result__box v-result__box--ok">
        <p><b>${esc(result.issuerName)} signed what you did. Verified.</b></p>
        ${trustNote(result)}
        ${waiting}
        <ul class="v-result__list">${changes}</ul>
        ${reviews}
      </div>`;
    paintUnder(refs.inboxUnder, [
      underLine('receipt', result.receiptId),
      underLine('issuer', result.issuer),
      underLine('trust', result.trust)
    ].join(''));
    return;
  }
  if (result.status === 'pending') {
    box.innerHTML = `
      <div class="v-result__box v-result__box--warn">
        <p><b>Kept, and it counts for nothing.</b> Nothing here knows who ${esc(result.issuer || 'that site')} is, so no band moved.</p>
      </div>`;
    paintUnder(refs.inboxUnder, underLine('issuer', result.issuer) + underLine('reason', result.reason));
    return;
  }
  const reasons = {
    'bad-signature': 'The signature does not match the site it says signed it.',
    duplicate: 'This is already in your ledger.',
    malformed: 'That is not something this vault can read.'
  };
  box.innerHTML = `
    <div class="v-result__box v-result__box--bad">
      <p><b>Not kept.</b> ${esc(reasons[result.reason] || 'Nothing changed.')}</p>
    </div>`;
  paintUnder(refs.inboxUnder, underLine('reason', result.reason));
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
    toast(`Kept in your vault. ${result.changes.length} band${result.changes.length === 1 ? '' : 's'} moved.`, 'ok');
  } else if (result.status === 'pending') {
    toast('Kept, but nothing here knows who signed it, so nothing moved.', 'warn');
  } else if (result.reason === 'duplicate') {
    toast('That one is already in your vault.', 'info');
  } else {
    toast('Not kept. Your vault could not read that.', 'error');
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
    ? `${described.issuerName} sent a receipt for "${described.activity}". Press Stage receipt to keep it.`
    : 'A receipt arrived in the page address. Press Stage receipt to keep it.';
  showInboxResult(null);
  /* The receipt arrived by hand, so the block that takes it by hand opens. */
  if (refs.inboxBox) refs.inboxBox.open = true;
  const calm = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  refs.inboxNote.scrollIntoView({ block: 'center', behavior: calm ? 'auto' : 'smooth' });
  refs.stageButton.focus();
}

/* -------------------------------------------------------------- share -- */

/**
 * Read the concept box: "nema:knife-skills:apply, heat-control.explain".
 *
 * A concept id carries a colon of its own, so the ability is whatever follows
 * the last colon or dot, and a bare id is read as a nema id. Returns the
 * requirements, or an error string naming the entry that could not be read.
 */
function parseRequirements(raw) {
  const items = String(raw || '').split(',').map((item) => item.trim()).filter(Boolean);
  if (items.length === 0) return { error: 'Name at least one concept and ability, such as nema:ratios:apply.' };

  const requirements = [];
  for (const item of items) {
    const cut = Math.max(item.lastIndexOf(':'), item.lastIndexOf('.'));
    const ability = cut > 0 ? item.slice(cut + 1).trim() : '';
    let concept = cut > 0 ? item.slice(0, cut).trim() : '';
    if (concept && !concept.includes(':')) concept = `nema:${concept}`;
    if (!concept || !ability) {
      return { error: `"${item}" is not a concept and ability pair. Write it as nema:ratios:apply.` };
    }
    if (!ABILITIES.includes(ability)) {
      return { error: `"${ability}" is not an ability. Use one of ${ABILITIES.join(', ')}.` };
    }
    requirements.push({ concept, ability });
  }
  return { requirements };
}

function showShareResult(result) {
  const box = refs.shareResult;
  if (!result) {
    box.innerHTML = '';
    paintUnder(refs.shareUnder, '');
    shareToken = '';
    return;
  }

  if (result.status === 'approved') {
    shareToken = result.token;
    const rest = result.token.slice('nema1.'.length);
    const shared = result.shared
      .map((item) => `<span class="v-claim v-claim--${esc(item.status)}">${esc(conceptWords(item.concept))}, ${esc(item.ability)}: ${esc(item.status)}</span>`)
      .join('');
    box.innerHTML = `
      <div class="v-result__box v-result__box--ok">
        <p><b>Signed for ${esc(vault.audienceName(result.audience || refs.shareAudience.value.trim()))}.</b>
        Good for ${esc(relTime(result.expiresAt).replace(/^in /, ''))}, and only for that site.</p>
        <p class="v-share__meta"><span class="v-claims">${shared}</span></p>
        <p class="v-share__meta">Copy it under the hood and paste it into the site's box.</p>
      </div>`;
    /* The token itself is the one thing here a person never has to read. */
    paintUnder(refs.shareUnder, `
      <div class="n-token">
        <span class="n-token__head">readiness assertion<button class="n-btn n-btn--sm n-btn--secondary" type="button" data-action="copy-share">Copy</button></span>
        <p class="n-token__text" data-share-token><b>nema1.</b>${esc(rest)}</p>
      </div>`);
    return;
  }

  shareToken = '';
  paintUnder(refs.shareUnder, '');
  const lines = {
    denied: 'You said no. Nothing was shared and nothing was signed.',
    timeout: 'The request timed out. Nothing was shared.'
  };
  box.innerHTML = `
    <div class="v-result__box v-result__box--${result.status === 'denied' ? 'warn' : 'bad'}">
      <p>${esc(lines[result.status] || result.error || 'That request could not be signed.')}</p>
    </div>`;
}

/**
 * Hand delivery, no agent needed. Exactly the code path
 * `create_readiness_assertion` takes: the same request, the same consent modal,
 * the same signature, the same line in the disclosure ledger.
 */
async function shareWithSite() {
  const audience = refs.shareAudience.value.trim();
  const purpose = refs.sharePurpose.value.trim();
  const parsed = parseRequirements(refs.shareConcepts.value);

  if (parsed.error) {
    refs.shareStatus.textContent = parsed.error;
    showShareResult(null);
    return;
  }

  refs.shareStatus.textContent = 'Waiting for your approval.';
  showShareResult(null);
  const result = await vault.createAssertion({ audience, purpose, requirements: parsed.requirements });
  showShareResult(result);

  if (result.status === 'approved') {
    refs.shareStatus.textContent = `Signed for ${vault.audienceName(audience)}.`;
    flash('share', 'token signed');
  } else if (result.status === 'error') {
    refs.shareStatus.textContent = result.error;
  } else {
    refs.shareStatus.textContent = '';
  }
}

/* ---------------------------------------------------------- highlight -- */

function flash(panel, note) {
  const id = PANEL_IDS[panel];
  if (!id) return;
  const heading = document.getElementById(id);
  const section = heading ? heading.closest('.n-panel') : null;
  if (!section) return;

  /* A panel folded into "More" opens first. A tool call the learner cannot
   * see is a tool call the learner cannot check. */
  openDetailsAround(section);

  section.classList.remove('v-flash');
  /* Restart the flash even when the same panel is touched twice in a row. */
  void section.offsetWidth;
  section.classList.add('v-flash');
  setTimeout(() => section.classList.remove('v-flash'), 1400);

  if (!note) return;
  /* The summary has no visible heading, so its note sits on the section. */
  const anchor = heading.classList.contains('sr-only') ? section : heading;
  let readout = anchor.querySelector(':scope > .v-read');
  if (!readout) {
    readout = document.createElement('span');
    readout.className = 'v-read';
    anchor.appendChild(readout);
  }
  readout.textContent = note;
}

function openDetailsAround(element) {
  let node = element;
  while (node) {
    const block = node.closest('details');
    if (!block) return;
    block.open = true;
    node = block.parentElement;
  }
}

/* --------------------------------------------------------------- boot -- */

function collectRefs() {
  refs.summaryStats = $('[data-summary-stats]');
  refs.summaryLine = $('[data-summary-line]');
  refs.demoButton = $('[data-action="load-demo"]');
  refs.graph = $('[data-graph]');
  refs.graphDetail = $('[data-graph-detail]');
  refs.graphLegend = $('[data-graph-legend]');
  refs.stateTable = $('[data-state-table]');
  refs.stateToggle = $('[data-action="toggle-state"]');
  refs.stateUnder = $('[data-state-under]');
  refs.misconceptions = $('[data-misconceptions]');
  refs.needsForm = $('[data-needs-form]');
  refs.budgetInput = $('#budget-minutes');
  refs.needsList = $('[data-needs-list]');
  refs.disclosureLedger = $('[data-disclosure-ledger]');
  refs.disclosureUnder = $('[data-disclosure-under]');
  refs.evidenceLedger = $('[data-evidence-ledger]');
  refs.evidenceToggle = $('[data-action="toggle-evidence"]');
  refs.evidenceUnder = $('[data-evidence-under]');
  refs.alignmentList = $('[data-alignment-list]');
  refs.alignmentUnder = $('[data-alignment-under]');
  refs.alignForm = $('[data-align-form]');
  refs.alignBox = $('[data-align-box]');
  refs.alignStatus = $('[data-align-status]');
  refs.goalForm = $('[data-goal-form]');
  refs.goalList = $('[data-goal-list]');
  refs.goalStatus = $('[data-goal-status]');
  refs.shareForm = $('[data-share-form]');
  refs.shareAudience = $('#share-audience');
  refs.sharePurpose = $('#share-purpose');
  refs.shareConcepts = $('#share-concepts');
  refs.shareStatus = $('[data-share-status]');
  refs.shareResult = $('[data-share-result]');
  refs.shareUnder = $('[data-share-under]');
  refs.inboxToken = $('[data-inbox-token]');
  refs.inboxNote = $('[data-inbox-note]');
  refs.inboxResult = $('[data-inbox-result]');
  refs.inboxUnder = $('[data-inbox-under]');
  refs.inboxBox = $('[data-inbox-box]');
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
    const button = event.target.closest('[data-action], [data-remove-goal], [data-copy-token], [data-stop-auto], [data-confirm-alignment], [data-reject-alignment], [data-align-name]');
    if (!button) return;

    const alignName = button.getAttribute('data-align-name');
    if (alignName) {
      refs.alignBox.open = true;
      refs.alignForm.elements.origin.value = alignName;
      refs.alignForm.elements.providerConcept.value = button.getAttribute('data-align-word') || '';
      refs.alignStatus.textContent = '';
      refs.alignForm.elements.concept.focus();
      return;
    }

    /* The learner is the only one who decides what a site's name means. There
     * is no tool for these two clicks, and there never will be. */
    const confirmAlignment = button.getAttribute('data-confirm-alignment');
    if (confirmAlignment) {
      const result = vault.confirmAlignment(confirmAlignment);
      if (result.status === 'ok') {
        showRejectedAlignments = false;
        const moved = result.changes.length;
        toast(moved > 0
          ? `Alignment confirmed. ${plural(moved, 'band')} moved from evidence already in the vault.`
          : 'Alignment confirmed. Nothing to move yet.', 'ok');
        flash(moved > 0 ? 'state' : 'alignments', 'alignment confirmed');
      }
      return;
    }

    const rejectAlignment = button.getAttribute('data-reject-alignment');
    if (rejectAlignment) {
      const result = vault.rejectAlignment(rejectAlignment);
      if (result.status === 'ok') {
        showRejectedAlignments = true;
        toast(result.changes.length > 0
          ? `Rejected. ${plural(result.changes.length, 'band')} moved back.`
          : 'Rejected. That name translates nothing.', 'info');
        flash('alignments', 'alignment rejected');
      }
      return;
    }

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
    if (action === 'copy-share') {
      await copyToClipboard(shareToken, button);
      return;
    }
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

    if (action === 'self-check') {
      await runSelfCheck(button);
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
      return;
    }

    if (action === 'toggle-state') {
      showAllState = !showAllState;
      renderStateTable();
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

  refs.shareForm.addEventListener('submit', (event) => {
    event.preventDefault();
    shareWithSite();
  });

  refs.alignForm.addEventListener('submit', (event) => {
    event.preventDefault();
    alignByHand();
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

  /* The share box opens on the provider this vault is demonstrated with, and
   * on the right host: localhost while developing, the real origin in prod. */
  refs.shareAudience.value = ORIGINS.harness;

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
