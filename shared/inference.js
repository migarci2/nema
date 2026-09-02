/**
 * nema: learner state inference (the vault brain).
 *
 * Pure functions, no imports, no I/O, no clock reads at all: `now` is always
 * passed in, and `deriveState`, `summarize` and `computeNeeds` throw when it is
 * missing or unparsable rather than reading the system clock behind your back.
 * Everything here is deterministic: the same receipts and the same `now` always
 * produce the same state, the same needs and the same need ids. The vault never
 * stores learner state, it derives it from the evidence ledger on every read, so
 * this file is the only place where "what does this learner know" is decided.
 *
 * ---------------------------------------------------------------------------
 * Scoring
 * ---------------------------------------------------------------------------
 *
 * Input: evidence receipts, each wrapped as
 *   { receiptId, payload (EvidenceReceipt, contract 5.4), status, receivedAt }
 * with status `verified` (signature checked), `agent` (recorded by the agent
 * against a rubric, kept but visibly weaker) or `pending` (unknown issuer).
 * Only `verified` and `agent` are counted. Everything else, `pending` included,
 * is ignored entirely: an unknown or unchecked issuer never moves learner state,
 * it only sits in the ledger.
 *
 * Every claim in a receipt is
 *   { concept, ability, evidenceType, result, difficulty }
 * and the receipt carries `conditions.grader`, which decides how much the claim
 * is worth.
 *
 * 1. Ladder. A claim contributes to its own ability and to every lower ability
 *    on the ladder recognize < retrieve < explain < apply < transfer. Passing an
 *    application task is also evidence that you can explain and recall the idea.
 *    `discriminate` is a side ability: it is off the ladder, so a discriminate
 *    claim contributes only to `discriminate`, and nothing contributes to it.
 *
 * 2. Value of one contribution:
 *      value = weight(grader) * resultValue * recency
 *      weight:   deterministic 1, provider-rubric 0.8, agent-assessed 0.6,
 *                self-report 0.3, exposure 0.1 (unknown grader is treated as
 *                exposure, the most conservative reading), then capped by the
 *                optional `weightCap(receipt)`: the grader says how the work
 *                was judged, the cap says how much the judge can be believed.
 *                The vault caps self certified receipts at the self-report
 *                weight, so a page that grades itself deterministically is
 *                still only worth a learner saying "I can do this".
 *      result:   passed 1, partial 0.5, failed -0.5
 *      recency:  exp(-daysSince / 60), so evidence halves in about 42 days and
 *                never quite reaches zero. Future dates are clamped to today.
 *
 * 3. score = sum of contributions. Bands:
 *      >= 1.6 durable, >= 0.9 usable, >= 0.4 fragile, > 0 uncertain, else unknown.
 *    One cap: if the best grader behind an ability is exposure grade (weight
 *    0.1 or less), the band is clamped to `uncertain`. Reading ten pages is not
 *    the same as doing the thing once, and no amount of exposure should ever
 *    certify readiness to a provider.
 *
 * 4. Memory. `passes` counts passed claims at that ability or higher, ignoring
 *    exposure grade claims: reading a page is not a successful recall, so it
 *    neither schedules nor postpones a review.
 *      stabilityDays = min(60, 3 * 2 ** (passes - 1))
 *      nextReview    = lastSuccess + stabilityDays
 *      reviewDue     = nextReview < now
 *    A failed claim dated after the last success resets stabilityDays to 3: the
 *    schedule restarts, it does not keep coasting on old wins. With no assessed
 *    pass at all, lastSuccess, stabilityDays and nextReview are null.
 *
 * 5. Confidence. `high` when score >= 1.2 and the best grader weight >= 0.8,
 *    `medium` when score >= 0.6, otherwise `low`. Confidence is about how much
 *    the evidence can be trusted, the band is about how strong it is.
 *
 * ---------------------------------------------------------------------------
 * Needs
 * ---------------------------------------------------------------------------
 *
 * A LearningNeed (contract 5.5) is what the vault asks for next. Kinds, with
 * their trigger and base urgency:
 *
 *   retrieve            a review is due for some ability at retrieve or above,
 *                       or for a side ability such as discriminate
 *                       urgency 0.6 + 0.4 * overdueDays / 7, capped at 1
 *   apply               explain is usable or better, apply is fragile or worse   0.7
 *   discriminate        concept has a confusable neighbour, apply or explain is
 *                       usable or better, no discrimination evidence yet        0.65
 *   acquire             an active goal names the concept, or a goal concept
 *                       lists it as a prerequisite, and every ability is unknown 0.5
 *   repair_misconception the vault has one or more recorded misconceptions for
 *                       the concept, all carried in the one need              0.8
 *   reassess            evidence exists but the best grader weight is below 0.6  0.45
 *   transfer            apply is durable and transfer is unknown                 0.35
 *
 *   goalRelevance = 1.5 in an active goal, 1.2 prerequisite of a goal concept,
 *                   else 1
 *   priority      = urgency * goalRelevance / max(2, minutes)
 *
 * Needs are sorted by priority descending. With `budgetMinutes` the list is
 * filled greedily in that order, skipping needs that do not fit and continuing,
 * so a short need can still ride along after a long one is skipped.
 *
 * Each need carries the rubric a coach grades it against. The concept registry
 * only defines rubrics for explain, apply and discriminate, so a need whose kind
 * and ability have no entry falls back along the ladder and then to the first
 * rubric the concept has. A need never ships an empty rubric while the concept
 * has one, because `record_agent_assessment` passes a need when every criterion
 * is met, and no criteria at all would be a free pass.
 *
 * Need ids are deterministic: "need_" + a 32 bit FNV-1a hash of concept + kind,
 * in base 36. Calling computeNeeds twice returns the same ids, which is what
 * lets `record_agent_assessment` reject a needId it never issued. One concept
 * therefore yields at most one need of each kind.
 */

