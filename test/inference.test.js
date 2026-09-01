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
  const evals = state['nema:agent-evals'];
  assert.ok(evals, 'the concept is tracked');

  for (const ability of ['recognize', 'retrieve', 'explain', 'apply']) {
    const entry = evals[ability];
    assert.ok(entry, `${ability} has an entry`);
    assert.ok(
      entry.band === 'usable' || entry.band === 'durable',
      `${ability} is usable or durable, got ${entry.band}`
    );
    assert.equal(entry.graderWeight, WEIGHTS.deterministic);
    assert.deepEqual(entry.evidenceRefs, ['rcpt_evals_lab']);
  }

  // transfer sits above the claim on the ladder, so it stays untouched.
  assert.equal(evals.transfer, undefined);
  assert.equal(bestBand(evals), 'usable');
});

test('a later failed claim lowers the band and resets stability to 3 days', () => {
  const before = deriveState(receiptsExcept(['rcpt_schema_retest']), { now: NOW });
  const beforeApply = before['nema:json-schema'].apply;
  assert.equal(beforeApply.band, 'usable');
  assert.equal(beforeApply.stabilityDays, 6, 'two passes double the interval');

  const afterApply = state['nema:json-schema'].apply;
  assert.equal(afterApply.band, 'fragile');
  assert.ok(afterApply.score < beforeApply.score, 'the failure subtracts from the score');
  assert.equal(afterApply.stabilityDays, 3, 'a failure after a success restarts the schedule');
  assert.equal(afterApply.lastSuccess, '2026-08-20T09:00:00.000Z', 'the failure is not a success');

  const changes = diffStates(before, state);
  assert.deepEqual(
    changes.filter((change) => change.concept === 'nema:json-schema' && change.ability === 'apply'),
    [{ concept: 'nema:json-schema', ability: 'apply', from: 'usable', to: 'fragile' }]
  );
  assert.ok(changes.length >= 4, 'every ladder rung below apply moved too');
});

test('reviewDue is true exactly when nextReview is before now', () => {
  const due = state['nema:json-schema'].apply;
  assert.equal(due.reviewDue, true);
  assert.ok(Date.parse(due.nextReview) < Date.parse(NOW));

  const notDue = state['nema:agent-evals'].apply;
  assert.equal(notDue.reviewDue, false);
  assert.ok(Date.parse(notDue.nextReview) > Date.parse(NOW));

  // Move the clock past the review date and the same evidence becomes due.
  const later = deriveState(LEDGER.receipts, { now: '2026-09-10T12:00:00Z' });
  assert.equal(later['nema:agent-evals'].apply.reviewDue, true);
});

test('exposure evidence never exceeds uncertain, however much of it there is', () => {
  const observability = state['nema:observability'].recognize;
  assert.equal(observability.graderWeight, WEIGHTS.exposure);
  assert.ok(
    observability.score >= 0.4,
    `raw score ${observability.score} would be fragile without the exposure cap`
  );
  assert.equal(observability.band, 'uncertain');
  assert.equal(toAssertionStatus(observability.band), 'uncertain');
  assert.equal(observability.nextReview, null, 'reading a page schedules no review');
  assert.equal(observability.stabilityDays, null);
});

