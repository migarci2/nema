import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import {
  ABILITY_LADDER,
  BANDS,
  NEED_KINDS,
  WEIGHTS,
  bandRank,
  bandToConfidence,
  bestBand,
  computeNeeds,
  deriveState,
  diffStates,
  summarize,
  toAssertionStatus
} from '../shared/inference.js';

function fixture(name) {
  const url = new URL(`./fixtures/${name}.json`, import.meta.url);
  return JSON.parse(readFileSync(fileURLToPath(url), 'utf8'));
}

const CONCEPTS = fixture('inference-concepts');
const LEDGER = fixture('inference-ledger');
const NEEDS = fixture('inference-needs');
const SEED = fixture('inference-seed');

const NOW = LEDGER.now;
const state = deriveState(LEDGER.receipts, { now: NOW });

function receiptsExcept(ids) {
  return LEDGER.receipts.filter((receipt) => !ids.includes(receipt.receiptId));
}

/* ------------------------------------------------------------ band helpers */

test('bandRank orders the bands from unknown to durable', () => {
  assert.deepEqual(BANDS, ['unknown', 'uncertain', 'fragile', 'usable', 'durable']);
  const ranks = BANDS.map(bandRank);
  assert.deepEqual(ranks, [0, 1, 2, 3, 4]);
  assert.equal(bandRank('not-a-band'), 0);
});

test('bestBand takes the highest band across abilities', () => {
  assert.equal(bestBand({ explain: { band: 'fragile' }, apply: { band: 'usable' } }), 'usable');
  assert.equal(bestBand({ recognize: { band: 'unknown' } }), 'unknown');
  assert.equal(bestBand({}), 'unknown');
  assert.equal(bestBand(null), 'unknown');
});

test('toAssertionStatus collapses bands into the three provider facing values', () => {
  assert.equal(toAssertionStatus('durable'), 'verified');
  assert.equal(toAssertionStatus('usable'), 'verified');
  assert.equal(toAssertionStatus('fragile'), 'uncertain');
  assert.equal(toAssertionStatus('uncertain'), 'uncertain');
  assert.equal(toAssertionStatus('unknown'), 'missing');
});

test('bandToConfidence needs both a strong band and a strong score for high', () => {
  assert.equal(bandToConfidence('durable', 1.9), 'high');
  assert.equal(bandToConfidence('usable', 1.0), 'medium');
  assert.equal(bandToConfidence('fragile', 1.5), 'medium');
  assert.equal(bandToConfidence('uncertain', 0.2), 'low');
  assert.equal(bandToConfidence('unknown', 5), 'low');
});

/* -------------------------------------------------------------- derivation */

test('a deterministic passed application claim reaches usable at apply and below', () => {
  const emulsions = state['nema:emulsions'];
  assert.ok(emulsions, 'the concept is tracked');

  for (const ability of ['recognize', 'retrieve', 'explain', 'apply']) {
    const entry = emulsions[ability];
    assert.ok(entry, `${ability} has an entry`);
    assert.ok(
      entry.band === 'usable' || entry.band === 'durable',
      `${ability} is usable or durable, got ${entry.band}`
    );
    assert.equal(entry.graderWeight, WEIGHTS.deterministic);
    assert.deepEqual(entry.evidenceRefs, ['rcpt_emulsion_lab']);
  }

  // transfer sits above the claim on the ladder, so it stays untouched.
  assert.equal(emulsions.transfer, undefined);
  assert.equal(bestBand(emulsions), 'usable');
});

test('a later failed claim lowers the band and resets stability to 3 days', () => {
  const before = deriveState(receiptsExcept(['rcpt_knife_retest']), { now: NOW });
  const beforeApply = before['nema:knife-skills'].apply;
  assert.equal(beforeApply.band, 'usable');
  assert.equal(beforeApply.stabilityDays, 6, 'two passes double the interval');

  const afterApply = state['nema:knife-skills'].apply;
  assert.equal(afterApply.band, 'fragile');
  assert.ok(afterApply.score < beforeApply.score, 'the failure subtracts from the score');
  assert.equal(afterApply.stabilityDays, 3, 'a failure after a success restarts the schedule');
  assert.equal(afterApply.lastSuccess, '2026-08-20T09:00:00.000Z', 'the failure is not a success');

  const changes = diffStates(before, state);
  assert.deepEqual(
    changes.filter((change) => change.concept === 'nema:knife-skills' && change.ability === 'apply'),
    [{ concept: 'nema:knife-skills', ability: 'apply', from: 'usable', to: 'fragile' }]
  );
  assert.ok(changes.length >= 4, 'every ladder rung below apply moved too');
});