export const ABILITY_LADDER = ['recognize', 'retrieve', 'explain', 'apply', 'transfer'];
export const SIDE_ABILITIES = ['discriminate'];
export const ABILITIES = [...ABILITY_LADDER, ...SIDE_ABILITIES];

export const BANDS = ['unknown', 'uncertain', 'fragile', 'usable', 'durable'];

export const WEIGHTS = {
  deterministic: 1,
  'provider-rubric': 0.8,
  'agent-assessed': 0.6,
  'self-report': 0.3,
  exposure: 0.1
};

export const RESULT_VALUES = { passed: 1, partial: 0.5, failed: -0.5 };

export const NEED_KINDS = [
  'acquire',
  'retrieve',
  'apply',
  'transfer',
  'discriminate',
  'repair_misconception',
  'reassess'
];

const DAY_MS = 86400000;
const HALF_LIFE_DAYS = 60;
const BASE_STABILITY_DAYS = 3;
const MAX_STABILITY_DAYS = 60;
const DEFAULT_MINUTES = 4;

const BAND_THRESHOLDS = [
  [1.6, 'durable'],
  [0.9, 'usable'],
  [0.4, 'fragile']
];

const NEED_ABILITY = {
  acquire: 'explain',
  retrieve: 'retrieve',
  apply: 'apply',
  transfer: 'transfer',
  discriminate: 'discriminate',
  repair_misconception: 'explain',
  reassess: 'explain'
};

const NEED_URGENCY = {
  acquire: 0.5,
  retrieve: 0.6,
  apply: 0.7,
  transfer: 0.35,
  discriminate: 0.65,
  repair_misconception: 0.8,
  reassess: 0.45
};

const EXERCISE_HINTS = {
  acquire: 'short explanation of the idea, then one worked example',
  retrieve: 'closed book recall, one prompt, no options and no hints',
  apply: 'one small task that forces the idea into use',
  transfer: 'the same idea in a context the learner has not seen before',
  discriminate: 'compare-and-contrast with one concrete failure case',
  repair_misconception: 'confront the misconception with a counterexample, then ask for the corrected rule',
  reassess: 'one deterministic check that confirms or drops the earlier evidence'
};

/**
 * Where a need looks for its rubric when the concept registry has no entry for
 * the need's own kind or ability. Tried in order after `kind` and `ability`.
 */
const RUBRIC_FALLBACK = {
  acquire: ['explain', 'apply', 'discriminate'],
  retrieve: ['explain', 'apply', 'discriminate'],
  apply: ['apply', 'explain', 'discriminate'],
  transfer: ['apply', 'explain', 'discriminate'],
  discriminate: ['discriminate', 'explain', 'apply'],
  repair_misconception: ['explain', 'apply', 'discriminate'],
  reassess: ['explain', 'apply', 'discriminate']
};

