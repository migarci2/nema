/* nema vault: storage, derivation and the receipt staging pipeline.
 *
 * Everything the learner owns lives in one localStorage document under
 * `nema.vault.v1`. Learner state is never stored: it is derived from the
 * receipt ledger with /shared/inference.js on every read, so the numbers on
 * screen can always be recomputed from evidence.
 *
 * This module holds no DOM. app.js renders, tools.js exposes the same calls to
 * an agent, and both go through the functions below so a tool call and a click
 * take exactly the same code path.
 */

import { ORIGINS, ORIGINS_BY_ENV, isDev } from '/shared/origins.js';
import { generateKeyPair, randomId, nowIso } from '/shared/crypto.js';
import {
  DEFAULT_TTL_MINUTES,
  SEED_ORIGIN,
  buildAssertionPayload,
  buildIssuerMap,
  buildReadinessRequest,
  buildReceiptPayload,
  inspectAssertion,
  learnerKeyId,
  signToken,
  verifyReceipt
} from '/shared/protocol.js';
import {
  ABILITIES,
  bandToConfidence,
  computeNeeds,
  deriveState,
  diffStates,
  summarize,
  toAssertionStatus
} from '/shared/inference.js';

export const STORAGE_KEY = 'nema.vault.v1';

/** The fixed list every disclosure refuses to carry. Contract section 9. */
export const WITHHELD = Object.freeze([
  'attempt history',
  'exact scores',
  'other subjects',
  'misconceptions',
  'review schedule',
  'provider history'
]);

/** How long an auto approval lasts, in milliseconds. */
const AUTO_APPROVE_MS = 60 * 60 * 1000;

/** How long the vault waits for the learner before it gives up, in ms. */
export const CONSENT_TIMEOUT_MS = 120000;

const DAY_MS = 86400000;

/** Evidence type produced by an ability, used for agent assessed receipts. */
const EVIDENCE_TYPE = {
  recognize: 'recognition',
  retrieve: 'retrieval',
  explain: 'explanation',
  apply: 'application',
  transfer: 'transfer',
  discriminate: 'discrimination'
};

/* ------------------------------------------------------------- state -- */

let doc = emptyDoc();
let concepts = [];
let conceptIndex = new Map();
let issuerMapProd = null;
let issuerMapDev = null;
let derivedCache = null;
let revision = 0;
let consentHandler = null;
let ready = false;

function emptyDoc() {
  return {
    version: 1,
    vaultKey: null,
    receipts: [],
    disclosures: [],
    goals: [],
    misconceptions: [],
    settings: { autoApprove: {} }
  };
}

function normalize(value) {
  const next = emptyDoc();
  if (!value || typeof value !== 'object') return next;
  next.version = 1;
  if (value.vaultKey && value.vaultKey.publicJwk && value.vaultKey.privateJwk) {
    next.vaultKey = value.vaultKey;
  }
  for (const key of ['receipts', 'disclosures', 'goals', 'misconceptions']) {
    if (Array.isArray(value[key])) next[key] = value[key].filter((item) => item && typeof item === 'object');
  }
  const auto = value.settings && value.settings.autoApprove;
  if (auto && typeof auto === 'object') next.settings.autoApprove = { ...auto };
  return next;
}

function announce(detail) {
  document.dispatchEvent(new CustomEvent('nema:vault-change', { detail: detail || {} }));
}

function save(detail) {
  revision += 1;
  derivedCache = null;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(doc));
  } catch (err) {
    console.warn('[nema] vault could not be written to localStorage:', err && err.message ? err.message : err);
  }
  announce(detail);
}

/* -------------------------------------------------------------- init -- */

/**
 * Load the stored document, the concept registry and the issuer registry, and
 * generate the vault key pair on first run.
 */
export async function init() {
  if (ready) return doc;

  let stored = null;
  try {
    stored = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
  } catch {
    stored = null;
  }
  doc = normalize(stored);

  const [registry, issuers] = await Promise.all([
    fetch('/shared/concepts.json').then((r) => r.json()),
    fetch('/shared/issuers.json').then((r) => r.json())
  ]);

  concepts = Array.isArray(registry) ? registry : [];
  conceptIndex = new Map(concepts.map((entry) => [entry.id, entry]));

  /* Receipts name their issuer by production origin, whichever host serves
   * this page, so issuer identity is always resolved against the prod map. The
   * dev map is only a fallback for a receipt minted by a local worker that
   * resolved its own origin from the request. */
  issuerMapProd = buildIssuerMap(issuers, ORIGINS_BY_ENV.prod);
  issuerMapDev = isDev ? buildIssuerMap(issuers, ORIGINS_BY_ENV.dev) : null;

  if (!doc.vaultKey) {
    doc.vaultKey = await generateKeyPair();
    save({ reason: 'key-created' });
  }

  ready = true;
  return doc;
}

