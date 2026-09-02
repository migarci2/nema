/**
 * The learner model of contract section 30. Run with:
 *   node --test test/learning-fast.test.js
 *
 * Section 30 turns `docs/LEARNING_FAST_NOTES.md` into arithmetic, and this file
 * holds that arithmetic to the note it came from. One rule per test, each on a
 * six concept fixture small enough to compute by hand, and then the same rules
 * on the registry and the demo ledger that actually ship.
 *
 *   fractional implicit repetition   notes 7, 8, 9   Skycak on FIRe
 *   edge of mastery                  notes 10, 11    mastery learning
 *   interleaving and interference    notes 17, 18    desirable difficulty
 *   the illusion of understanding    notes 5, 19     rereading is not recall
 *   minimum effective dose           notes 12, 27    many short attempts
 *   audits, not grades               note 28         an error is a node
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import {
  GRADED_WEIGHT,
  IMPLICIT_FRACTION,
  WEIGHTS,
  applyImplicitRepetition,
  bestBand,
  computeNeeds,
  deriveState,
  encompassedPrereqs,
  summarize,
  toAssertionStatus
} from '../shared/inference.js';

function readJson(relative) {
  return JSON.parse(readFileSync(fileURLToPath(new URL(relative, import.meta.url)), 'utf8'));
}

const CONCEPTS = readJson('./fixtures/learning-fast-concepts.json');
const REGISTRY = readJson('../shared/concepts.json');
const SEED = readJson('../shared/seed-evidence.json');

const NOW = '2026-09-02T12:00:00Z';
const DAY_MS = 86400000;

/** A receipt, dated by how many days ago it was issued. */
function receipt({ id, claims, grader = 'provider-rubric', daysAgo = 1, status = 'verified' }) {
  const issuedAt = new Date(Date.parse(NOW) - daysAgo * DAY_MS).toISOString();
  return {
    receiptId: id,
    status,
    receivedAt: issuedAt,
    payload: {
      type: 'evidence-receipt',
      protocol: 'nema/0.1',
      receiptId: id,
      issuer: 'https://saucier.example',
      keyId: 'saucier-2026-09',
      subject: 'lk_fixture',
      activity: { id: 'fixture', version: '1.0.0', title: 'Fixture', contentHash: 'sha256:fixture' },
      claims: claims.map(([concept, ability, result = 'passed']) => ({
        concept,
        ability,
        evidenceType: ability === 'discriminate' ? 'discrimination' : 'application',
        result,
        difficulty: 'intermediate'
      })),
      conditions: { attempts: 1, hintsUsed: 0, durationSeconds: 300, grader, graderVersion: '1' },
      issuedAt
    }
  };
}

const derive = (receipts, now = NOW) => deriveState(receipts, { now });
const effective = (state, now = NOW) => applyImplicitRepetition(state, { concepts: CONCEPTS, now });
const needsOf = (state, options = {}) => computeNeeds(state, { concepts: CONCEPTS, now: NOW, ...options });
const label = (needs) => needs.map((need) => `${need.kind}:${need.concept}`);
// Scores and stabilities are rounded before they are stored, so equality here
// is equality to the last place the state keeps.
const close = (actual, expected, message, tolerance = 5e-4) => assert.ok(
  Math.abs(actual - expected) < tolerance,
  `${message}: ${actual} is not ${expected}`
);

/**
 * Ground evidence: a self check on every concept in the fixture, so implicit
 * repetition has somewhere to land. A self check is not graded, so none of it
 * lends anything downwards and each test can name its own single source.
 */
const GROUND = ['nema:ratios', 'nema:heat-control', 'nema:reduction', 'nema:deglazing', 'nema:emulsions'].map(
  (concept) => receipt({ id: `ground_${concept}`, claims: [[concept, 'apply']], grader: 'self-report', daysAgo: 40 })
);

/** Two graded passes: usable, with the next review four days out. */
const usable = (concept, ability = 'apply') => [
  receipt({ id: `${concept}_${ability}_1`, claims: [[concept, ability]], daysAgo: 8 }),
  receipt({ id: `${concept}_${ability}_2`, claims: [[concept, ability]], daysAgo: 2 })
];