test('reviewDue is true exactly when nextReview is before now', () => {
  const due = state['nema:knife-skills'].apply;
  assert.equal(due.reviewDue, true);
  assert.ok(Date.parse(due.nextReview) < Date.parse(NOW));

  const notDue = state['nema:emulsions'].apply;
  assert.equal(notDue.reviewDue, false);
  assert.ok(Date.parse(notDue.nextReview) > Date.parse(NOW));

  // Move the clock past the review date and the same evidence becomes due.
  const later = deriveState(LEDGER.receipts, { now: '2026-09-10T12:00:00Z' });
  assert.equal(later['nema:emulsions'].apply.reviewDue, true);
});

test('exposure evidence never exceeds uncertain, however much of it there is', () => {
  const reading = state['nema:mise-en-place'].recognize;
  assert.equal(reading.graderWeight, WEIGHTS.exposure);
  assert.ok(
    reading.score >= 0.4,
    `raw score ${reading.score} would be fragile without the exposure cap`
  );
  assert.equal(reading.band, 'uncertain');
  assert.equal(toAssertionStatus(reading.band), 'uncertain');
  assert.equal(reading.nextReview, null, 'reading a page schedules no review');
  assert.equal(reading.stabilityDays, null);
});

test('pending receipts are ignored and agent assessed receipts are counted', () => {
  assert.equal(state['nema:kitchen-communication'], undefined, 'the unknown issuer moved nothing');

  const stocks = state['nema:stocks'].explain;
  assert.equal(stocks.graderWeight, WEIGHTS['agent-assessed']);
  assert.equal(stocks.band, 'fragile');
  assert.deepEqual(stocks.evidenceRefs, ['rcpt_agent_stocks']);
});

test('deriveState is deterministic and tolerates junk input', () => {
  assert.deepEqual(deriveState(LEDGER.receipts, { now: NOW }), state);
  assert.deepEqual(deriveState([], { now: NOW }), {});
  assert.deepEqual(deriveState(null, { now: NOW }), {});
  assert.deepEqual(
    deriveState([null, {}, { payload: {} }, { payload: { claims: [{ concept: 'x' }] } }], { now: NOW }),
    {}
  );
});

test('diffStates reports nothing when nothing moved', () => {
  assert.deepEqual(diffStates(state, state), []);
  assert.deepEqual(diffStates({}, {}), []);
});

/* ----------------------------------------------------------------- summary */

test('summarize counts concepts by their best band and counts reviews due', () => {
  const summary = summarize(state, { now: NOW });

  const concepts = Object.keys(state);
  assert.equal(summary.concepts, concepts.length);

  const expectedBands = { durable: 0, usable: 0, fragile: 0, uncertain: 0, unknown: 0 };
  for (const concept of concepts) expectedBands[bestBand(state[concept])] += 1;
  for (const band of Object.keys(expectedBands)) {
    assert.equal(summary[band], expectedBands[band], `${band} count matches the derived state`);
  }
  assert.equal(
    summary.durable + summary.usable + summary.fragile + summary.uncertain + summary.unknown,
    summary.concepts,
    'every concept lands in exactly one band'
  );

  const expectedDue = concepts.filter((concept) => (
    Object.values(state[concept]).some((entry) => (
      entry.nextReview !== null && Date.parse(entry.nextReview) < Date.parse(NOW)
    ))
  )).length;
  assert.equal(summary.reviewsDue, expectedDue);

  // The fixture is small enough to state the answer outright.
  assert.deepEqual(summary, {
    concepts: 5,
    durable: 0,
    usable: 1,
    fragile: 2,
    uncertain: 2,
    unknown: 0,
    reviewsDue: 2
  });

  assert.deepEqual(summarize({}, { now: NOW }), {
    concepts: 0, durable: 0, usable: 0, fragile: 0, uncertain: 0, unknown: 0, reviewsDue: 0
  });
});

/* ------------------------------------------------------------------- needs */

const needsState = deriveState(NEEDS.receipts, { now: NEEDS.now });
const needsOptions = {
  concepts: CONCEPTS,
  goals: NEEDS.goals,
  misconceptions: NEEDS.misconceptions,
  now: NEEDS.now
};

test('NEED_KINDS lists every kind the vault can ask for', () => {
  assert.deepEqual(NEED_KINDS, [
    'acquire', 'retrieve', 'apply', 'transfer', 'discriminate', 'repair_misconception', 'reassess'
  ]);
});