/* ------------------------------------------------------------------ utils */

function toMs(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? null : ms;
}

function resolveNow(options) {
  const ms = toMs(options && options.now);
  if (ms === null) {
    throw new TypeError('nema/inference: options.now is required and must be an ISO date string or epoch milliseconds');
  }
  return ms;
}

function isoFrom(ms) {
  return new Date(ms).toISOString();
}

function round(value, places = 4) {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}

/** 32 bit FNV-1a, base 36. Small, stable, no crypto. */
function shortHash(input) {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(36).padStart(7, '0');
}

export function bandRank(band) {
  const index = BANDS.indexOf(band);
  return index === -1 ? 0 : index;
}

export function bestBand(conceptState) {
  if (!conceptState || typeof conceptState !== 'object') return 'unknown';
  let best = 'unknown';
  for (const entry of Object.values(conceptState)) {
    if (!entry || typeof entry.band !== 'string') continue;
    if (bandRank(entry.band) > bandRank(best)) best = entry.band;
  }
  return best;
}

function bandForScore(score) {
  for (const [threshold, band] of BAND_THRESHOLDS) {
    if (score >= threshold) return band;
  }
  return score > 0 ? 'uncertain' : 'unknown';
}

function graderWeight(grader) {
  const weight = WEIGHTS[grader];
  return typeof weight === 'number' ? weight : WEIGHTS.exposure;
}

/**
 * The ceiling one receipt's evidence may reach, from the caller's optional
 * `weightCap(receipt)`. No function, a non number or NaN means no ceiling.
 * A negative ceiling is read as zero, so a cap can silence a receipt but never
 * turn a pass into a penalty.
 */
function capFor(weightCap, receipt) {
  if (typeof weightCap !== 'function') return Infinity;
  const value = weightCap(receipt);
  if (typeof value !== 'number' || Number.isNaN(value)) return Infinity;
  return Math.max(0, value);
}

/** Abilities a claim contributes to: itself plus every lower ladder rung. */
function targetAbilities(ability) {
  const index = ABILITY_LADDER.indexOf(ability);
  if (index >= 0) return ABILITY_LADDER.slice(0, index + 1);
  return SIDE_ABILITIES.includes(ability) ? [ability] : [];
}

function abilityOrder(ability) {
  const index = ABILITIES.indexOf(ability);
  return index === -1 ? ABILITIES.length : index;
}

/* ------------------------------------------------------------ deriveState */

/**
 * Derive learner state from the evidence ledger.
 *
 * @param {Array<{receiptId?: string, payload: object, status?: string, receivedAt?: string}>} receipts
 * @param {{ now?: string|number, weightCap?: (receipt: object) => number }} [options]
 *   `weightCap` is asked, per receipt, for the most that receipt's evidence may
 *   ever be worth. The vault passes the trust tier rule of contract section 21,
 *   which caps a self certified receipt at the self-report weight.
 * @returns {Object} state: { [concept]: { [ability]: { band, score, confidence,
 *   graderWeight, lastSuccess, stabilityDays, nextReview, reviewDue,
 *   evidenceRefs } } }. Concepts and abilities are sorted, so the object is
 *   stable enough to compare or render directly.
 */