/** One graded pass a month ago: fragile, and 27 days overdue. */
const overdue = (concept, ability = 'apply') => (
  receipt({ id: `${concept}_${ability}_old`, claims: [[concept, ability]], daysAgo: 30 })
);

/* ------------------------------------- fractional implicit repetition -- */

test('a graded pass lends a fraction of itself to every direct prerequisite', () => {
  // Note 7: maths, programming and cooking are hierarchical. Practising an
  // emulsion practises the ratio underneath it.
  const ledger = [...GROUND, receipt({ id: 'r_lab', claims: [['nema:emulsions', 'apply']], daysAgo: 1 })];
  const before = derive(ledger);
  const after = effective(before);

  const lent = before['nema:emulsions'].apply.gradedScore;
  assert.ok(lent > 0, 'the emulsions pass is graded, so it has something to lend');

  // The registry says emulsions encompasses ratios at 0.6. Heat control is not
  // named, so it takes the 0.5 default.
  close(after['nema:ratios'].apply.score - before['nema:ratios'].apply.score, 0.6 * lent,
    'ratios takes the declared fraction');
  close(
    after['nema:heat-control'].apply.score - before['nema:heat-control'].apply.score,
    IMPLICIT_FRACTION * lent,
    'heat control takes the default fraction'
  );
  assert.deepEqual(after['nema:ratios'].apply.implicit.from, ['nema:emulsions']);

  // The credit follows the ladder the claim already walked: an apply claim
  // reaches explain and below, and nothing above.
  for (const ability of ['recognize', 'retrieve', 'explain', 'apply']) {
    assert.ok(after['nema:ratios'][ability].score > before['nema:ratios'][ability].score, ability);
  }
  assert.equal(after['nema:ratios'].transfer, undefined);
});

test('the second level travels only through a relation the registry marks, at f squared', () => {
  const ledger = [...GROUND, receipt({ id: 'r_service', claims: [['nema:pan-sauces', 'apply']], daysAgo: 1 })];
  const before = derive(ledger);
  const after = effective(before);
  const lent = before['nema:pan-sauces'].apply.gradedScore;

  // One level: the declared fractions, and the default for the relation the
  // registry says nothing about.
  close(after['nema:emulsions'].apply.score - before['nema:emulsions'].apply.score, 0.8 * lent, 'emulsions');
  close(after['nema:deglazing'].apply.score - before['nema:deglazing'].apply.score, 0.7 * lent, 'deglazing');
  close(after['nema:reduction'].apply.score - before['nema:reduction'].apply.score, 0.5 * lent, 'reduction');

  // Two levels, and only through the marked hops. Ratios sits under emulsions
  // (0.8 squared). Heat control sits under emulsions and under deglazing, and
  // takes the better of the two, never the sum, and never the 0.5 hop through
  // reduction, which the registry did not mark.
  close(after['nema:ratios'].apply.score - before['nema:ratios'].apply.score, 0.8 ** 2 * lent, 'ratios at f squared');
  close(
    after['nema:heat-control'].apply.score - before['nema:heat-control'].apply.score,
    0.8 ** 2 * lent,
    'heat control takes the stronger of the two marked paths'
  );

  const edges = encompassedPrereqs(
    CONCEPTS.find((concept) => concept.id === 'nema:pan-sauces'),
    new Map(CONCEPTS.map((concept) => [concept.id, concept]))
  );
  assert.deepEqual([...edges.keys()].sort(), [
    'nema:deglazing', 'nema:emulsions', 'nema:heat-control', 'nema:ratios', 'nema:reduction'
  ]);
  assert.equal(edges.get('nema:emulsions').level, 1);
  assert.equal(edges.get('nema:ratios').level, 2);
});