test('a strong apply with a confusable neighbour and no discrimination evidence ranks first', () => {
  const needs = computeNeeds(needsState, needsOptions);
  assert.ok(needs.length > 1, 'the fixture produces several needs');

  const first = needs[0];
  assert.equal(first.kind, 'discriminate');
  assert.equal(first.concept, 'nema:emulsions');
  assert.equal(first.confusableWith, 'nema:reduction');
  assert.equal(first.ability, 'discriminate');
  assert.equal(needsState['nema:emulsions'].discriminate, undefined, 'no discrimination evidence');
  assert.ok(first.reason.includes('no_discrimination_evidence'));
  assert.ok(first.reason.includes('active_goal_depends_on_this_concept'));
  assert.equal(first.goalRelevance, 1.5);
  assert.equal(first.rubric.length, 3, 'the rubric comes from the concept registry');

  for (let i = 1; i < needs.length; i += 1) {
    assert.ok(needs[i].priority <= needs[i - 1].priority, 'needs are sorted by priority');
  }

  const budgeted = computeNeeds(needsState, { ...needsOptions, budgetMinutes: 5 });
  assert.equal(budgeted.length, 1);
  assert.equal(budgeted[0].needId, first.needId);
});

test('budget filling respects the minutes it is given', () => {
  for (const budgetMinutes of [2, 4, 5, 9, 12, 20, 60]) {
    const picked = computeNeeds(needsState, { ...needsOptions, budgetMinutes });
    const total = picked.reduce((sum, need) => sum + need.minutes, 0);
    assert.ok(total <= budgetMinutes, `${total} minutes fits in ${budgetMinutes}`);
    for (const need of picked) assert.ok(need.minutes > 0);
  }

  assert.equal(computeNeeds(needsState, { ...needsOptions, budgetMinutes: 2 }).length, 0,
    'nothing in the fixture fits in 2 minutes');

  const all = computeNeeds(needsState, needsOptions);
  const generous = computeNeeds(needsState, { ...needsOptions, budgetMinutes: 1000 });
  assert.deepEqual(generous.map((need) => need.needId), all.map((need) => need.needId));
});

test('every need carries the full LearningNeed shape', () => {
  const needs = computeNeeds(needsState, {
    ...needsOptions,
    misconceptions: [{
      concept: 'nema:seasoning',
      id: 'salt_only_at_the_end',
      text: 'Salt belongs at the end, so the dish does not get too salty.',
      recordedAt: '2026-08-30T09:00:00Z'
    }]
  });

  const repair = needs.find((need) => need.kind === 'repair_misconception');
  assert.ok(repair, 'a recorded misconception produces a repair need');
  assert.equal(repair.concept, 'nema:seasoning');
  assert.equal(repair.urgency, 0.8);
  assert.deepEqual(repair.misconceptions, [{
    id: 'salt_only_at_the_end',
    text: 'Salt belongs at the end, so the dish does not get too salty.'
  }]);
  assert.ok(repair.reason.includes('recorded_misconception'));

  for (const need of needs) {
    assert.match(need.needId, /^need_[0-9a-z]{7}$/);
    assert.ok(NEED_KINDS.includes(need.kind), `${need.kind} is a known kind`);
    assert.ok([...ABILITY_LADDER, 'discriminate'].includes(need.ability));
    assert.equal(typeof need.concept, 'string');
    assert.ok(Array.isArray(need.reason) && need.reason.length > 0);
    assert.ok(need.urgency > 0 && need.urgency <= 1);
    assert.ok(Number.isFinite(need.minutes) && need.minutes > 0);
    assert.ok(need.confusableWith === null || typeof need.confusableWith === 'string');
    assert.equal(typeof need.exerciseHint, 'string');
    assert.ok(need.exerciseHint.length > 0);
    assert.ok(Array.isArray(need.rubric));
    assert.equal(typeof need.constraints.maxHints, 'number');
    assert.equal(need.constraints.doNotRevealAnswerBeforeSubmission, true);
  }

  const ids = needs.map((need) => need.needId);
  assert.equal(new Set(ids).size, ids.length, 'need ids are unique within one call');
});

test('need ids are stable across calls and across clocks', () => {
  const first = computeNeeds(needsState, needsOptions);
  const second = computeNeeds(needsState, needsOptions);
  assert.deepEqual(second.map((need) => need.needId), first.map((need) => need.needId));

  const later = computeNeeds(needsState, { ...needsOptions, now: '2026-09-02T12:00:00Z' });
  const target = first.find((need) => need.kind === 'discriminate' && need.concept === 'nema:emulsions');
  const same = later.find((need) => need.kind === 'discriminate' && need.concept === 'nema:emulsions');
  assert.equal(same.needId, target.needId);
});