/* ---------------------------------------------------------- registry -- */

export function getConcepts() {
  return concepts;
}

export function getConcept(id) {
  return conceptIndex.get(id) || null;
}

export function conceptTitle(id) {
  const entry = conceptIndex.get(id);
  return entry ? entry.title : shortConcept(id);
}

/** `nema:agent-evals` reads as `agent-evals` in dense rows and effect text. */
export function shortConcept(id) {
  return String(id || '').replace(/^nema:/, '');
}

export function issuerName(payload) {
  if (!payload) return 'unknown issuer';
  if (payload.keyId === 'agent') return 'nema coach agent';
  const known = (issuerMapProd && issuerMapProd[payload.keyId]) || (issuerMapDev && issuerMapDev[payload.keyId]);
  if (known) return known.name;
  return payload.issuer || 'unknown issuer';
}

export function isSeedReceipt(entry) {
  return Boolean(entry && entry.payload && entry.payload.issuer === SEED_ORIGIN);
}

export function audienceName(origin) {
  const names = {
    harness: 'Saucier School',
    security: 'Line Cook Lab',
    coach: 'nema Coach',
    site: 'nema Hub',
    vault: 'nema Vault'
  };
  for (const [app, value] of Object.entries(ORIGINS_BY_ENV.prod)) {
    if (value === origin) return names[app];
  }
  for (const [app, value] of Object.entries(ORIGINS_BY_ENV.dev)) {
    if (value === origin) return names[app];
  }
  return origin;
}

/* ----------------------------------------------------------- reading -- */

export function getDoc() {
  return doc;
}

export function getReceipts() {
  return doc.receipts;
}

export function getDisclosures() {
  return doc.disclosures;
}

export function getGoals() {
  return doc.goals;
}

export function getMisconceptions() {
  return doc.misconceptions;
}

export function getVaultPublicJwk() {
  return doc.vaultKey ? doc.vaultKey.publicJwk : null;
}

/**
 * Learner state, recomputed from the ledger. The result is memoized for 15
 * seconds against the current revision so a render pass does not derive the
 * same state six times, and never persisted.
 */
export function derived() {
  const nowMs = Date.now();
  if (derivedCache && derivedCache.revision === revision && nowMs - derivedCache.at < 15000) {
    return derivedCache.value;
  }
  const now = new Date(nowMs).toISOString();
  const state = deriveState(doc.receipts, { now });
  const value = { now, state, summary: summarize(state, { now }) };
  derivedCache = { revision, at: nowMs, value };
  return value;
}

export function getNeeds(budgetMinutes) {
  const { state, now } = derived();
  const options = {
    concepts,
    goals: doc.goals,
    misconceptions: doc.misconceptions,
    now
  };
  if (Number.isFinite(budgetMinutes) && budgetMinutes > 0) options.budgetMinutes = budgetMinutes;
  return computeNeeds(state, options);
}

/** Bands for one concept, unknown included, in ladder order. */
export function bandsFor(conceptId) {
  const { state } = derived();
  const entry = state[conceptId] || {};
  const bands = {};
  for (const ability of ABILITIES) {
    bands[ability] = entry[ability] ? entry[ability].band : 'unknown';
  }
  return bands;
}

export function nextReviewFor(conceptId) {
  const { state, now } = derived();
  const entry = state[conceptId];
  if (!entry) return { nextReview: null, reviewDue: false };
  let soonest = null;
  let due = false;
  for (const value of Object.values(entry)) {
    if (!value || !value.nextReview) continue;
    if (soonest === null || value.nextReview < soonest) soonest = value.nextReview;
    if (value.reviewDue) due = true;
  }
  return { nextReview: soonest, reviewDue: due || (soonest !== null && soonest < now) };
}

/* ---------------------------------------------------- receipt intake -- */

function seenReceiptIds() {
  return new Set(doc.receipts.map((entry) => entry.receiptId));
}