test('implicit repetition is repetition, so it never opens an ability nobody asked about', () => {
  // Nothing has ever been asked of ratios or heat control here. Passing the
  // emulsion lab is not evidence that the learner can do either of them: the
  // vault records what the learner produced, and it produced nothing there.
  const only = derive([receipt({ id: 'r_lab', claims: [['nema:emulsions', 'apply']], daysAgo: 1 })]);
  assert.deepEqual(Object.keys(effective(only)), ['nema:emulsions']);

  // Ratios has been explained but never applied, so the implicit credit reaches
  // explain and stops there.
  const partial = derive([
    receipt({ id: 'r_explain', claims: [['nema:ratios', 'explain']], daysAgo: 30 }),
    receipt({ id: 'r_lab', claims: [['nema:emulsions', 'apply']], daysAgo: 1 })
  ]);
  const after = effective(partial);
  assert.deepEqual(Object.keys(after['nema:ratios']), ['recognize', 'retrieve', 'explain']);
  assert.ok(after['nema:ratios'].explain.score > partial['nema:ratios'].explain.score);
});

test('only a pass somebody else graded lends anything downwards', () => {
  const base = [receipt({ id: 'r_ratios', claims: [['nema:ratios', 'apply']], daysAgo: 40 })];

  for (const grader of ['self-report', 'exposure']) {
    const state = derive([...base, receipt({ id: `r_${grader}`, claims: [['nema:emulsions', 'apply']], grader, daysAgo: 1 })]);
    assert.equal(state['nema:emulsions'].apply.gradedPasses, 0, `${grader} is not a graded pass`);
    assert.deepEqual(effective(state), state, `${grader} lends nothing`);
  }

  // A failed claim lends nothing either. Failing a pan sauce is not evidence
  // about the ratio underneath it, in either direction.
  const failed = derive([...base, receipt({ id: 'r_failed', claims: [['nema:emulsions', 'apply', 'failed']], daysAgo: 1 })]);
  assert.equal(failed['nema:emulsions'].apply.gradedPasses, 0);
  assert.deepEqual(effective(failed), failed);

  assert.equal(GRADED_WEIGHT, WEIGHTS['agent-assessed'], 'graded means agent assessed or better');
});

test('an implicit repetition is half a pass, and it moves the next review', () => {
  // Ratios was last passed 20 days ago, twice, so it holds for 6 days and is
  // overdue. The emulsion lab yesterday practised it again.
  const older = [
    receipt({ id: 'r_ratios_1', claims: [['nema:ratios', 'apply']], daysAgo: 30 }),
    receipt({ id: 'r_ratios_2', claims: [['nema:ratios', 'apply']], daysAgo: 20 })
  ];
  const before = derive(older);
  assert.equal(before['nema:ratios'].apply.passes, 2);
  assert.equal(before['nema:ratios'].apply.stabilityDays, 6);
  assert.equal(before['nema:ratios'].apply.reviewDue, true);

  const after = effective(derive([...older, receipt({ id: 'r_lab', claims: [['nema:emulsions', 'apply']], daysAgo: 1 })]));
  const ratios = after['nema:ratios'].apply;
  assert.equal(ratios.passes, 2.5, 'one implicit repetition is worth half a pass');
  close(ratios.stabilityDays, 3 * 2 ** 1.5, 'half a pass is half a doubling', 0.01);
  assert.equal(ratios.lastSuccess, after['nema:emulsions'].apply.lastSuccess, 'the schedule restarts yesterday');
  assert.equal(ratios.reviewDue, false, 'and the review is no longer due');

  // A second level repetition is worth half of that again.
  const deep = effective(derive([...older, receipt({ id: 'r_service', claims: [['nema:pan-sauces', 'apply']], daysAgo: 1 })]));
  assert.equal(deep['nema:ratios'].apply.passes, 2.25, 'a second level repetition is a quarter of a pass');
});

test('practice older than the last direct success leaves the schedule alone', () => {
  // The emulsion lab was two months before the last ratios pass. It is already
  // inside the interval that pass set, so counting it again would push a review
  // away for work that had already happened.
  const state = derive([
    receipt({ id: 'r_lab', claims: [['nema:emulsions', 'apply']], daysAgo: 60 }),
    receipt({ id: 'r_ratios', claims: [['nema:ratios', 'apply']], daysAgo: 10 })
  ]);
  const after = effective(state);
  const before = state['nema:ratios'].apply;
  const ratios = after['nema:ratios'].apply;

  assert.ok(ratios.score > before.score, 'the score still counts it');
  assert.equal(ratios.passes, before.passes, 'the schedule does not');
  assert.equal(ratios.lastSuccess, before.lastSuccess);
  assert.equal(ratios.nextReview, before.nextReview);
});