test('needs cover the remaining triggers on the main ledger', () => {
  const needs = computeNeeds(state, {
    concepts: CONCEPTS,
    goals: [{ goalId: 'goal_x', title: 'Send a sauce that holds', concepts: ['nema:emulsions'] }],
    misconceptions: [],
    now: NOW
  });
  const byKind = (kind) => needs.filter((need) => need.kind === kind);

  const review = byKind('retrieve').find((need) => need.concept === 'nema:knife-skills');
  assert.ok(review, 'an overdue review becomes a retrieve need');
  assert.ok(review.urgency > 0.6 && review.urgency <= 1);
  assert.equal(review.constraints.maxHints, 0, 'recall is closed book');
  assert.ok(review.reason.some((reason) => reason.startsWith('overdue_by_')));

  const reassess = byKind('reassess').find((need) => need.concept === 'nema:plating');
  assert.ok(reassess, 'self reported evidence asks to be reassessed');
  assert.equal(reassess.urgency, 0.45);

  const acquire = byKind('acquire').find((need) => need.concept === 'nema:heat-control');
  assert.ok(acquire, 'an untouched prerequisite of a goal concept becomes an acquire need');
  assert.equal(acquire.goalRelevance, 1.2);
  assert.ok(acquire.reason.includes('prerequisite_of_an_active_goal'));

  assert.equal(byKind('transfer').length, 0, 'nothing is durable yet');
  assert.equal(computeNeeds({}, { concepts: CONCEPTS, now: NOW }).length, 0, 'no state, no needs');
});

test('an apply need appears when the learner can explain but cannot yet do', () => {
  const needs = computeNeeds(needsState, needsOptions);
  const apply = needs.find((need) => need.kind === 'apply' && need.concept === 'nema:seasoning');

  assert.ok(apply, 'explain usable and apply unknown asks for application practice');
  assert.equal(needsState['nema:seasoning'].explain.band, 'usable');
  assert.equal(needsState['nema:seasoning'].apply, undefined);
  assert.equal(apply.urgency, 0.7);
  assert.equal(apply.minutes, 6, 'minutes come from the concept registry');
  assert.deepEqual(apply.reason, ['explanation_is_solid', 'application_is_weak']);
});

test('a durable apply with no transfer evidence asks for transfer', () => {
  const durable = deriveState([
    { receiptId: 'r1', status: 'verified', payload: applyReceipt('r1', 'passed', '2026-08-30T10:00:00Z') },
    { receiptId: 'r2', status: 'verified', payload: applyReceipt('r2', 'passed', '2026-08-28T10:00:00Z') }
  ], { now: NOW });

  assert.equal(durable['nema:emulsions'].apply.band, 'durable');

  const needs = computeNeeds(durable, { concepts: CONCEPTS, now: NOW });
  const transfer = needs.find((need) => need.kind === 'transfer');
  assert.ok(transfer);
  assert.equal(transfer.concept, 'nema:emulsions');
  assert.equal(transfer.ability, 'transfer');
  assert.equal(transfer.urgency, 0.35);
  assert.equal(transfer.minutes, 4, 'no registry minutes for transfer, so the default applies');
});

function applyReceipt(receiptId, result, issuedAt) {
  return {
    type: 'evidence-receipt',
    protocol: 'nema/0.1',
    receiptId,
    issuer: 'https://saucier.example',
    keyId: 'saucier-2026-09',
    subject: 'lk_fixture',
    activity: { id: 'fix-the-broken-sauce', version: '1.0.0', title: 'Fix the broken sauce', contentHash: 'sha256:fixture' },
    claims: [{
      concept: 'nema:emulsions',
      ability: 'apply',
      evidenceType: 'application',
      result,
      difficulty: 'intermediate'
    }],
    conditions: { attempts: 1, hintsUsed: 0, durationSeconds: 300, grader: 'deterministic', graderVersion: '1' },
    issuedAt
  };
}