export function deriveState(receipts, options = {}) {
  const nowMs = resolveNow(options);
  const weightCap = options.weightCap;
  const buckets = new Map();

  for (const receipt of Array.isArray(receipts) ? receipts : []) {
    if (!receipt || typeof receipt !== 'object') continue;
    // Whitelist, not blacklist: only a checked signature or an agent recorded
    // assessment moves state. Anything else (pending, rejected, a typo, a
    // missing field) sits in the ledger and is ignored here.
    if (receipt.status !== 'verified' && receipt.status !== 'agent') continue;

    const payload = receipt.payload;
    if (!payload || !Array.isArray(payload.claims)) continue;

    const grader = payload.conditions ? payload.conditions.grader : undefined;
    const weight = Math.min(graderWeight(grader), capFor(weightCap, receipt));
    const issuedMs = toMs(payload.issuedAt) ?? toMs(receipt.receivedAt) ?? nowMs;
    const daysSince = Math.max(0, (nowMs - issuedMs) / DAY_MS);
    const recency = Math.exp(-daysSince / HALF_LIFE_DAYS);
    const receiptId = receipt.receiptId || payload.receiptId || null;

    for (const claim of payload.claims) {
      if (!claim || typeof claim.concept !== 'string') continue;
      const resultValue = RESULT_VALUES[claim.result];
      if (typeof resultValue !== 'number') continue;
      const targets = targetAbilities(claim.ability);
      if (targets.length === 0) continue;

      if (!buckets.has(claim.concept)) buckets.set(claim.concept, new Map());
      const conceptBucket = buckets.get(claim.concept);

      for (const ability of targets) {
        if (!conceptBucket.has(ability)) conceptBucket.set(ability, []);
        conceptBucket.get(ability).push({
          value: weight * resultValue * recency,
          weight,
          result: claim.result,
          issuedMs,
          receiptId
        });
      }
    }
  }

  const state = {};
  for (const concept of [...buckets.keys()].sort()) {
    const conceptBucket = buckets.get(concept);
    const abilities = [...conceptBucket.keys()].sort((a, b) => abilityOrder(a) - abilityOrder(b));
    const conceptState = {};
    for (const ability of abilities) {
      conceptState[ability] = summarizeAbility(conceptBucket.get(ability), nowMs);
    }
    state[concept] = conceptState;
  }
  return state;
}

function summarizeAbility(contributions, nowMs) {
  const ordered = [...contributions].sort((a, b) => a.issuedMs - b.issuedMs);

  let score = 0;
  let bestWeight = 0;
  let passes = 0;
  let lastSuccessMs = null;
  let lastFailureMs = null;
  const evidenceRefs = [];

  for (const item of ordered) {
    score += item.value;
    if (item.weight > bestWeight) bestWeight = item.weight;
    // Exposure grade evidence never schedules a review: reading a page is not
    // a successful recall, so it must not push the next review away.
    if (item.result === 'passed' && item.weight > WEIGHTS.exposure) {
      passes += 1;
      lastSuccessMs = item.issuedMs;
    }
    if (item.result === 'failed') lastFailureMs = item.issuedMs;
    if (item.receiptId && !evidenceRefs.includes(item.receiptId)) evidenceRefs.push(item.receiptId);
  }

  score = round(score);

  let band = bandForScore(score);
  if (bestWeight <= WEIGHTS.exposure && bandRank(band) > bandRank('uncertain')) {
    band = 'uncertain';
  }

  let confidence = 'low';
  if (score >= 1.2 && bestWeight >= 0.8) confidence = 'high';
  else if (score >= 0.6) confidence = 'medium';

  let stabilityDays = null;
  let nextReview = null;
  let reviewDue = false;
  if (lastSuccessMs !== null) {
    stabilityDays = Math.min(MAX_STABILITY_DAYS, BASE_STABILITY_DAYS * 2 ** (passes - 1));
    if (lastFailureMs !== null && lastFailureMs > lastSuccessMs) stabilityDays = BASE_STABILITY_DAYS;
    const nextReviewMs = lastSuccessMs + stabilityDays * DAY_MS;
    nextReview = isoFrom(nextReviewMs);
    reviewDue = nextReviewMs < nowMs;
  }

  return {
    band,
    score,
    confidence,
    graderWeight: bestWeight,
    lastSuccess: lastSuccessMs === null ? null : isoFrom(lastSuccessMs),
    stabilityDays,
    nextReview,
    reviewDue,
    evidenceRefs
  };
}

/* --------------------------------------------------------- band reporting */

/** What a provider is allowed to see for a band. */
export function toAssertionStatus(band) {
  if (band === 'durable' || band === 'usable') return 'verified';
  if (band === 'fragile' || band === 'uncertain') return 'uncertain';
  return 'missing';
}

/**
 * Confidence from a band and a score, for callers that do not have the grader
 * mix at hand. deriveState stores a slightly stricter value that also looks at
 * the best grader weight.
 */
export function bandToConfidence(band, score) {
  const value = typeof score === 'number' && Number.isFinite(score) ? score : 0;
  if (band === 'unknown') return 'low';
  if (band === 'durable' || band === 'usable') {
    if (value >= 1.2) return 'high';
    if (value >= 0.6) return 'medium';
    return 'low';
  }
  return value >= 0.6 ? 'medium' : 'low';
}