test('applyImplicitRepetition is pure and does nothing without a registry', () => {
  const state = derive([...GROUND, receipt({ id: 'r_lab', claims: [['nema:emulsions', 'apply']], daysAgo: 1 })]);
  const snapshot = JSON.parse(JSON.stringify(state));
  const after = effective(state);

  assert.deepEqual(state, snapshot, 'the input state is untouched');
  assert.notDeepEqual(after, state, 'the result is a new state');
  assert.deepEqual(applyImplicitRepetition(state, { concepts: [], now: NOW }), state, 'no registry, no graph');
  assert.deepEqual(effective(after), effective(after), 'and it is deterministic');
});

/* ------------------------------------------------------ edge of mastery -- */

const GOAL = [{ goalId: 'goal_pan_sauce', title: 'Send a pan sauce that holds', concepts: ['nema:pan-sauces'] }];

test('a goal you are not ready for becomes the prerequisite that unblocks it', () => {
  // Note 10: do not teach X until its prerequisites are mastered. Deglazing and
  // reduction are usable, emulsions is untouched, so emulsions is the work.
  const state = derive([
    ...usable('nema:heat-control'),
    ...usable('nema:ratios'),
    ...usable('nema:deglazing'),
    ...usable('nema:reduction')
  ]);
  const needs = needsOf(state, { goals: GOAL });

  const acquire = needs.find((need) => need.kind === 'acquire' && need.concept === 'nema:emulsions');
  assert.ok(acquire, 'the weakest prerequisite is what the vault asks for');
  assert.ok(acquire.reason.includes('prerequisite_first'));
  assert.ok(acquire.reason.includes('before_pan_sauces'), 'and it names the goal it unblocks');

  // The goal itself stays on the list so it never disappears, at a quarter of
  // the urgency, and it says what to start with.
  const goal = needs.find((need) => need.kind === 'acquire' && need.concept === 'nema:pan-sauces');
  assert.ok(goal);
  assert.equal(goal.urgency, 0.25);
  assert.ok(goal.reason.includes('prerequisites_are_not_ready'));
  assert.ok(goal.reason.includes('start_with_emulsions'));
  assert.ok(acquire.priority > goal.priority, 'the prerequisite always comes first');
});

test('the walk goes to the deepest thing standing in the way', () => {
  // Nothing is known at all, so the frontier is the two concepts with no
  // prerequisites of their own. Neither the goal nor anything in between is
  // worth asking for yet.
  const needs = needsOf({}, { goals: GOAL });
  const acquired = needs.filter((need) => need.kind === 'acquire' && need.urgency === 0.5);
  assert.deepEqual(acquired.map((need) => need.concept), ['nema:heat-control']);
  assert.ok(acquired[0].reason.includes('prerequisite_first'));

  for (const need of needs.filter((entry) => entry.kind === 'acquire' && entry.urgency !== 0.5)) {
    assert.ok(need.reason.includes('prerequisites_are_not_ready'), `${need.concept} is blocked`);
  }
});

test('with every prerequisite usable the acquire need is the goal itself', () => {
  const state = derive([
    ...usable('nema:heat-control'),
    ...usable('nema:ratios'),
    ...usable('nema:deglazing'),
    ...usable('nema:reduction'),
    ...usable('nema:emulsions')
  ]);
  const need = needsOf(state, { goals: GOAL })
    .find((entry) => entry.kind === 'acquire' && entry.concept === 'nema:pan-sauces');

  assert.ok(need, 'the learner is at the edge of mastery');
  assert.equal(need.urgency, 0.5);
  assert.deepEqual(need.reason, [
    'goal_depends_on_this_concept',
    'no_evidence_yet',
    'active_goal_depends_on_this_concept'
  ]);
});

/* -------------------------------------------- interleaving and interference */