test('every need for a concept in the registry carries a rubric to grade against', () => {
  // An empty rubric is a free pass: record_agent_assessment marks a need passed
  // when every criterion is met, and no criteria at all always satisfies that.
  const registry = new Map(CONCEPTS.map((concept) => [concept.id, concept]));
  const batches = [
    computeNeeds(needsState, needsOptions),
    computeNeeds(state, { concepts: CONCEPTS, goals: NEEDS.goals, now: NOW }),
    computeNeeds(seedState(), seedOptions())
  ];

  let checked = 0;
  for (const needs of batches) {
    for (const need of needs) {
      const def = registry.get(need.concept);
      if (!def || !def.rubric || Object.keys(def.rubric).length === 0) continue;
      checked += 1;
      assert.ok(
        need.rubric.length > 0,
        `${need.kind} need for ${need.concept} (${need.ability}) has an empty rubric`
      );
      for (const criterion of need.rubric) {
        assert.equal(typeof criterion, 'string');
        assert.ok(criterion.length > 0);
      }
    }
  }
  assert.ok(checked > 20, `the batches cover enough needs, checked ${checked}`);

  // The registry has no `retrieve` or `transfer` rubric anywhere, so both kinds
  // exercise the fallback rather than an exact hit.
  const retrieveNeed = batches[1].find((need) => need.concept === 'nema:knife-skills' && need.kind === 'retrieve');
  assert.ok(retrieveNeed, 'the overdue JSON Schema review is in the batch');
  assert.deepEqual(retrieveNeed.rubric, registry.get('nema:knife-skills').rubric.apply);

  // A concept with no rubric at all still returns an array, just an empty one.
  const bare = computeNeeds(needsState, {
    ...needsOptions,
    concepts: [{ id: 'nema:emulsions', title: 'Emulsions', minutes: { discriminate: 4 }, confusableWith: ['nema:reduction'] }]
  });
  for (const need of bare) assert.deepEqual(need.rubric, []);
});

test('a due discriminate review is both counted and offered', () => {
  const receipts = [{
    receiptId: 'rcpt_disc',
    status: 'verified',
    receivedAt: '2026-08-01T10:05:00Z',
    payload: {
      type: 'evidence-receipt',
      protocol: 'nema/0.1',
      receiptId: 'rcpt_disc',
      issuer: 'https://linecook.example',
      keyId: 'linecook-2026-09',
      subject: 'lk_fixture',
      activity: { id: 'emulsion-or-reduction', version: '1.0.0', title: 'Emulsion or reduction', contentHash: 'sha256:fixture' },
      claims: [{
        concept: 'nema:emulsions',
        ability: 'discriminate',
        evidenceType: 'discrimination',
        result: 'passed',
        difficulty: 'intermediate'
      }],
      conditions: { attempts: 1, hintsUsed: 0, durationSeconds: 240, grader: 'provider-rubric', graderVersion: '1' },
      issuedAt: '2026-08-01T10:00:00Z'
    }
  }];

  const only = deriveState(receipts, { now: NOW });
  assert.deepEqual(Object.keys(only['nema:emulsions']), ['discriminate'], 'discriminate is off the ladder');
  assert.equal(only['nema:emulsions'].discriminate.reviewDue, true);
  assert.equal(summarize(only, { now: NOW }).reviewsDue, 1);

  const needs = computeNeeds(only, { concepts: CONCEPTS, now: NOW });
  const review = needs.find((need) => need.kind === 'retrieve');
  assert.ok(review, 'the summary strip and the needs panel agree');
  assert.equal(review.concept, 'nema:emulsions');
  assert.equal(review.ability, 'discriminate', 'the side ability is practised as itself');
  assert.equal(review.minutes, 4, 'minutes come from minutes.discriminate');
  assert.equal(review.urgency, 1, 'a review 28 days overdue is as urgent as it gets');

  // When a ladder review is due as well, the need is labelled as recall: one
  // retrieve need per concept, so the ids stay unique.
  const both = deriveState([
    ...receipts,
    { receiptId: 'rcpt_old_apply', status: 'verified', payload: applyReceipt('rcpt_old_apply', 'passed', '2026-08-01T09:00:00Z') }
  ], { now: NOW });
  const ladderReviews = computeNeeds(both, { concepts: CONCEPTS, now: NOW })
    .filter((need) => need.kind === 'retrieve' && need.concept === 'nema:emulsions');
  assert.equal(ladderReviews.length, 1);
  assert.equal(ladderReviews[0].ability, 'retrieve');
  assert.equal(ladderReviews[0].minutes, 3);
});