/** Human readable band changes between two states, for the tool result. */
export function diffStates(before, after) {
  const left = before && typeof before === 'object' ? before : {};
  const right = after && typeof after === 'object' ? after : {};
  const concepts = [...new Set([...Object.keys(left), ...Object.keys(right)])].sort();

  const changes = [];
  for (const concept of concepts) {
    const abilities = [
      ...new Set([...Object.keys(left[concept] || {}), ...Object.keys(right[concept] || {})])
    ].sort((a, b) => abilityOrder(a) - abilityOrder(b));

    for (const ability of abilities) {
      const from = bandAt(left, concept, ability);
      const to = bandAt(right, concept, ability);
      if (from !== to) changes.push({ concept, ability, from, to });
    }
  }
  return changes;
}

function bandAt(state, concept, ability) {
  const entry = state && state[concept] && state[concept][ability];
  return entry && typeof entry.band === 'string' ? entry.band : 'unknown';
}

/* ---------------------------------------------------------------- summary */

/**
 * Counts for the vault summary strip. Band counts are per concept, using the
 * concept's best ability. `reviewsDue` counts concepts with at least one
 * ability whose review date has passed.
 */
export function summarize(state, options = {}) {
  const nowMs = resolveNow(options);
  const source = state && typeof state === 'object' ? state : {};

  const counts = { concepts: 0, durable: 0, usable: 0, fragile: 0, uncertain: 0, unknown: 0, reviewsDue: 0 };

  for (const conceptState of Object.values(source)) {
    if (!conceptState || typeof conceptState !== 'object') continue;
    counts.concepts += 1;
    const band = bestBand(conceptState);
    counts[band] += 1;
    for (const entry of Object.values(conceptState)) {
      if (isReviewDue(entry, nowMs)) {
        counts.reviewsDue += 1;
        break;
      }
    }
  }
  return counts;
}

function isReviewDue(entry, nowMs) {
  if (!entry) return false;
  const nextReviewMs = toMs(entry.nextReview);
  if (nextReviewMs !== null) return nextReviewMs < nowMs;
  return entry.reviewDue === true;
}

/* ------------------------------------------------------------ needs */

/**
 * Turn learner state into an ordered list of LearningNeed objects.
 *
 * @param {object} state derived state
 * @param {{ concepts?: Array, goals?: Array, misconceptions?: Array,
 *           now?: string|number, budgetMinutes?: number }} [options]
 * @returns {Array} needs, highest priority first
 */