test('two confusable concepts do not share a session unless one is the discriminate need', () => {
  // Note 18: do not introduce many confusable things at once. Emulsions and
  // reduction are the pair, and both are overdue.
  const state = derive([
    overdue('nema:emulsions'),
    overdue('nema:reduction'),
    overdue('nema:deglazing')
  ]);
  const all = needsOf(state).filter((need) => need.kind === 'retrieve');
  assert.equal(all.length, 3, 'three reviews are due');

  const session = needsOf(state, { budgetMinutes: 12 });
  const concepts = session.map((need) => need.concept);
  assert.ok(concepts.includes('nema:deglazing'), 'the concept with no neighbour always fits');
  assert.equal(
    concepts.includes('nema:emulsions') && concepts.includes('nema:reduction'),
    false,
    'the confusable pair is split across sessions'
  );
  const kept = session.find((need) => need.concept === 'nema:emulsions' || need.concept === 'nema:reduction');
  assert.ok(kept.reason.includes('interference_avoided'), 'and the session says why');

  // Unless the point of the need is telling them apart, which is exactly when
  // they belong together.
  const strong = derive([...usable('nema:emulsions'), ...usable('nema:reduction')]);
  const pair = needsOf(strong, { budgetMinutes: 8 });
  assert.deepEqual(label(pair).sort(), ['discriminate:nema:emulsions', 'discriminate:nema:reduction']);
});

test('a session never puts two needs on one concept next to each other', () => {
  // Note 17: interleave, so the learner has to choose the method rather than
  // execute the one they were just handed. Four needs over three concepts, two
  // of them on emulsions.
  const state = derive([overdue('nema:emulsions'), overdue('nema:deglazing'), overdue('nema:ratios')]);
  const session = computeNeeds(state, {
    concepts: CONCEPTS,
    now: NOW,
    misconceptions: [{ concept: 'nema:emulsions', id: 'a_sauce_can_be_boiled_once_it_holds', text: 'It can be boiled.' }],
    budgetMinutes: 20
  });

  assert.equal(session.length, 4, 'the session is worth ordering');
  for (let i = 1; i < session.length; i += 1) {
    assert.notEqual(session[i].concept, session[i - 1].concept, `${i} repeats a concept`);
  }
  const moved = session.filter((need) => need.reason.includes('interleaved'));
  assert.ok(moved.length > 0, 'a need was pulled forward, and it says so');

  // The unbudgeted list is a ranking, not a session, so it stays sorted.
  const ranked = computeNeeds(state, { concepts: CONCEPTS, now: NOW });
  for (let i = 1; i < ranked.length; i += 1) {
    assert.ok(ranked[i].priority <= ranked[i - 1].priority);
    assert.equal(ranked[i].reason.includes('interleaved'), false, 'nothing is interleaved outside a session');
  }
});

test('a live confusion is more urgent than a hypothetical one', () => {
  const both = derive([...usable('nema:emulsions'), ...usable('nema:reduction')]);
  const live = needsOf(both).find((need) => need.kind === 'discriminate' && need.concept === 'nema:emulsions');
  assert.equal(live.urgency, 0.8);
  assert.ok(live.reason.includes('confusable_neighbour_is_strong'));

  const alone = derive(usable('nema:emulsions'));
  const quiet = needsOf(alone).find((need) => need.kind === 'discriminate');
  assert.equal(quiet.urgency, 0.65, 'a neighbour nobody has met yet is not a confusion');
  assert.equal(quiet.reason.includes('confusable_neighbour_is_strong'), false);
});

/* --------------------------------------- the illusion of understanding -- */