function reviewPhrase(iso, nowMs) {
  if (!iso) return 'no review scheduled';
  const days = Math.round((Date.parse(iso) - nowMs) / DAY_MS);
  if (!Number.isFinite(days)) return 'no review scheduled';
  if (days <= 0) return 'review due now';
  if (days === 1) return 'review in 1 day';
  return `review in ${days} days`;
}

/* One line per concept. A claim lifts every ability below it on the ladder, so
 * reporting all of them would bury the news: the ledger names the highest
 * ability that moved for each concept, which is the one the learner cares
 * about. The full diff still goes back to the caller in `changes`. */
function effectFor(changes, after, nowMs) {
  if (changes.length === 0) return ['no band moved, the evidence is recorded'];
  const highest = new Map();
  for (const change of changes) {
    const rank = ABILITIES.indexOf(change.ability);
    const held = highest.get(change.concept);
    if (!held || rank > held.rank) highest.set(change.concept, { change, rank });
  }
  return [...highest.values()].map(({ change }) => {
    const entry = after[change.concept] && after[change.concept][change.ability];
    const review = entry ? reviewPhrase(entry.nextReview, nowMs) : 'no review scheduled';
    return `${shortConcept(change.concept)}.${change.ability} ${change.from} to ${change.to}, ${review}`;
  });
}

function reviewsFor(payload, after) {
  const out = [];
  const seen = new Set();
  for (const claim of payload.claims || []) {
    if (seen.has(claim.concept)) continue;
    seen.add(claim.concept);
    const abilities = after[claim.concept] || {};
    let soonest = null;
    for (const value of Object.values(abilities)) {
      if (!value || !value.nextReview) continue;
      if (soonest === null || value.nextReview < soonest) soonest = value.nextReview;
    }
    if (soonest) out.push({ concept: claim.concept, nextReview: soonest });
  }
  return out;
}

/** Verify against the prod issuer registry, then the dev one in dev. */
async function verifyAgainstKnownIssuers(token, seen) {
  let result = await verifyReceipt(token, issuerMapProd, { seenReceiptIds: seen });
  if (!result.ok && result.reason === 'unknown-issuer' && issuerMapDev) {
    const local = await verifyReceipt(token, issuerMapDev, { seenReceiptIds: seen });
    if (local.ok || local.reason !== 'unknown-issuer') return local;
  }
  return result;
}

/**
 * The single staging pipeline: decode, verify, diff, record, report.
 * The manual inbox and the `stage_evidence_receipt` tool both call this.
 *
 * @param {string} token compact receipt token
 * @param {{ source?: string, demo?: boolean }} [options]
 * @returns {Promise<object>} the contract result for stage_evidence_receipt
 */
export async function stageReceipt(token, options = {}) {
  const raw = typeof token === 'string' ? token.trim() : '';
  if (!raw) return { status: 'rejected', reason: 'malformed' };

  const seen = seenReceiptIds();
  const result = await verifyAgainstKnownIssuers(raw, seen);
  const payload = result.payload || null;

  if (!result.ok && result.reason === 'unknown-issuer' && payload) {
    if (seen.has(payload.receiptId)) return { status: 'rejected', reason: 'duplicate' };
    doc.receipts.push({
      receiptId: payload.receiptId,
      token: raw,
      payload,
      status: 'pending',
      receivedAt: nowIso(),
      effect: ['no band moved, the issuer is not in the trusted list'],
      source: options.source || 'manual'
    });
    save({ reason: 'receipt-pending', receiptId: payload.receiptId });
    return {
      status: 'pending',
      reason: 'unknown-issuer',
      receiptId: payload.receiptId,
      issuer: payload.issuer,
      issuerName: issuerName(payload)
    };
  }

  if (!result.ok) {
    return { status: 'rejected', reason: result.reason };
  }

  const nowMs = Date.now();
  const now = new Date(nowMs).toISOString();
  const before = deriveState(doc.receipts, { now });
  const entry = {
    receiptId: payload.receiptId,
    token: raw,
    payload,
    status: 'verified',
    receivedAt: nowIso(),
    effect: [],
    source: options.source || 'manual'
  };
  doc.receipts.push(entry);
  const after = deriveState(doc.receipts, { now });
  const changes = diffStates(before, after);
  entry.effect = effectFor(changes, after, nowMs);
  save({ reason: 'receipt-accepted', receiptId: entry.receiptId, changes });

  return {
    status: 'accepted',
    receiptId: payload.receiptId,
    issuer: payload.issuer,
    issuerName: issuerName(payload),
    activity: payload.activity,
    claims: payload.claims,
    changes,
    reviewsScheduled: reviewsFor(payload, after)
  };
}