export function computeNeeds(state, options = {}) {
  const nowMs = resolveNow(options);
  const source = state && typeof state === 'object' ? state : {};
  const concepts = Array.isArray(options.concepts) ? options.concepts : [];
  const goals = Array.isArray(options.goals) ? options.goals : [];
  const misconceptions = Array.isArray(options.misconceptions) ? options.misconceptions : [];

  const registry = new Map();
  for (const concept of concepts) {
    if (concept && typeof concept.id === 'string') registry.set(concept.id, concept);
  }

  const goalConcepts = new Set();
  const goalPrereqs = new Set();
  for (const goal of goals) {
    for (const id of (goal && Array.isArray(goal.concepts) ? goal.concepts : [])) {
      goalConcepts.add(id);
      const def = registry.get(id);
      for (const prereq of (def && Array.isArray(def.prereqs) ? def.prereqs : [])) {
        goalPrereqs.add(prereq);
      }
    }
  }

  const misconceptionsByConcept = new Map();
  for (const item of misconceptions) {
    if (!item || typeof item.concept !== 'string') continue;
    if (!misconceptionsByConcept.has(item.concept)) misconceptionsByConcept.set(item.concept, []);
    misconceptionsByConcept.get(item.concept).push({
      id: item.id || null,
      text: item.text || ''
    });
  }

  const ids = [...new Set([...registry.keys(), ...Object.keys(source)])].sort();
  const needs = [];

  for (const conceptId of ids) {
    const def = registry.get(conceptId) || null;
    const conceptState = source[conceptId] || {};
    const hasEvidence = Object.keys(conceptState).length > 0;
    const band = (ability) => bandAt(source, conceptId, ability);
    const context = { conceptId, def, goalConcepts, goalPrereqs };

    // retrieve: something is due for review.
    const overdue = worstOverdue(conceptState, nowMs);
    if (overdue !== null) {
      const days = Math.max(0, Math.round(overdue.days * 10) / 10);
      needs.push(buildNeed(context, 'retrieve', {
        ability: overdue.ability,
        urgency: Math.min(1, 0.6 + (0.4 * overdue.days) / 7),
        reason: ['spaced_review_is_due', `overdue_by_${days}_days`]
      }));
    }

    // apply: can explain it, cannot yet use it.
    if (bandRank(band('explain')) >= bandRank('usable') && bandRank(band('apply')) <= bandRank('fragile')) {
      needs.push(buildNeed(context, 'apply', {
        reason: ['explanation_is_solid', 'application_is_weak']
      }));
    }

    // discriminate: strong enough to be confused with a neighbour.
    const confusable = firstConfusable(def);
    const strongEnough = bandRank(band('apply')) >= bandRank('usable')
      || bandRank(band('explain')) >= bandRank('usable');
    if (confusable && strongEnough && !conceptState.discriminate) {
      needs.push(buildNeed(context, 'discriminate', {
        reason: ['application_is_strong', 'no_discrimination_evidence'],
        confusableWith: confusable
      }));
    }

    // acquire: a goal depends on it and there is nothing at all.
    const inGoalScope = goalConcepts.has(conceptId) || goalPrereqs.has(conceptId);
    const allUnknown = bandRank(bestBand(conceptState)) === 0;
    if (inGoalScope && allUnknown) {
      needs.push(buildNeed(context, 'acquire', {
        reason: ['goal_depends_on_this_concept', 'no_evidence_yet']
      }));
    }

    // repair_misconception: the learner said something wrong and we kept it.
    // Every misconception recorded for the concept goes into one repair need,
    // so none is silently dropped by the needId hash.
    const recorded = misconceptionsByConcept.get(conceptId);
    if (recorded && recorded.length > 0) {
      needs.push(buildNeed(context, 'repair_misconception', {
        reason: ['recorded_misconception', ...recorded.map((item) => item.id || 'unnamed_misconception')],
        misconceptions: recorded
      }));
    }

    // reassess: the only evidence is weakly graded.
    if (hasEvidence) {
      const weight = bestGraderWeight(conceptState);
      if (weight < 0.6) {
        needs.push(buildNeed(context, 'reassess', {
          reason: ['evidence_is_weakly_graded', 'no_strong_grader_on_record'],
          ability: highestAbilityWithEvidence(conceptState)
        }));
      }
    }

    // transfer: durable in one context, untested in another.
    if (band('apply') === 'durable' && band('transfer') === 'unknown') {
      needs.push(buildNeed(context, 'transfer', {
        reason: ['application_is_durable', 'no_transfer_evidence']
      }));
    }
  }

  needs.sort((a, b) => (
    b.priority - a.priority
    || b.urgency - a.urgency
    || a.concept.localeCompare(b.concept)
    || NEED_KINDS.indexOf(a.kind) - NEED_KINDS.indexOf(b.kind)
  ));

  const budget = Number(options.budgetMinutes);
  if (Number.isFinite(budget) && budget > 0) {
    const picked = [];
    let remaining = budget;
    for (const need of needs) {
      if (need.minutes <= remaining) {
        picked.push(need);
        remaining -= need.minutes;
      }
    }
    return picked;
  }
  return needs;
}

/**
 * The worst overdue review on a concept, or null when nothing is due.
 *
 * Scans every ladder ability at `retrieve` or above plus the side abilities, so
 * a discrimination review that the summary strip counts is also a need the
 * panel can show. Ladder reviews are practised as recall at the `retrieve`
 * rung; a side ability is practised as itself.
 *
 * @returns {{ ability: string, days: number }|null}
 */