test('reading about something asks for a retrieval, and never reaches usable', () => {
  // Note 19: rereading measures recognition. Note 5: retrieval is the thing
  // that strengthens memory.
  const state = derive([
    receipt({ id: 'r_read_1', claims: [['nema:emulsions', 'recognize']], grader: 'exposure', daysAgo: 6 }),
    receipt({ id: 'r_read_2', claims: [['nema:emulsions', 'recognize']], grader: 'exposure', daysAgo: 4 }),
    receipt({ id: 'r_read_3', claims: [['nema:emulsions', 'recognize']], grader: 'exposure', daysAgo: 2 })
  ]);
  assert.ok(state['nema:emulsions'].recognize.score >= 0.2, 'three reads add up');
  assert.equal(state['nema:emulsions'].recognize.band, 'uncertain', 'and never pass uncertain');
  assert.equal(toAssertionStatus(bestBand(state['nema:emulsions'])), 'uncertain');

  const need = needsOf(state).find((entry) => entry.kind === 'retrieve');
  assert.ok(need, 'exposure alone asks to be retrieved');
  assert.equal(need.concept, 'nema:emulsions');
  assert.equal(need.ability, 'retrieve', 'the ability asked for is the one that was never shown');
  assert.ok(need.reason.includes('exposure_only'));
  assert.equal(need.note, 'You have read about this. You have not retrieved it yet.');
  assert.equal(need.constraints.maxHints, 0, 'recall is closed book');

  // A self check is the learner's own word, so it counts as exposure here too.
  const ticked = derive([receipt({ id: 'r_self', claims: [['nema:emulsions', 'explain']], grader: 'self-report', daysAgo: 2 })]);
  assert.ok(needsOf(ticked).some((entry) => entry.reason.includes('exposure_only')));

  // One graded pass and the vault stops saying it.
  const graded = derive([
    receipt({ id: 'r_read_1', claims: [['nema:emulsions', 'recognize']], grader: 'exposure', daysAgo: 6 }),
    receipt({ id: 'r_lab', claims: [['nema:emulsions', 'apply']], daysAgo: 2 })
  ]);
  assert.equal(needsOf(graded).some((entry) => entry.reason.includes('exposure_only')), false);
});

/* ------------------------------------------------ minimum effective dose -- */

test('a retrieval is short, so a budget holds several of them', () => {
  // Note 27: the minimum effective dose of practice, interleaved. The registry
  // asks for five minutes of recall on every concept in this fixture, and the
  // need is capped at four.
  const state = derive([overdue('nema:ratios'), overdue('nema:heat-control'), overdue('nema:deglazing')]);
  for (const concept of CONCEPTS) assert.equal(concept.minutes.retrieve, 5, `${concept.id} asks for five`);

  const needs = needsOf(state);
  for (const need of needs.filter((entry) => entry.kind === 'retrieve')) {
    assert.equal(need.minutes, 4, `${need.concept} recall is capped at four minutes`);
  }
  for (const need of needs.filter((entry) => entry.kind !== 'retrieve')) {
    assert.equal(need.minutes, (CONCEPTS.find((c) => c.id === need.concept).minutes[need.ability]) || 4);
  }

  // Twelve minutes buys three retrievals rather than one long application.
  const session = needsOf(state, { budgetMinutes: 12 });
  assert.equal(session.length, 3);
  assert.deepEqual(session.map((need) => need.kind), ['retrieve', 'retrieve', 'retrieve']);
  assert.equal(session.reduce((total, need) => total + need.minutes, 0), 12);
});

test('the fill keeps scanning, so a short need rides along behind a long one', () => {
  // Ratios can be explained but has never been applied, which asks for six
  // minutes of work. Deglazing is durable and has never been transferred, which
  // asks for four. The longer need ranks higher and does not fit in five.
  const state = derive([
    ...usable('nema:ratios', 'explain'),
    ...usable('nema:deglazing'),
    receipt({ id: 'deglazing_3', claims: [['nema:deglazing', 'apply']], daysAgo: 5 })
  ]);
  const needs = needsOf(state);
  const long = needs.find((need) => need.kind === 'apply' && need.concept === 'nema:ratios');
  const short = needs.find((need) => need.kind === 'transfer' && need.concept === 'nema:deglazing');
  assert.equal(long.minutes, 6, 'applying a ratio takes six minutes');
  assert.equal(short.minutes, 4);
  assert.ok(long.priority > short.priority, 'and it is the more urgent of the two');

  assert.deepEqual(label(needsOf(state, { budgetMinutes: 5 })), ['transfer:nema:deglazing']);
  assert.deepEqual(label(needsOf(state, { budgetMinutes: 6 })), ['apply:nema:ratios']);
  assert.deepEqual(label(needsOf(state, { budgetMinutes: 10 })), [
    'apply:nema:ratios',
    'transfer:nema:deglazing'
  ]);

  for (const budgetMinutes of [1, 2, 3, 4, 5, 7, 10, 30, 120]) {
    const filled = needsOf(state, { budgetMinutes });
    const total = filled.reduce((sum, need) => sum + need.minutes, 0);
    assert.ok(total <= budgetMinutes, `${total} fits in ${budgetMinutes}`);
  }
});