/* --------------------------------------------------------- demo seed -- */

/** Import `/seed.json`: a demo learner signed by the offline seed issuer. */
export async function loadDemoSeed() {
  const seed = await fetch('/seed.json').then((r) => r.json());
  const seen = seenReceiptIds();
  const nowMs = Date.now();
  const now = new Date(nowMs).toISOString();
  const first = deriveState(doc.receipts, { now });
  let before = first;

  let added = 0;
  let pending = 0;
  let skipped = 0;

  for (const token of Array.isArray(seed.receipts) ? seed.receipts : []) {
    const result = await verifyAgainstKnownIssuers(token, seen);
    const payload = result.payload;
    if (!payload || seen.has(payload.receiptId)) {
      skipped += 1;
      continue;
    }
    if (!result.ok && result.reason !== 'unknown-issuer') {
      skipped += 1;
      continue;
    }
    seen.add(payload.receiptId);
    const entry = {
      receiptId: payload.receiptId,
      token,
      payload,
      status: result.ok ? 'verified' : 'pending',
      receivedAt: nowIso(),
      effect: ['no band moved, the issuer is not in the trusted list'],
      source: 'seed'
    };
    doc.receipts.push(entry);
    if (result.ok) {
      /* Each seed receipt gets the same treatment a live one gets: the state is
       * rederived and the row says exactly what that receipt moved. */
      const step = deriveState(doc.receipts, { now });
      entry.effect = effectFor(diffStates(before, step), step, nowMs);
      before = step;
      added += 1;
    } else {
      pending += 1;
    }
  }

  const after = deriveState(doc.receipts, { now });
  const changes = diffStates(first, after);

  const goalIds = new Set(doc.goals.map((goal) => goal.goalId));
  for (const goal of Array.isArray(seed.goals) ? seed.goals : []) {
    if (!goal || goalIds.has(goal.goalId)) continue;
    doc.goals.push(goal);
    goalIds.add(goal.goalId);
  }

  const misconceptionKeys = new Set(doc.misconceptions.map((item) => `${item.concept}|${item.id}`));
  for (const item of Array.isArray(seed.misconceptions) ? seed.misconceptions : []) {
    if (!item || misconceptionKeys.has(`${item.concept}|${item.id}`)) continue;
    doc.misconceptions.push(item);
    misconceptionKeys.add(`${item.concept}|${item.id}`);
  }

  save({ reason: 'seed-loaded', changes });
  return { status: 'ok', added, pending, skipped, changes: changes.length };
}

/* ------------------------------------------------------- disclosures -- */

/**
 * Register the function that asks the learner. app.js hands over the consent
 * modal here, so this module never touches the DOM.
 *
 * @param {(request: object, context: { signal: AbortSignal }) => Promise<{approved: boolean, autoApprove?: boolean}>} handler
 */
export function setConsentHandler(handler) {
  consentHandler = handler;
}

function autoApprovedUntil(audience) {
  const until = doc.settings.autoApprove ? doc.settings.autoApprove[audience] : null;
  if (!until) return null;
  const ms = Date.parse(until);
  if (!Number.isFinite(ms) || ms <= Date.now()) return null;
  return until;
}

export function autoApprovals() {
  const out = [];
  for (const [audience, until] of Object.entries(doc.settings.autoApprove || {})) {
    if (autoApprovedUntil(audience)) out.push({ audience, until });
  }
  return out;
}

export function clearAutoApproval(audience) {
  if (doc.settings.autoApprove && doc.settings.autoApprove[audience]) {
    delete doc.settings.autoApprove[audience];
    save({ reason: 'auto-approve-cleared', audience });
  }
}

/** The exact lines a request would disclose, with the titles the modal shows. */
export function previewDisclosure(requirements) {
  const { state } = derived();
  return requirements.map((entry) => {
    const abilities = state[entry.concept] || {};
    const value = abilities[entry.ability] || null;
    const band = value ? value.band : 'unknown';
    return {
      concept: entry.concept,
      title: conceptTitle(entry.concept),
      ability: entry.ability,
      band,
      status: toAssertionStatus(band),
      confidence: value ? value.confidence : bandToConfidence(band, 0)
    };
  });
}

/**
 * Build a ReadinessAssertion after the learner approves it in the page.
 * Returns the contract result for `create_readiness_assertion`.
 */