test('all misconceptions recorded for one concept ride in a single repair need', () => {
  const misconceptions = [
    { concept: 'nema:emulsions', id: 'm1', text: 'Once an emulsion holds, it is stable and can be boiled.' },
    { concept: 'nema:emulsions', id: 'm2', text: 'A vinaigrette that has held for an hour cannot break.' }
  ];
  const needs = computeNeeds(needsState, { ...needsOptions, misconceptions });
  const repairs = needs.filter((need) => need.kind === 'repair_misconception');

  assert.equal(repairs.length, 1, 'one repair need per concept, so the need ids stay unique');
  assert.deepEqual(repairs[0].misconceptions, [
    { id: 'm1', text: 'Once an emulsion holds, it is stable and can be boiled.' },
    { id: 'm2', text: 'A vinaigrette that has held for an hour cannot break.' }
  ]);
  assert.ok(repairs[0].reason.includes('m1'));
  assert.ok(repairs[0].reason.includes('m2'), 'the second misconception is not dropped silently');
});

test('only verified and agent receipts move learner state', () => {
  const base = {
    receiptId: 'rcpt_status',
    receivedAt: '2026-08-31T10:05:00Z',
    payload: {
      type: 'evidence-receipt',
      protocol: 'nema/0.1',
      receiptId: 'rcpt_status',
      issuer: 'https://saucier.example',
      keyId: 'saucier-2026-09',
      subject: 'lk_fixture',
      activity: { id: 'fix-the-broken-sauce', version: '1.0.0', title: 'Fix the broken sauce', contentHash: 'sha256:fixture' },
      claims: [{
        concept: 'nema:emulsions',
        ability: 'apply',
        evidenceType: 'application',
        result: 'passed',
        difficulty: 'intermediate'
      }],
      conditions: { attempts: 1, hintsUsed: 0, durationSeconds: 300, grader: 'deterministic', graderVersion: '1' },
      issuedAt: '2026-08-31T10:00:00Z'
    }
  };

  for (const status of ['verified', 'agent']) {
    const derived = deriveState([{ ...base, status }], { now: NOW });
    assert.equal(derived['nema:emulsions'].apply.band, 'usable', `${status} counts`);
  }
  for (const status of ['pending', 'rejected', 'Verified', '', undefined]) {
    const derived = deriveState([{ ...base, status }], { now: NOW });
    assert.deepEqual(derived, {}, `status ${String(status)} is not evidence`);
  }
});

test('now is required, so nothing here can read the system clock', () => {
  const message = /options\.now is required/;
  assert.throws(() => deriveState([], {}), message);
  assert.throws(() => deriveState([]), message);
  assert.throws(() => deriveState([], { now: 'not a date' }), message);
  assert.throws(() => summarize({}, {}), message);
  assert.throws(() => computeNeeds({}, { concepts: CONCEPTS }), message);

  // Epoch milliseconds are accepted as well as an ISO string.
  assert.deepEqual(deriveState(LEDGER.receipts, { now: Date.parse(NOW) }), state);
});

/* --------------------------------------------------- the seeded golden path */

const DAY_MS = 86400000;

/** Date a seed shaped receipt, optionally shifting the whole story forward. */
function datedReceipt(receipt, shiftDays) {
  const issuedAt = new Date(
    Date.parse(SEED.baseDate) - Math.max(0, receipt.daysAgo - shiftDays) * DAY_MS
  ).toISOString();
  return { ...receipt, receivedAt: issuedAt, payload: { ...receipt.payload, issuedAt } };
}

function seedLedger({ shiftDays = 0, withLab = true } = {}) {
  const receipts = SEED.receipts.map((receipt) => datedReceipt(receipt, shiftDays));
  if (withLab) receipts.push(datedReceipt(SEED.saucierReceipt, 0));
  return receipts;
}

function seedState(options = {}) {
  return deriveState(seedLedger(options), { now: SEED.now });
}

function seedOptions(overrides = {}) {
  return {
    concepts: CONCEPTS,
    goals: SEED.goals,
    misconceptions: SEED.misconceptions,
    now: SEED.now,
    ...overrides
  };
}

const summaryOf = (needs) => needs.map((need) => `${need.kind}:${need.concept}`);

test('the seeded story concepts land in the bands the demo talks about', () => {
  const before = seedState({ withLab: false });
  assert.equal(before['nema:emulsions'], undefined, 'emulsions starts with no evidence at all');
  assert.equal(before['nema:heat-control'].apply.band, 'usable', 'the prerequisite is already verified');
  assert.equal(before['nema:knife-skills'].apply.band, 'uncertain', 'a self report stays weak');

  const after = seedState();
  assert.equal(after['nema:emulsions'].apply.band, 'usable', 'the Saucier School lab moves emulsions');
  assert.deepEqual(
    diffStates(before, after).filter((change) => change.concept === 'nema:emulsions'),
    [
      { concept: 'nema:emulsions', ability: 'recognize', from: 'unknown', to: 'usable' },
      { concept: 'nema:emulsions', ability: 'retrieve', from: 'unknown', to: 'usable' },
      { concept: 'nema:emulsions', ability: 'explain', from: 'unknown', to: 'usable' },
      { concept: 'nema:emulsions', ability: 'apply', from: 'unknown', to: 'usable' }
    ]
  );
  assert.equal(toAssertionStatus(after['nema:heat-control'].apply.band), 'verified');
});

