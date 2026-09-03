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
 *
 * It also holds the vault's other small ledger, `alignments`: what the names a
 * site uses in its own vocabulary mean in the shared registry. Sites are not
 * obliged to speak `nema:` ids, so the translation happens here, at the two
 * edges where names cross the boundary (`createAssertion` on the way out,
 * `stageReceipt` on the way in) and nowhere else. Inference never sees a local
 * id, and only the learner may confirm one. Contract section 23.
 */

import { ORIGINS, ORIGINS_BY_ENV, isDev } from '/shared/origins.js';
import { generateKeyPair, randomId, nowIso } from '/shared/crypto.js';
import {
  ALIGNMENT_RELATIONS,
  DEFAULT_TTL_MINUTES,
  ISSUER_WELL_KNOWN_PATH,
  SEED_ORIGIN,
  alignClaim,
  alignRequirement,
  alignmentIndex,
  buildAlignment,
  buildAssertionPayload,
  buildIssuerMap,
  buildReadinessRequest,
  buildReceiptPayload,
  capStatus,
  declaredAlignments,
  inspectAssertion,
  isLocalConcept,
  isSelfCertified,
  learnerKeyId,
  matchesPublishedKey,
  signToken,
  translateClaim,
  verifyReceipt
} from '/shared/protocol.js';
import {
  ABILITIES,
  WEIGHTS,
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

/**
 * How long the vault waits for an issuer's published key before it settles for
 * the `self` tier. A trust upgrade is a nicety: it must never hold up a receipt.
 */
export const WELL_KNOWN_TIMEOUT_MS = 3000;

/**
 * The trust rule of contract section 21, as the cap `deriveState` asks for.
 * A self certified receipt is worth a self report at most, whatever grader the
 * page that issued it claims to have run. Registered and origin issuers are not
 * capped: their key is either in the registry or published on their domain.
 */
export const trustWeightCap = (entry) => (
  entry && entry.trust === 'self' ? WEIGHTS['self-report'] : Infinity
);

const DAY_MS = 86400000;

/** The learner is the issuer of their own self check. Contract section 23. */
export const SELF_CHECK_ISSUER = 'urn:nema:self';
export const SELF_CHECK_KEY_ID = 'self-check';

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
    alignments: [],
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
  for (const key of ['receipts', 'disclosures', 'goals', 'misconceptions', 'alignments']) {
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

/** `nema:pan-sauces` reads as `pan-sauces` in dense rows and effect text. */
export function shortConcept(id) {
  return String(id || '').replace(/^nema:/, '');
}

export function issuerName(payload) {
  if (!payload) return 'unknown issuer';
  if (payload.keyId === 'agent') return 'nema coach agent';
  /* A self check has no issuer but the learner, and saying so is the point:
   * the ledger must never let a self report read like somebody else's word. */
  if (payload.keyId === SELF_CHECK_KEY_ID) return 'you, in the vault';
  const known = (issuerMapProd && issuerMapProd[payload.keyId]) || (issuerMapDev && issuerMapDev[payload.keyId]);
  if (known) return known.name;
  /* A site that installed the embed has no registered name, so it is known
   * by the domain it signs from. That is exactly as much as it has earned. */
  if (isSelfCertified(payload)) {
    try {
      return new URL(payload.issuer).host;
    } catch {
      return payload.issuer;
    }
  }
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

/* ------------------------------------------------- concept alignment -- */

/**
 * Every alignment the vault holds, newest first, optionally for one origin.
 * @param {string} [origin]
 */
export function getAlignments(origin) {
  const all = doc.alignments.slice().reverse();
  return origin ? all.filter((entry) => entry.origin === origin) : all;
}

export function getAlignment(alignmentId) {
  return doc.alignments.find((entry) => entry.alignmentId === alignmentId) || null;
}

/** Confirmed alignments for one origin, keyed by the site's own concept id. */
function indexFor(origin) {
  return alignmentIndex(doc.alignments, origin);
}

/**
 * The alignment already in play for one of a site's names: the same target
 * whatever the learner decided about it, or any proposal or confirmation still
 * standing. Both block a new proposal, so an agent cannot ask twice, and cannot
 * ask again under a different registry id while one is live.
 */
function liveAlignment(origin, providerConcept, concept) {
  return doc.alignments.find((entry) => (
    entry.origin === origin
    && entry.providerConcept === providerConcept
    && (entry.concept === concept || entry.status === 'proposed' || entry.status === 'confirmed')
  )) || null;
}

/**
 * Propose that a site's own concept id means a registry concept. Nothing is
 * translated until the learner confirms it in the vault: this only puts the
 * question in front of them.
 *
 * @returns {{status: 'proposed', alignmentId}|{status: 'exists', alignmentId, current}|{status: 'error', error: string}}
 */
export function proposeAlignment({ origin, providerConcept, concept, relation = 'equivalent', rationale = '', proposedBy = 'agent' }) {
  if (typeof origin !== 'string' || origin.trim() === '') {
    return { status: 'error', error: 'origin must be the origin of the site that uses this name' };
  }
  if (!isLocalConcept(providerConcept)) {
    return { status: 'error', error: 'providerConcept must be the id the site uses, without the nema: prefix' };
  }
  if (!conceptIndex.has(concept)) {
    return { status: 'error', error: `${concept} is not a concept in the nema registry`, unknownConcept: concept };
  }
  if (!ALIGNMENT_RELATIONS.includes(relation)) {
    return { status: 'error', error: `relation must be one of ${ALIGNMENT_RELATIONS.join(', ')}` };
  }

  const existing = liveAlignment(origin, providerConcept, concept);
  if (existing) {
    return { status: 'exists', alignmentId: existing.alignmentId, current: { ...existing } };
  }

  const alignment = buildAlignment({ origin, providerConcept, concept, relation, rationale, proposedBy, now: new Date() });
  doc.alignments.push(alignment);
  save({ reason: 'alignment-proposed', alignmentId: alignment.alignmentId });
  return { status: 'proposed', alignmentId: alignment.alignmentId, alignment: { ...alignment } };
}

/**
 * Take the `concepts` block of a manifest as the site's own word about its own
 * vocabulary. A site may vouch for its names, so a declared alignment arrives
 * confirmed, marked `proposedBy: 'provider'`, and shows in the list like any
 * other. It still cannot touch a name the learner has already ruled on.
 *
 * @param {{origin: string, concepts: Array<object>}} input the manifest fields
 * @returns {{status: 'ok', declared: number, skipped: number, alignments: Array<object>}}
 */
export function declareAlignments({ origin, concepts: declared }) {
  if (typeof origin !== 'string' || origin.trim() === '') {
    return { status: 'error', error: 'origin must be the origin of the site that declared these concepts' };
  }
  const wanted = declaredAlignments(declared);
  const added = [];
  let skipped = 0;

  for (const entry of wanted) {
    if (!conceptIndex.has(entry.concept)) {
      skipped += 1;
      continue;
    }
    if (liveAlignment(origin, entry.providerConcept, entry.concept)) {
      skipped += 1;
      continue;
    }
    added.push(buildAlignment({
      origin,
      providerConcept: entry.providerConcept,
      concept: entry.concept,
      relation: entry.relation,
      status: 'confirmed',
      proposedBy: 'provider',
      rationale: `Declared by the site as "${entry.title}".`,
      now: new Date()
    }));
  }

  if (added.length === 0) return { status: 'ok', declared: 0, skipped, alignments: [] };

  doc.alignments.push(...added);
  reannotate(origin);
  save({ reason: 'alignments-declared', origin });
  return { status: 'ok', declared: added.length, skipped, alignments: added.map((entry) => ({ ...entry })) };
}

/** The learner's decision, and the only way an alignment starts translating. */
export function confirmAlignment(alignmentId) {
  return decide(alignmentId, 'confirmed');
}

/** The learner's other decision. A rejected name never translates again. */
export function rejectAlignment(alignmentId) {
  return decide(alignmentId, 'rejected');
}

function decide(alignmentId, status) {
  const alignment = getAlignment(alignmentId);
  if (!alignment) return { status: 'rejected', reason: 'unknown-alignment' };
  if (alignment.status === status) {
    return { status: 'ok', alignment: { ...alignment }, changes: [] };
  }

  const nowMs = Date.now();
  const now = new Date(nowMs).toISOString();
  const before = deriveFrom(translated(doc.receipts), now);

  alignment.status = status;
  alignment.decidedAt = nowIso();
  /* Receipts already in the ledger are re-read, not rewritten: the signed
   * claims stay exactly as their issuer signed them and only the vault's note
   * about what each claim was read as moves. */
  reannotate(alignment.origin);

  const after = deriveFrom(translated(doc.receipts), now);
  const changes = diffStates(before, after);
  save({ reason: `alignment-${status}`, alignmentId, changes });
  return { status: 'ok', alignment: { ...alignment }, changes };
}

/**
 * The alignment note the vault keeps beside each signed claim of a receipt, or
 * null when every claim in it names a registry concept and there is nothing to
 * translate. Parallel to `payload.claims`, so `claims[i].alignedTo` and
 * `claims[i].pendingAlignment` read straight off it.
 */
function claimNotes(payload, index) {
  const claims = payload && Array.isArray(payload.claims) ? payload.claims : [];
  if (!claims.some((claim) => isLocalConcept(claim.concept))) return null;
  return claims.map((claim) => alignClaim(claim, index));
}

/** Refresh the stored notes of every receipt issued by one origin. */
function reannotate(origin) {
  const index = indexFor(origin);
  for (const entry of doc.receipts) {
    if (!entry.payload || entry.payload.issuer !== origin) continue;
    const notes = claimNotes(entry.payload, index);
    if (notes) entry.claims = notes;
    else delete entry.claims;
  }
}

/**
 * The receipts as a derivation reads them: local claim ids replaced by the
 * registry concept the learner confirmed them to mean, claims with no confirmed
 * alignment left out entirely. Nothing here is stored. Confirming an alignment
 * later therefore moves bands without a single line of the ledger changing,
 * which is the whole point: the evidence is what the issuer signed, this is
 * only how the vault reads it today.
 */
function translated(receipts) {
  const indexes = new Map();
  return receipts.map((entry) => {
    const payload = entry.payload;
    const claims = payload && Array.isArray(payload.claims) ? payload.claims : null;
    if (!claims || !claims.some((claim) => isLocalConcept(claim.concept))) return entry;

    const origin = payload.issuer;
    if (!indexes.has(origin)) indexes.set(origin, indexFor(origin));
    const index = indexes.get(origin);

    const mapped = [];
    for (const claim of claims) {
      const value = translateClaim(claim, index);
      if (value) mapped.push(value);
    }
    return { ...entry, payload: { ...payload, claims: mapped } };
  });
}

/**
 * Every derivation in the vault goes through here, so the trust cap can never
 * be forgotten in one code path and applied in another.
 */
function deriveFrom(receipts, now) {
  return deriveState(receipts, { now, weightCap: trustWeightCap });
}

/**
 * The trust tier of a stored receipt, for the ledger and the tools.
 *
 * Receipts staged before the tiers existed, and vault files imported from an
 * older build, carry no `trust`. They could only ever have been verified
 * against the issuer registry, so they read as `registered`. Agent assessed
 * receipts have no issuer at all: they are labelled as agent evidence instead,
 * so they get no tier.
 *
 * @param {object} entry a stored receipt entry
 * @returns {'registered'|'origin'|'self'|'pending'|null}
 */
export function trustOf(entry) {
  if (!entry) return null;
  if (entry.trust) return entry.trust;
  if (entry.status === 'pending') return 'pending';
  if (entry.payload && entry.payload.keyId === 'agent') return null;
  return 'registered';
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
  const state = deriveFrom(translated(doc.receipts), now);
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

/* Reviews are scheduled against the concept the vault reads the claim as, so a
 * claim in the site's own words reports the review of the registry concept it
 * was aligned to, and one still waiting for an alignment reports nothing. */
function reviewsFor(payload, after, notes) {
  const out = [];
  const seen = new Set();
  for (const [index, claim] of (payload.claims || []).entries()) {
    const note = notes ? notes[index] : null;
    if (note && note.pendingAlignment) continue;
    const concept = note && note.alignedTo ? note.alignedTo : claim.concept;
    if (seen.has(concept)) continue;
    seen.add(concept);
    const abilities = after[concept] || {};
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
 * Ask an issuer whether it publishes the key that signed a receipt.
 *
 * Three seconds, no credentials, and every failure is the same answer: null.
 * An issuer that is slow, offline, misconfigured or lying is not a reason to
 * refuse the receipt, it is a reason to keep it at the `self` tier.
 */
async function fetchPublishedKey(origin) {
  if (typeof origin !== 'string' || !/^https?:\/\//i.test(origin)) return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), WELL_KNOWN_TIMEOUT_MS);
  try {
    const response = await fetch(new URL(ISSUER_WELL_KNOWN_PATH, origin), {
      signal: controller.signal,
      credentials: 'omit',
      cache: 'no-store'
    });
    if (!response.ok) return null;
    return await response.json();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * The one place the `origin` tier is awarded: a self certified receipt whose
 * issuer publishes that same key at /.well-known/nema-issuer.json is trusted
 * like a registered one, because the site that owns the domain vouched for it.
 */
async function resolveTrust(payload, trust) {
  if (trust !== 'self') return trust;
  const published = await fetchPublishedKey(payload.issuer);
  return matchesPublishedKey(payload, published) ? 'origin' : 'self';
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
      trust: 'pending',
      receivedAt: nowIso(),
      effect: ['no band moved, the issuer is not in the trusted list'],
      source: options.source || 'manual'
    });
    save({ reason: 'receipt-pending', receiptId: payload.receiptId });
    return {
      status: 'pending',
      reason: 'unknown-issuer',
      trust: 'pending',
      receiptId: payload.receiptId,
      issuer: payload.issuer,
      issuerName: issuerName(payload)
    };
  }

  if (!result.ok) {
    return { status: 'rejected', reason: result.reason, trust: 'pending' };
  }

  /* The tier is settled before the state is derived, because the tier is what
   * decides how much this receipt is allowed to move. */
  const trust = await resolveTrust(payload, result.trust);

  const nowMs = Date.now();
  const now = new Date(nowMs).toISOString();
  const before = deriveFrom(translated(doc.receipts), now);
  const entry = {
    receiptId: payload.receiptId,
    token: raw,
    payload,
    status: 'verified',
    trust,
    receivedAt: nowIso(),
    effect: [],
    source: options.source || 'manual'
  };
  /* Translation at the edge, contract section 23. A claim in the site's own
   * words is noted with the registry concept the learner confirmed it to mean,
   * and one with no confirmed alignment is kept as `pendingAlignment` so it can
   * start counting the moment the learner says what it means. */
  const notes = claimNotes(payload, indexFor(payload.issuer));
  if (notes) entry.claims = notes;
  doc.receipts.push(entry);
  const after = deriveFrom(translated(doc.receipts), now);
  const changes = diffStates(before, after);
  entry.effect = effectFor(changes, after, nowMs);
  const waiting = (notes || []).filter((note) => note.pendingAlignment).map((note) => note.concept);
  if (waiting.length > 0) {
    entry.effect = [`waiting on an alignment for ${[...new Set(waiting)].join(', ')}`];
  } else if (trust === 'self' && changes.length > 0) {
    entry.effect.push('capped at the self report weight, the site signed its own key');
  }
  save({ reason: 'receipt-accepted', receiptId: entry.receiptId, changes });

  const accepted = {
    status: 'accepted',
    receiptId: payload.receiptId,
    issuer: payload.issuer,
    issuerName: issuerName(payload),
    trust,
    activity: payload.activity,
    claims: notes
      ? payload.claims.map((claim, i) => ({ ...claim, ...notes[i] }))
      : payload.claims,
    changes,
    reviewsScheduled: reviewsFor(payload, after, notes)
  };
  if (waiting.length > 0) {
    accepted.pendingAlignment = [...new Set(waiting)];
    accepted.hint = 'Nothing moved yet: this site names things its own way. Call propose_concept_alignment, then the learner confirms it in the vault.';
  }
  return accepted;
}

/* --------------------------------------------------------- demo seed -- */

/** Import `/seed.json`: a demo learner signed by the offline seed issuer. */
export async function loadDemoSeed() {
  const seed = await fetch('/seed.json').then((r) => r.json());
  const seen = seenReceiptIds();
  const nowMs = Date.now();
  const now = new Date(nowMs).toISOString();
  const first = deriveFrom(translated(doc.receipts), now);
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
      /* The seed is signed by the registered demo issuer, so no well known
       * lookup is worth a round trip here: whatever tier the signature earned
       * offline is the tier it keeps. */
      trust: result.ok ? result.trust : 'pending',
      receivedAt: nowIso(),
      effect: ['no band moved, the issuer is not in the trusted list'],
      source: 'seed'
    };
    doc.receipts.push(entry);
    if (result.ok) {
      /* Each seed receipt gets the same treatment a live one gets: the state is
       * rederived and the row says exactly what that receipt moved. */
      const step = deriveFrom(translated(doc.receipts), now);
      entry.effect = effectFor(diffStates(before, step), step, nowMs);
      before = step;
      added += 1;
    } else {
      pending += 1;
    }
  }

  const after = deriveFrom(translated(doc.receipts), now);
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

/**
 * The exact lines a request would disclose, with the titles the modal shows.
 *
 * Translation at the edge, contract section 23: a requirement written in the
 * site's own words is read from the registry concept the learner confirmed it
 * to mean, and answered under the name the site asked with. A local id with no
 * confirmed alignment is answered `missing` for the reason `unaligned`, which
 * is the honest answer: this vault does not know what that name means yet.
 *
 * @param {Array<{concept: string, ability: string}>} requirements
 * @param {string} [audience] the origin whose alignments apply
 */
export function previewDisclosure(requirements, audience) {
  const { state } = derived();
  const index = indexFor(audience);
  return requirements.map((entry) => {
    const aligned = alignRequirement(entry, index);
    const abilities = aligned.lookup ? state[aligned.lookup] || {} : {};
    const value = abilities[entry.ability] || null;
    const band = value ? value.band : 'unknown';
    const line = {
      concept: entry.concept,
      title: aligned.lookup ? conceptTitle(aligned.lookup) : entry.concept,
      ability: entry.ability,
      band,
      status: capStatus(toAssertionStatus(band), aligned.relation),
      confidence: value ? value.confidence : bandToConfidence(band, 0)
    };
    if (aligned.alignedTo) {
      line.alignedTo = aligned.alignedTo;
      line.relation = aligned.relation;
    }
    if (aligned.unaligned) line.reason = 'unaligned';
    return line;
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
  const shared = previewDisclosure(request.requirements, audience);
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
    /* The site is answered in its own words, with the registry concept the
     * band was read from beside it. Contract section 23. */
    statuses: shared.map(({ concept, ability, status, confidence, alignedTo, reason }) => ({
      concept,
      ability,
      status,
      confidence,
      ...(alignedTo ? { alignedTo } : {}),
      ...(reason ? { reason } : {})
    })),
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
    shared: shared.map(({ concept, ability, status, alignedTo }) => ({
      concept,
      ability,
      status,
      ...(alignedTo ? { alignedTo } : {})
    })),
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
    shared: shared.map(({ concept, ability, status, alignedTo, reason }) => ({
      concept,
      ability,
      status,
      ...(alignedTo ? { alignedTo } : {}),
      ...(reason ? { reason } : {})
    })),
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

/* ------------------------------------------- rubric graded evidence -- */

/**
 * The shared half of `recordAgentAssessment` and `recordSelfCheck`: find the
 * need, read the rubric, build one unsigned receipt and report what it moved.
 * The only difference between the two is who did the grading, which is exactly
 * the difference the ledger and the weights are supposed to show.
 *
 * @param {object} input
 * @param {string} input.needId a need id this vault issued
 * @param {Array<{criterion: string, met: boolean}>} input.rubricResults
 * @param {string} input.issuer origin recorded on the receipt
 * @param {string} input.keyId `agent` or `self-check`
 * @param {string} input.grader `agent-assessed` or `self-report`
 * @param {string} input.label how the activity reads in the ledger
 * @param {string} input.source `agent` or `self`
 * @param {string} [input.trust] trust tier stored on the entry
 * @param {string} [input.note] one or two sentences of context
 */
async function recordRubricResult({ needId, rubricResults, issuer, keyId, grader, label, source, trust, note }) {
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

  const subject = await learnerKeyId(doc.vaultKey.publicJwk, issuer);
  const ability = need.ability || 'explain';
  const payload = buildReceiptPayload({
    issuer,
    keyId,
    subject,
    activity: {
      id: `${keyId}-${need.kind}-${shortConcept(need.concept)}`,
      version: '1.0.0',
      title: `${label}: ${conceptTitle(need.concept)}, ${ability}`
    },
    claims: [{
      concept: need.concept,
      ability,
      evidenceType: EVIDENCE_TYPE[ability] || 'explanation',
      result,
      difficulty: 'intermediate'
    }],
    conditions: { attempts: 1, hintsUsed: 0, grader, graderVersion: '1' },
    now: new Date()
  });

  const nowMs = Date.now();
  const now = new Date(nowMs).toISOString();
  const before = deriveFrom(translated(doc.receipts), now);
  const entry = {
    receiptId: payload.receiptId,
    token: null,
    payload,
    status: 'verified',
    receivedAt: nowIso(),
    effect: [],
    source,
    needId,
    rubricResults: rubricResults.map((item) => ({
      criterion: String(item && item.criterion ? item.criterion : ''),
      met: Boolean(item && item.met)
    })),
    note: typeof note === 'string' ? note : ''
  };
  if (trust) entry.trust = trust;
  doc.receipts.push(entry);
  const after = deriveFrom(translated(doc.receipts), now);
  const changes = diffStates(before, after);
  entry.effect = effectFor(changes, after, nowMs);
  save({ reason: source === 'self' ? 'self-check' : 'agent-assessment', receiptId: entry.receiptId, changes });

  return { status: 'accepted', receiptId: payload.receiptId, result, changes };
}

/**
 * Record an agent's rubric assessment as a receipt with grader
 * `agent-assessed`, weight 0.6. Unsigned, labelled in the ledger, and rejected
 * outright when the need id was never issued by this vault.
 */
export async function recordAgentAssessment({ needId, rubricResults, learnerAnswerSummary }) {
  return recordRubricResult({
    needId,
    rubricResults,
    issuer: ORIGINS.coach || 'urn:nema:agent',
    keyId: 'agent',
    grader: 'agent-assessed',
    label: 'Agent assessed',
    source: 'agent',
    note: learnerAnswerSummary
  });
}

/**
 * The learner answering their own review question, with no agent in the room.
 * Contract section 23: grader `self-report`, keyId `self-check`, issuer
 * `urn:nema:self`, trust `registered`, and the ledger says "self check".
 *
 * It is honest evidence and it is worth 0.3, the weakest thing a person can
 * say about themselves that is still worth writing down. There is no tool for
 * this on purpose: an agent must never tick a learner's boxes for them.
 */
export async function recordSelfCheck({ needId, rubricResults, note }) {
  return recordRubricResult({
    needId,
    rubricResults,
    issuer: SELF_CHECK_ISSUER,
    keyId: SELF_CHECK_KEY_ID,
    grader: 'self-report',
    label: 'Self check',
    source: 'self',
    /* Nothing was signed, but nothing was claimed on anyone else's behalf
     * either: the learner is the issuer, so the tier is not in question and
     * the weight, 0.3, is what keeps it honest. */
    trust: 'registered',
    note
  });
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