export async function createAssertion({ audience, purpose, requirements }) {
  if (typeof audience !== 'string' || audience.trim() === '') {
    return { status: 'error', error: 'audience must be the origin of the site that is asking' };
  }
  if (typeof purpose !== 'string' || purpose.trim() === '') {
    return { status: 'error', error: 'purpose must be a short machine readable string' };
  }
  if (!Array.isArray(requirements) || requirements.length === 0) {
    return { status: 'error', error: 'requirements must list at least one concept and ability' };
  }
  for (const entry of requirements) {
    if (!entry || typeof entry.concept !== 'string' || typeof entry.ability !== 'string') {
      return { status: 'error', error: 'each requirement needs a concept and an ability' };
    }
  }

  const request = buildReadinessRequest({ audience, purpose, requirements });
  const shared = previewDisclosure(request.requirements);
  const auto = autoApprovedUntil(audience);
  /* The pseudonym this audience will see. Derived before anything is signed so
   * the learner can read it in the modal and check that it differs per site. */
  const subject = await learnerKeyId(doc.vaultKey.publicJwk, audience);

  let decision;
  if (auto) {
    decision = { approved: true, autoApprove: true, viaAutoApproval: true };
  } else if (typeof consentHandler !== 'function') {
    return { status: 'error', error: 'the vault page is not ready to ask the learner' };
  } else {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), CONSENT_TIMEOUT_MS);
    try {
      decision = await Promise.race([
        Promise.resolve(consentHandler({
          audience,
          audienceName: audienceName(audience),
          purpose,
          shared,
          withheld: WITHHELD,
          ttlMinutes: DEFAULT_TTL_MINUTES,
          learnerKeyId: subject
        }, { signal: controller.signal })),
        new Promise((resolve) => {
          controller.signal.addEventListener('abort', () => resolve({ approved: false, timedOut: true }), { once: true });
        })
      ]);
    } finally {
      clearTimeout(timer);
      controller.abort();
    }
  }

  if (decision && decision.busy) {
    return {
      status: 'error',
      error: 'the vault is already waiting for the learner to answer another disclosure request'
    };
  }
  if (decision && decision.timedOut) {
    announce({ reason: 'disclosure-timeout', audience });
    return {
      status: 'timeout',
      hint: 'The learner did not answer within 120 seconds. Ask them to look at the vault page, then call this tool again.'
    };
  }
  if (!decision || decision.approved !== true) {
    announce({ reason: 'disclosure-denied', audience });
    return { status: 'denied' };
  }

  const payload = await buildAssertionPayload({
    request,
    statuses: shared.map(({ concept, ability, status, confidence }) => ({ concept, ability, status, confidence })),
    vaultPublicJwk: doc.vaultKey.publicJwk,
    now: new Date(),
    ttlMinutes: DEFAULT_TTL_MINUTES
  });
  const token = await signToken(payload, doc.vaultKey.privateJwk);

  /* Read back what we just signed. The vault holds the token, so it inspects
   * it instead of verifying it against an audience it does not own. */
  const check = await inspectAssertion(token);
  if (!check.ok) {
    return { status: 'error', error: `the vault could not verify the token it just signed: ${check.reason}` };
  }

  if (decision.autoApprove && !auto) {
    doc.settings.autoApprove[audience] = new Date(Date.now() + AUTO_APPROVE_MS).toISOString();
  }

  doc.disclosures.push({
    audience,
    audienceName: audienceName(audience),
    purpose,
    requestHash: payload.requestHash,
    learnerKeyId: payload.learnerKeyId,
    sharedAt: payload.issuedAt,
    expiresAt: payload.expiresAt,
    shared: shared.map(({ concept, ability, status }) => ({ concept, ability, status })),
    withheld: [...WITHHELD],
    token,
    auto: Boolean(auto)
  });
  save({ reason: 'disclosure-approved', audience });

  return {
    status: 'approved',
    token,
    expiresAt: payload.expiresAt,
    learnerKeyId: payload.learnerKeyId,
    shared: shared.map(({ concept, ability, status }) => ({ concept, ability, status })),
    withheld: [...WITHHELD]
  };
}

/* ------------------------------------------------------------- goals -- */