test('a ledger where every review is overdue fills the 5 minute review with recall', () => {
  // The arithmetic, pinned so a change is loud. Every receipt in this fixture is
  // 5 to 40 days old and carries one or two passes, so stability is 3 to 6 days
  // and every review is overdue. An overdue retrieve need (urgency up to 1,
  // 3 minutes) then outranks the emulsions discriminate need (0.65 * 1.5 / 4),
  // and recall takes the whole five minutes. This is why the shipped demo
  // ledger in shared/seed-evidence.json backfills a year of early coursework:
  // the extra passes push the review intervals out to 60 days, so only the
  // handful of concepts that are meant to be due are due.
  const needs = computeNeeds(seedState(), seedOptions({ budgetMinutes: 5 }));
  assert.deepEqual(summaryOf(needs), ['retrieve:nema:heat-control']);

  const all = computeNeeds(seedState(), seedOptions());
  assert.deepEqual(summaryOf(all).slice(0, 6), [
    'retrieve:nema:heat-control',
    'retrieve:nema:reduction',
    'retrieve:nema:stocks',
    'retrieve:nema:ratios',
    'repair_misconception:nema:emulsions',
    'discriminate:nema:emulsions'
  ]);
  const discriminate = all.find((need) => need.kind === 'discriminate' && need.concept === 'nema:emulsions');
  assert.ok(discriminate, 'the discriminate need exists, it just does not fit in five minutes');
  assert.equal(discriminate.confusableWith, 'nema:reduction');
  assert.equal(discriminate.rubric.length, 3);
});

test('with no review overdue, the 5 minute review is the discriminate need', () => {
  // The other half of the same arithmetic: with nothing overdue, discrimination
  // is the top need. Shifting this fixture 20 days forward is the cheap way to
  // get there; the shipped seed gets there with its coursework backfill.
  const fresh = seedState({ shiftDays: 20 });
  assert.equal(summarize(fresh, { now: SEED.now }).reviewsDue, 0, 'nothing is overdue');

  const noMisconception = computeNeeds(fresh, seedOptions({ misconceptions: [], budgetMinutes: 5 }));
  assert.deepEqual(summaryOf(noMisconception), ['discriminate:nema:emulsions']);

  const first = computeNeeds(fresh, seedOptions({ misconceptions: [] }))[0];
  assert.equal(first.kind, 'discriminate');
  assert.equal(first.concept, 'nema:emulsions');
  assert.deepEqual(first.reason, [
    'application_is_strong',
    'no_discrimination_evidence',
    'active_goal_depends_on_this_concept'
  ]);

  // The seed also records a misconception on the same concept, and repairing a
  // misconception outranks discrimination, so the promised pair needs 8 minutes.
  assert.deepEqual(
    summaryOf(computeNeeds(fresh, seedOptions({ budgetMinutes: 5 }))),
    ['repair_misconception:nema:emulsions']
  );
  assert.deepEqual(summaryOf(computeNeeds(fresh, seedOptions({ budgetMinutes: 8 }))), [
    'repair_misconception:nema:emulsions',
    'discriminate:nema:emulsions'
  ]);
});

/* ------------------------------------------------------------- weightCap */

/* The trust tiers of contract section 21 arrive here as one optional function.
 * deriveState knows nothing about signatures or well known documents: it asks
 * the caller how much each receipt may ever be worth, and the vault answers
 * with the tier rule. */

function trustReceipt(trust, overrides = {}) {
  return {
    receiptId: `rcpt_${trust}`,
    status: 'verified',
    trust,
    payload: {
      type: 'evidence-receipt',
      protocol: 'nema/0.1',
      receiptId: `rcpt_${trust}`,
      issuer: 'https://maillard.example',
      keyId: `self:https://maillard.example`,
      subject: 'lk_fixture',
      activity: { id: 'check', version: '1.0.0', title: 'Two questions before you go' },
      claims: [{
        concept: 'nema:maillard-reaction',
        ability: 'apply',
        evidenceType: 'application',
        result: 'passed',
        difficulty: 'intermediate'
      }],
      conditions: { attempts: 1, hintsUsed: 0, durationSeconds: 120, grader: 'deterministic', graderVersion: '1' },
      issuedAt: NOW,
      ...overrides
    }
  };
}