/* ------------------------------------------------------ audits, not grades */

test('a failed claim asks for a repair, not just a lower band', () => {
  // Note 28: an error is a node needing an intervention, not minus one point.
  const failed = derive([
    receipt({ id: 'r_pass', claims: [['nema:emulsions', 'apply']], daysAgo: 20 }),
    receipt({ id: 'r_fail', claims: [['nema:emulsions', 'apply', 'failed']], daysAgo: 2 })
  ]);
  assert.ok(failed['nema:emulsions'].apply.lastFailure, 'the ledger remembers the failure');
  assert.equal(failed['nema:emulsions'].apply.stabilityDays, 3, 'and the schedule restarts');

  const reassess = needsOf(failed).find((need) => need.kind === 'reassess');
  assert.ok(reassess, 'with no misconception on record the vault asks to reassess');
  assert.equal(reassess.concept, 'nema:emulsions');
  assert.equal(reassess.ability, 'apply');
  assert.ok(reassess.reason.includes('failed_claim_on_record'));
  assert.ok(reassess.reason.includes('nothing_has_confirmed_it_since'));

  // With a misconception on record the repair takes over, and says the same
  // thing about the failure.
  const withMisconception = needsOf(failed, {
    misconceptions: [{ concept: 'nema:emulsions', id: 'a_sauce_can_be_boiled_once_it_holds', text: 'It can be boiled.' }]
  });
  const repair = withMisconception.find((need) => need.kind === 'repair_misconception');
  assert.ok(repair);
  assert.ok(repair.reason.includes('failed_claim_on_record'));
  assert.equal(withMisconception.some((need) => need.kind === 'reassess'), false, 'one need, not two');

  // A pass after the failure closes it.
  const answered = derive([
    receipt({ id: 'r_pass', claims: [['nema:emulsions', 'apply']], daysAgo: 20 }),
    receipt({ id: 'r_fail', claims: [['nema:emulsions', 'apply', 'failed']], daysAgo: 10 }),
    receipt({ id: 'r_retest', claims: [['nema:emulsions', 'apply']], daysAgo: 2 })
  ]);
  assert.equal(
    needsOf(answered).some((need) => need.reason.includes('failed_claim_on_record')),
    false,
    'the retest answered it'
  );
});

/* ------------------------------------------- the registry that ships -- */

test('every encompasses fraction in the registry names a prerequisite it has', () => {
  const byId = new Map(REGISTRY.map((concept) => [concept.id, concept]));
  let declared = 0;

  for (const concept of REGISTRY) {
    if (!concept.encompasses) continue;
    assert.equal(typeof concept.encompasses, 'object');
    for (const [prereq, fraction] of Object.entries(concept.encompasses)) {
      declared += 1;
      assert.ok(byId.has(prereq), `${concept.id} encompasses an unknown concept ${prereq}`);
      assert.ok(concept.prereqs.includes(prereq), `${concept.id} does not list ${prereq} as a prerequisite`);
      assert.equal(typeof fraction, 'number');
      assert.ok(fraction > 0 && fraction <= 1, `${concept.id} to ${prereq} is ${fraction}`);
      assert.ok(fraction > IMPLICIT_FRACTION, `${concept.id} to ${prereq} restates the default`);
    }
  }
  assert.ok(declared >= 10, `the registry declares enough of them, found ${declared}`);
});