export function addGoal({ title, concepts: ids }) {
  const goalTitle = typeof title === 'string' ? title.trim() : '';
  if (goalTitle === '') return { status: 'error', error: 'a goal needs a title' };

  const list = Array.isArray(ids)
    ? ids
    : String(ids || '').split(',');
  const wanted = list.map((value) => String(value).trim()).filter(Boolean);
  const known = wanted.filter((id) => conceptIndex.has(id));
  const unknown = wanted.filter((id) => !conceptIndex.has(id));

  if (known.length === 0) {
    return {
      status: 'error',
      error: 'none of those concept ids are in the registry',
      unknownConcepts: unknown
    };
  }

  const goal = { goalId: randomId('goal'), title: goalTitle, concepts: known, createdAt: nowIso() };
  doc.goals.push(goal);
  save({ reason: 'goal-added', goalId: goal.goalId });
  return { status: 'ok', goalId: goal.goalId, title: goal.title, concepts: known, unknownConcepts: unknown };
}

export function removeGoal(goalId) {
  const before = doc.goals.length;
  doc.goals = doc.goals.filter((goal) => goal.goalId !== goalId);
  if (doc.goals.length !== before) save({ reason: 'goal-removed', goalId });
}

/* -------------------------------------------- agent assessed evidence -- */

/**
 * Record the coach's rubric assessment as a receipt with grader
 * `agent-assessed`, weight 0.6. Unsigned, labelled in the ledger, and rejected
 * outright when the need id was never issued by this vault.
 */
export async function recordAgentAssessment({ needId, rubricResults, learnerAnswerSummary }) {
  if (typeof needId !== 'string' || needId.trim() === '') {
    return { status: 'rejected', reason: 'unknown-need' };
  }
  const need = getNeeds().find((entry) => entry.needId === needId);
  if (!need) return { status: 'rejected', reason: 'unknown-need' };

  if (!Array.isArray(rubricResults) || rubricResults.length === 0) {
    return { status: 'rejected', reason: 'no-rubric-results' };
  }
  const met = rubricResults.filter((entry) => entry && entry.met === true).length;
  const total = rubricResults.length;
  const result = met === total ? 'passed' : met * 2 >= total ? 'partial' : 'failed';

  const issuer = ORIGINS.coach || 'urn:nema:agent';
  const subject = await learnerKeyId(doc.vaultKey.publicJwk, issuer);
  const ability = need.ability || 'explain';
  const payload = buildReceiptPayload({
    issuer,
    keyId: 'agent',
    subject,
    activity: {
      id: `agent-assessment-${need.kind}-${shortConcept(need.concept)}`,
      version: '1.0.0',
      title: `Agent assessed: ${conceptTitle(need.concept)}, ${ability}`
    },
    claims: [{
      concept: need.concept,
      ability,
      evidenceType: EVIDENCE_TYPE[ability] || 'explanation',
      result,
      difficulty: 'intermediate'
    }],
    conditions: { attempts: 1, hintsUsed: 0, grader: 'agent-assessed', graderVersion: '1' },
    now: new Date()
  });

  const nowMs = Date.now();
  const now = new Date(nowMs).toISOString();
  const before = deriveState(doc.receipts, { now });
  const entry = {
    receiptId: payload.receiptId,
    token: null,
    payload,
    status: 'verified',
    receivedAt: nowIso(),
    effect: [],
    source: 'agent',
    needId,
    rubricResults: rubricResults.map((item) => ({
      criterion: String(item && item.criterion ? item.criterion : ''),
      met: Boolean(item && item.met)
    })),
    note: typeof learnerAnswerSummary === 'string' ? learnerAnswerSummary : ''
  };
  doc.receipts.push(entry);
  const after = deriveState(doc.receipts, { now });
  const changes = diffStates(before, after);
  entry.effect = effectFor(changes, after, nowMs);
  save({ reason: 'agent-assessment', receiptId: entry.receiptId, changes });

  return { status: 'accepted', receiptId: payload.receiptId, result, changes };
}

/* ------------------------------------------------ export, import, reset -- */

export function exportJson() {
  return JSON.stringify(doc, null, 2);
}

export async function importJson(text) {
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { status: 'rejected', reason: 'not valid JSON' };
  }
  if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.receipts)) {
    return { status: 'rejected', reason: 'this file is not a nema vault export' };
  }
  doc = normalize(parsed);
  if (!doc.vaultKey) doc.vaultKey = await generateKeyPair();
  save({ reason: 'imported' });
  return { status: 'ok', receipts: doc.receipts.length, goals: doc.goals.length };
}

export async function reset() {
  doc = emptyDoc();
  doc.vaultKey = await generateKeyPair();
  save({ reason: 'reset' });
  return { status: 'ok' };
}