const capSelf = (receipt) => (receipt.trust === 'self' ? WEIGHTS['self-report'] : Infinity);

test('weightCap caps what one receipt may ever be worth', () => {
  const uncapped = deriveState([trustReceipt('self')], { now: NOW });
  assert.equal(uncapped['nema:maillard-reaction'].apply.score, 1, 'a deterministic pass is worth 1 on its own');
  assert.equal(uncapped['nema:maillard-reaction'].apply.band, 'usable');

  const capped = deriveState([trustReceipt('self')], { now: NOW, weightCap: capSelf });
  const entry = capped['nema:maillard-reaction'].apply;
  assert.equal(entry.score, WEIGHTS['self-report'], 'the grader says deterministic, the tier says self report');
  assert.equal(entry.graderWeight, WEIGHTS['self-report']);
  assert.equal(entry.band, 'uncertain', 'a self signed pass never reaches usable on its own');
  assert.equal(entry.confidence, 'low');

  // The cap travels down the ladder with the claim, so no lower ability is
  // left uncapped.
  for (const ability of ['recognize', 'retrieve', 'explain']) {
    assert.equal(capped['nema:maillard-reaction'][ability].score, WEIGHTS['self-report']);
  }
});

test('weightCap is asked per receipt, so registered evidence is untouched', () => {
  const receipts = [trustReceipt('self'), trustReceipt('registered')];
  const capped = deriveState(receipts, { now: NOW, weightCap: capSelf });
  const entry = capped['nema:maillard-reaction'].apply;

  assert.equal(entry.score, 1.3, 'registered 1 plus self 0.3');
  assert.equal(entry.graderWeight, 1, 'the strongest grader behind it is still the registered one');
  assert.equal(entry.band, 'usable');
  assert.equal(entry.confidence, 'high');

  // Self signed passes still add up, exactly as repeated self reports do: two
  // of them reach fragile, which a provider reads as uncertain, not verified.
  const many = deriveState(
    [0, 1].map((n) => ({ ...trustReceipt('self'), receiptId: `rcpt_self_${n}` })),
    { now: NOW, weightCap: capSelf }
  );
  assert.equal(many['nema:maillard-reaction'].apply.score, 0.6);
  assert.equal(many['nema:maillard-reaction'].apply.band, 'fragile');
  assert.equal(toAssertionStatus(many['nema:maillard-reaction'].apply.band), 'uncertain');
});

test('deriveState without a weightCap behaves exactly as before', () => {
  assert.deepEqual(deriveState(LEDGER.receipts, { now: NOW, weightCap: undefined }), state);
  assert.deepEqual(deriveState(LEDGER.receipts, { now: NOW, weightCap: null }), state);
  assert.deepEqual(deriveState(LEDGER.receipts, { now: NOW, weightCap: () => Infinity }), state);
  // A cap that answers with nonsense is ignored, never read as zero.
  assert.deepEqual(deriveState(LEDGER.receipts, { now: NOW, weightCap: () => NaN }), state);
  assert.deepEqual(deriveState(LEDGER.receipts, { now: NOW, weightCap: () => 'heavy' }), state);
});

test('a cap of zero silences a receipt without ever inverting it', () => {
  const silent = deriveState([trustReceipt('self')], { now: NOW, weightCap: () => 0 });
  assert.equal(silent['nema:maillard-reaction'].apply.score, 0, 'the receipt is on record and worth nothing');
  assert.equal(silent['nema:maillard-reaction'].apply.band, 'unknown');

  const negative = deriveState([trustReceipt('self')], { now: NOW, weightCap: () => -5 });
  assert.equal(negative['nema:maillard-reaction'].apply.score, 0, 'a negative cap reads as zero');
  assert.equal(negative['nema:maillard-reaction'].apply.band, 'unknown', 'it never turns a pass into a failure');

  // A cap at or below the exposure weight is read as exposure grade evidence,
  // so the band is clamped the same way reading a page is.
  const exposure = deriveState([trustReceipt('self')], { now: NOW, weightCap: () => WEIGHTS.exposure });
  assert.equal(exposure['nema:maillard-reaction'].apply.band, 'uncertain');
  assert.equal(exposure['nema:maillard-reaction'].apply.nextReview, null, 'exposure grade evidence schedules no review');
});