function worstOverdue(conceptState, nowMs) {
  let ladderDays = null;
  let sideAbility = null;
  let sideDays = null;

  for (const [ability, entry] of Object.entries(conceptState)) {
    const onLadder = ABILITY_LADDER.indexOf(ability) >= ABILITY_LADDER.indexOf('retrieve');
    const onSide = SIDE_ABILITIES.includes(ability);
    if (!onLadder && !onSide) continue;
    if (!isReviewDue(entry, nowMs)) continue;

    const nextReviewMs = toMs(entry.nextReview);
    const days = nextReviewMs === null ? 0 : (nowMs - nextReviewMs) / DAY_MS;
    if (onLadder) {
      if (ladderDays === null || days > ladderDays) ladderDays = days;
    } else if (sideDays === null || days > sideDays) {
      sideDays = days;
      sideAbility = ability;
    }
  }

  if (ladderDays === null && sideDays === null) return null;
  const days = Math.max(ladderDays === null ? -Infinity : ladderDays, sideDays === null ? -Infinity : sideDays);
  return { ability: ladderDays === null ? sideAbility : 'retrieve', days };
}

function firstConfusable(def) {
  if (!def || !Array.isArray(def.confusableWith) || def.confusableWith.length === 0) return null;
  const first = def.confusableWith[0];
  return typeof first === 'string' && first.length > 0 ? first : null;
}

/** The strongest grader that ever produced evidence for this concept. */
function bestGraderWeight(conceptState) {
  let best = 0;
  for (const entry of Object.values(conceptState)) {
    const weight = entry && typeof entry.graderWeight === 'number' ? entry.graderWeight : 0;
    if (weight > best) best = weight;
  }
  return best;
}

function highestAbilityWithEvidence(conceptState) {
  let best = null;
  for (const ability of Object.keys(conceptState)) {
    if (best === null || abilityOrder(ability) > abilityOrder(best)) best = ability;
  }
  return best || 'explain';
}

function buildNeed(context, kind, extra = {}) {
  const { conceptId, def, goalConcepts, goalPrereqs } = context;
  const ability = extra.ability || NEED_ABILITY[kind];

  const goalRelevance = goalConcepts.has(conceptId) ? 1.5 : (goalPrereqs.has(conceptId) ? 1.2 : 1);
  const urgency = round(Math.min(1, extra.urgency ?? NEED_URGENCY[kind]), 3);
  const minutes = minutesFor(def, ability);
  const priority = round((urgency * goalRelevance) / Math.max(2, minutes), 5);

  const reason = [...(extra.reason || [])];
  if (goalRelevance === 1.5) reason.push('active_goal_depends_on_this_concept');
  else if (goalRelevance === 1.2) reason.push('prerequisite_of_an_active_goal');

  return {
    needId: `need_${shortHash(`${conceptId}|${kind}`)}`,
    concept: conceptId,
    conceptTitle: (def && def.title) || conceptId,
    ability,
    kind,
    reason,
    urgency,
    minutes,
    confusableWith: extra.confusableWith || null,
    exerciseHint: EXERCISE_HINTS[kind],
    rubric: rubricFor(def, kind, ability),
    constraints: {
      maxHints: kind === 'retrieve' ? 0 : 1,
      doNotRevealAnswerBeforeSubmission: true
    },
    misconceptions: extra.misconceptions || [],
    goalRelevance,
    priority
  };
}

function minutesFor(def, ability) {
  const minutes = def && def.minutes ? def.minutes[ability] : undefined;
  return typeof minutes === 'number' && minutes > 0 ? minutes : DEFAULT_MINUTES;
}

/**
 * The rubric a coach grades this need against.
 *
 * The concept registry only carries rubrics for `explain`, `apply` and
 * `discriminate`, so an exact lookup would ship an empty rubric for every
 * retrieve, transfer, acquire and reassess need. An empty rubric is worse than
 * useless: `record_agent_assessment` passes a need when every criterion is met,
 * so no criteria at all is a vacuous pass, exactly the fabricated evidence the
 * protocol exists to prevent. So we fall back along the ladder and, failing
 * that, take the first rubric the concept has, in a fixed order. The result is
 * empty only when the concept carries no rubric at all.
 */
function rubricFor(def, kind, ability) {
  const rubric = def && def.rubric ? def.rubric : null;
  if (!rubric) return [];
  const order = [kind, ability, ...(RUBRIC_FALLBACK[kind] || RUBRIC_FALLBACK.reassess), ...Object.keys(rubric).sort()];
  for (const key of order) {
    const chosen = rubric[key];
    if (Array.isArray(chosen) && chosen.length > 0) return [...chosen];
  }
  return [];
}