test('the demo ledger keeps its promise with the encompassing graph switched on', () => {
  // Contract sections 27, 28 and 30 all pin the same numbers, because the demo
  // is a story and the story does not change: 27 concepts with evidence, 18 of
  // them verified, 7 fragile, 4 reviews due on the day this build is judged.
  const baseMs = Date.parse(SEED.baseDate);
  const receipts = SEED.receipts.map((entry, index) => ({
    receiptId: `rcpt_seed_${String(index + 1).padStart(3, '0')}`,
    status: 'verified',
    payload: {
      type: 'evidence-receipt',
      protocol: 'nema/0.1',
      claims: entry.claims,
      conditions: entry.conditions,
      issuedAt: new Date(baseMs - Number(entry.daysAgo) * DAY_MS).toISOString().replace(/\.\d{3}Z$/, 'Z')
    }
  }));

  const ledger = deriveState(receipts, { now: NOW });
  const counts = summarize(ledger, { now: NOW });
  assert.equal(counts.concepts, 27);
  assert.equal(counts.fragile, 7);
  assert.equal(counts.reviewsDue, 4);
  const verified = Object.values(ledger).filter(
    (concept) => toAssertionStatus(bestBand(concept)) === 'verified'
  ).length;
  assert.equal(verified, 18);

  // Implicit repetition moves five concepts from usable to durable, and moves
  // nothing across the line a provider reads. The bands the vault shows come
  // from the ledger, so the summary strip is untouched either way.
  const after = applyImplicitRepetition(ledger, { concepts: REGISTRY, now: NOW });
  const moved = Object.keys(after).filter(
    (id) => bestBand(after[id]) !== bestBand(ledger[id])
  ).sort();
  assert.deepEqual(moved, [
    'nema:knife-skills',
    'nema:ratios',
    'nema:reduction',
    'nema:roux',
    'nema:seasoning'
  ]);
  for (const id of moved) {
    assert.equal(bestBand(ledger[id]), 'usable');
    assert.equal(bestBand(after[id]), 'durable');
  }

  const later = summarize(after, { now: NOW });
  assert.equal(later.concepts, 27, 'no concept is invented');
  assert.equal(later.durable + later.usable, 18, 'and none crosses into verified');
  assert.equal(later.fragile, 7);
  assert.equal(later.uncertain, 2);
  assert.equal(later.reviewsDue, 4, 'the strip and the panel agree on what is due');
});

test('the five minute review on the demo ledger is still the maillard discrimination', () => {
  const baseMs = Date.parse(SEED.baseDate);
  const receipts = SEED.receipts.map((entry, index) => ({
    receiptId: `rcpt_seed_${String(index + 1).padStart(3, '0')}`,
    status: 'verified',
    payload: {
      type: 'evidence-receipt',
      protocol: 'nema/0.1',
      claims: entry.claims,
      conditions: entry.conditions,
      issuedAt: new Date(baseMs - Number(entry.daysAgo) * DAY_MS).toISOString().replace(/\.\d{3}Z$/, 'Z')
    }
  }));
  const state = deriveState(receipts, { now: NOW });
  const options = {
    concepts: REGISTRY,
    goals: SEED.goals,
    misconceptions: SEED.misconceptions,
    now: NOW
  };

  const session = computeNeeds(state, { ...options, budgetMinutes: 5 });
  assert.deepEqual(label(session), ['discriminate:nema:maillard-reaction']);
  assert.equal(session[0].confusableWith, 'nema:caramelization');
  assert.ok(session[0].reason.includes('confusable_neighbour_is_strong'));

  const all = computeNeeds(state, options);
  assert.equal(all[0].needId, session[0].needId, 'and it is the top of the full list too');

  // The goal is a pan sauce, and emulsions is the only prerequisite missing, so
  // that is what the vault asks for rather than the pan sauce itself.
  const emulsions = all.find((need) => need.kind === 'acquire' && need.concept === 'nema:emulsions');
  assert.ok(emulsions.reason.includes('prerequisite_first'));
  assert.ok(emulsions.reason.includes('before_pan_sauces'));
  const panSauces = all.find((need) => need.kind === 'acquire' && need.concept === 'nema:pan-sauces');
  assert.ok(panSauces.reason.includes('start_with_emulsions'));
  assert.ok(emulsions.priority > panSauces.priority);

  // Two concepts in the seed have been read about and never retrieved.
  const readOnly = all
    .filter((need) => need.reason.includes('exposure_only'))
    .map((need) => need.concept)
    .sort();
  assert.deepEqual(readOnly, ['nema:menu-planning', 'nema:mother-sauces']);

  // Applying a ratio is no longer asked for: the learner has done it inside
  // roux, thickeners and pastry, which is what the encompassing graph is for.
  assert.equal(state['nema:ratios'].apply.band, 'uncertain', 'the ledger has one partial self check');
  assert.equal(
    all.some((need) => need.kind === 'apply' && need.concept === 'nema:ratios'),
    false,
    'and the planner counts the work done above it'
  );
});