test('pending receipts are ignored and agent assessed receipts are counted', () => {
  assert.equal(state['nema:memory-design'], undefined, 'the unknown issuer moved nothing');

  const toolCalling = state['nema:tool-calling'].explain;
  assert.equal(toolCalling.graderWeight, WEIGHTS['agent-assessed']);
  assert.equal(toolCalling.band, 'fragile');
  assert.deepEqual(toolCalling.evidenceRefs, ['rcpt_agent_tool_calling']);
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
  assert.equal(first.concept, 'nema:agent-evals');
  assert.equal(first.confusableWith, 'nema:unit-testing');
  assert.equal(first.ability, 'discriminate');
  assert.equal(needsState['nema:agent-evals'].discriminate, undefined, 'no discrimination evidence');
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
      concept: 'nema:feedback-loops',
      id: 'a_loop_always_corrects',
      text: 'Any feedback loop makes the agent more correct over time.',
      recordedAt: '2026-08-30T09:00:00Z'
    }]
  });

  const repair = needs.find((need) => need.kind === 'repair_misconception');
  assert.ok(repair, 'a recorded misconception produces a repair need');
  assert.equal(repair.concept, 'nema:feedback-loops');
  assert.equal(repair.urgency, 0.8);
  assert.deepEqual(repair.misconceptions, [{
    id: 'a_loop_always_corrects',
    text: 'Any feedback loop makes the agent more correct over time.'
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
  const target = first.find((need) => need.kind === 'discriminate' && need.concept === 'nema:agent-evals');
  const same = later.find((need) => need.kind === 'discriminate' && need.concept === 'nema:agent-evals');
  assert.equal(same.needId, target.needId);
});

test('needs cover the remaining triggers on the main ledger', () => {
  const needs = computeNeeds(state, {
    concepts: CONCEPTS,
    goals: [{ goalId: 'goal_x', title: 'Ship a safe agent', concepts: ['nema:agent-evals'] }],
    misconceptions: [],
    now: NOW
  });
  const byKind = (kind) => needs.filter((need) => need.kind === kind);

  const review = byKind('retrieve').find((need) => need.concept === 'nema:json-schema');
  assert.ok(review, 'an overdue review becomes a retrieve need');
  assert.ok(review.urgency > 0.6 && review.urgency <= 1);
  assert.equal(review.constraints.maxHints, 0, 'recall is closed book');
  assert.ok(review.reason.some((reason) => reason.startsWith('overdue_by_')));

  const reassess = byKind('reassess').find((need) => need.concept === 'nema:cost-latency');
  assert.ok(reassess, 'self reported evidence asks to be reassessed');
  assert.equal(reassess.urgency, 0.45);

  const acquire = byKind('acquire').find((need) => need.concept === 'nema:software-testing');
  assert.ok(acquire, 'an untouched prerequisite of a goal concept becomes an acquire need');
  assert.equal(acquire.goalRelevance, 1.2);
  assert.ok(acquire.reason.includes('prerequisite_of_an_active_goal'));

  assert.equal(byKind('transfer').length, 0, 'nothing is durable yet');
  assert.equal(computeNeeds({}, { concepts: CONCEPTS, now: NOW }).length, 0, 'no state, no needs');
});

test('an apply need appears when the learner can explain but cannot yet do', () => {
  const needs = computeNeeds(needsState, needsOptions);
  const apply = needs.find((need) => need.kind === 'apply' && need.concept === 'nema:feedback-loops');

  assert.ok(apply, 'explain usable and apply unknown asks for application practice');
  assert.equal(needsState['nema:feedback-loops'].explain.band, 'usable');
  assert.equal(needsState['nema:feedback-loops'].apply, undefined);
  assert.equal(apply.urgency, 0.7);
  assert.equal(apply.minutes, 6, 'minutes come from the concept registry');
  assert.deepEqual(apply.reason, ['explanation_is_solid', 'application_is_weak']);
});

test('a durable apply with no transfer evidence asks for transfer', () => {
  const durable = deriveState([
    { receiptId: 'r1', status: 'verified', payload: applyReceipt('r1', 'passed', '2026-08-30T10:00:00Z') },
    { receiptId: 'r2', status: 'verified', payload: applyReceipt('r2', 'passed', '2026-08-28T10:00:00Z') }
  ], { now: NOW });

  assert.equal(durable['nema:agent-evals'].apply.band, 'durable');

  const needs = computeNeeds(durable, { concepts: CONCEPTS, now: NOW });
  const transfer = needs.find((need) => need.kind === 'transfer');
  assert.ok(transfer);
  assert.equal(transfer.concept, 'nema:agent-evals');
  assert.equal(transfer.ability, 'transfer');
  assert.equal(transfer.urgency, 0.35);
  assert.equal(transfer.minutes, 4, 'no registry minutes for transfer, so the default applies');
});

function applyReceipt(receiptId, result, issuedAt) {
  return {
    type: 'evidence-receipt',
    protocol: 'nema/0.1',
    receiptId,
    issuer: 'https://nema-harness.example',
    keyId: 'harness-2026-09',
    subject: 'lk_fixture',
    activity: { id: 'eval-design-lab', version: '1.0.0', title: 'Fix the broken harness', contentHash: 'sha256:fixture' },
    claims: [{
      concept: 'nema:agent-evals',
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
  const retrieveNeed = batches[1].find((need) => need.concept === 'nema:json-schema' && need.kind === 'retrieve');
  assert.ok(retrieveNeed, 'the overdue JSON Schema review is in the batch');
  assert.deepEqual(retrieveNeed.rubric, registry.get('nema:json-schema').rubric.apply);

  // A concept with no rubric at all still returns an array, just an empty one.
  const bare = computeNeeds(needsState, {
    ...needsOptions,
    concepts: [{ id: 'nema:agent-evals', title: 'Agent evals', minutes: { discriminate: 4 }, confusableWith: ['nema:unit-testing'] }]
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
      issuer: 'https://nema-security.example',
      keyId: 'security-2026-09',
      subject: 'lk_fixture',
      activity: { id: 'evals-vs-unit-tests', version: '1.0.0', title: 'Evals or unit tests', contentHash: 'sha256:fixture' },
      claims: [{
        concept: 'nema:agent-evals',
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
  assert.deepEqual(Object.keys(only['nema:agent-evals']), ['discriminate'], 'discriminate is off the ladder');
  assert.equal(only['nema:agent-evals'].discriminate.reviewDue, true);
  assert.equal(summarize(only, { now: NOW }).reviewsDue, 1);

  const needs = computeNeeds(only, { concepts: CONCEPTS, now: NOW });
  const review = needs.find((need) => need.kind === 'retrieve');
  assert.ok(review, 'the summary strip and the needs panel agree');
  assert.equal(review.concept, 'nema:agent-evals');
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
    .filter((need) => need.kind === 'retrieve' && need.concept === 'nema:agent-evals');
  assert.equal(ladderReviews.length, 1);
  assert.equal(ladderReviews[0].ability, 'retrieve');
  assert.equal(ladderReviews[0].minutes, 3);
});

test('all misconceptions recorded for one concept ride in a single repair need', () => {
  const misconceptions = [
    { concept: 'nema:agent-evals', id: 'm1', text: 'If the unit tests pass, the agent works.' },
    { concept: 'nema:agent-evals', id: 'm2', text: 'A single good run proves the agent is correct.' }
  ];
  const needs = computeNeeds(needsState, { ...needsOptions, misconceptions });
  const repairs = needs.filter((need) => need.kind === 'repair_misconception');

  assert.equal(repairs.length, 1, 'one repair need per concept, so the need ids stay unique');
  assert.deepEqual(repairs[0].misconceptions, [
    { id: 'm1', text: 'If the unit tests pass, the agent works.' },
    { id: 'm2', text: 'A single good run proves the agent is correct.' }
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
      issuer: 'https://nema-harness.example',
      keyId: 'harness-2026-09',
      subject: 'lk_fixture',
      activity: { id: 'eval-design-lab', version: '1.0.0', title: 'Fix the broken harness', contentHash: 'sha256:fixture' },
      claims: [{
        concept: 'nema:agent-evals',
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
    assert.equal(derived['nema:agent-evals'].apply.band, 'usable', `${status} counts`);
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
  if (withLab) receipts.push(datedReceipt(SEED.harnessReceipt, 0));
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
  assert.equal(before['nema:agent-evals'], undefined, 'agent evals starts with no evidence at all');
  assert.equal(before['nema:software-testing'].apply.band, 'usable', 'the prerequisite is already verified');
  assert.equal(before['nema:json-schema'].apply.band, 'uncertain', 'a self report stays weak');

  const after = seedState();
  assert.equal(after['nema:agent-evals'].apply.band, 'usable', 'the harness lab moves agent evals');
  assert.deepEqual(
    diffStates(before, after).filter((change) => change.concept === 'nema:agent-evals'),
    [
      { concept: 'nema:agent-evals', ability: 'recognize', from: 'unknown', to: 'usable' },
      { concept: 'nema:agent-evals', ability: 'retrieve', from: 'unknown', to: 'usable' },
      { concept: 'nema:agent-evals', ability: 'explain', from: 'unknown', to: 'usable' },
      { concept: 'nema:agent-evals', ability: 'apply', from: 'unknown', to: 'usable' }
    ]
  );
  assert.equal(toAssertionStatus(after['nema:software-testing'].apply.band), 'verified');
});

test('the seed as dated today fills a 5 minute review with an overdue recall, not the discriminate need', () => {
  // This is the contract arithmetic, pinned so a change is loud. Every seed
  // receipt is 5 to 40 days old and stability is 3 to 6 days, so every review is
  // overdue, and an overdue retrieve need (urgency up to 1, 3 minutes) outranks
  // the agent evals discriminate need (0.65 * 1.5 / 4). The demo prompt "Build
  // my best 5 minute review" therefore does not produce the discriminate need
  // the contract advertises unless the seed dates are moved forward or the
  // discriminate need is given more urgency.
  const needs = computeNeeds(seedState(), seedOptions({ budgetMinutes: 5 }));
  assert.deepEqual(summaryOf(needs), ['retrieve:nema:software-testing']);

  const all = computeNeeds(seedState(), seedOptions());
  assert.deepEqual(summaryOf(all).slice(0, 6), [
    'retrieve:nema:software-testing',
    'retrieve:nema:unit-testing',
    'retrieve:nema:tool-calling',
    'retrieve:nema:agent-loop',
    'repair_misconception:nema:agent-evals',
    'discriminate:nema:agent-evals'
  ]);
  const discriminate = all.find((need) => need.kind === 'discriminate' && need.concept === 'nema:agent-evals');
  assert.ok(discriminate, 'the discriminate need exists, it just does not fit in five minutes');
  assert.equal(discriminate.confusableWith, 'nema:unit-testing');
  assert.equal(discriminate.rubric.length, 3);
});

test('with the story dated so no review is overdue, the 5 minute review is the discriminate need', () => {
  // What the demo needs: seed receipts recent enough that the schedule is not
  // already overdue. Shifting the whole story 20 days forward does that.
  const fresh = seedState({ shiftDays: 20 });
  assert.equal(summarize(fresh, { now: SEED.now }).reviewsDue, 0, 'nothing is overdue');

  const noMisconception = computeNeeds(fresh, seedOptions({ misconceptions: [], budgetMinutes: 5 }));
  assert.deepEqual(summaryOf(noMisconception), ['discriminate:nema:agent-evals']);

  const first = computeNeeds(fresh, seedOptions({ misconceptions: [] }))[0];
  assert.equal(first.kind, 'discriminate');
  assert.equal(first.concept, 'nema:agent-evals');
  assert.deepEqual(first.reason, [
    'application_is_strong',
    'no_discrimination_evidence',
    'active_goal_depends_on_this_concept'
  ]);

  // The seed also records a misconception on the same concept, and repairing a
  // misconception outranks discrimination, so the promised pair needs 8 minutes.
  assert.deepEqual(
    summaryOf(computeNeeds(fresh, seedOptions({ budgetMinutes: 5 }))),
    ['repair_misconception:nema:agent-evals']
  );
  assert.deepEqual(summaryOf(computeNeeds(fresh, seedOptions({ budgetMinutes: 8 }))), [
    'repair_misconception:nema:agent-evals',
    'discriminate:nema:agent-evals'
  ]);
});
