import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import {
  MANIFEST,
  ACTIVITIES,
  ACTIVITY_ORDER,
  CONTENT_HASH_INPUT,
  grade,
  checkPrerequisites
} from '../apps/security/public/content.js';
import {
  grade as gradeSaucier,
  personalizePath
} from '../apps/harness/public/content.js';
import { deriveState, toAssertionStatus } from '../shared/inference.js';

const LAB = 'service-log-audit';
const TRIAGE = 'incident-triage';
const HEAT_LESSON = 'heat-control-on-the-line';
const SAUCE_LESSON = 'pan-sauces-during-service';

const KEY = ACTIVITIES[LAB].answerKey;
const INCIDENTS = ACTIVITIES[TRIAGE].incidents;

function correctTriageAnswers() {
  const answers = {};
  for (const incident of INCIDENTS) answers[incident.id] = incident.answerKey;
  return answers;
}

function wrongOptionFor(incident) {
  return incident.options.find((option) => option.id !== incident.answerKey).id;
}

function statusFromNema(claim) {
  const at = '2026-09-03T12:00:00.000Z';
  const state = deriveState([{
    status: 'verified',
    receiptId: 'cross-course-lesson',
    payload: { issuedAt: at, conditions: { grader: 'exposure' }, claims: [claim] }
  }], { now: at });
  return toAssertionStatus(state[claim.concept][claim.ability].band);
}

/* --------------------------------------------------------------------- */
/* Manifest and content shape                                            */
/* --------------------------------------------------------------------- */

test('manifest describes the Line Cook Lab unit', () => {
  assert.equal(MANIFEST.protocol, 'nema/0.1');
  assert.equal(MANIFEST.provider.origin, 'https://linecook.migarci2.dev');
  assert.equal(MANIFEST.provider.keyId, 'linecook-2026-09');
  assert.equal(MANIFEST.provider.name, 'Line Cook Lab');
  assert.equal(MANIFEST.unit.id, 'service-under-pressure');
  assert.equal(MANIFEST.unit.title, 'Service Under Pressure');
  assert.deepEqual(MANIFEST.requirements, [
    { concept: 'nema:mise-en-place', ability: 'explain' },
    { concept: 'nema:emulsions', ability: 'explain' },
    { concept: 'nema:food-safety', ability: 'apply' }
  ]);
  assert.deepEqual(ACTIVITY_ORDER, [
    'mise-en-place-intro',
    'food-safety-intro',
    HEAT_LESSON,
    SAUCE_LESSON,
    LAB,
    TRIAGE
  ]);
  assert.equal(MANIFEST.activities.length, 6);
  assert.equal(MANIFEST.unit.estimatedMinutes, 54);
  assert.equal(
    MANIFEST.unit.estimatedMinutes,
    ACTIVITY_ORDER.reduce((total, id) => total + ACTIVITIES[id].minutes, 0)
  );
});

test('the lessons carry skipIf and the labs carry unlock', () => {
  assert.deepEqual(ACTIVITIES['mise-en-place-intro'].skipIf, [
    { concept: 'nema:mise-en-place', ability: 'explain', status: 'verified' }
  ]);
  assert.deepEqual(ACTIVITIES['food-safety-intro'].skipIf, [
    { concept: 'nema:food-safety', ability: 'apply', status: 'verified' }
  ]);
  assert.deepEqual(ACTIVITIES[HEAT_LESSON].skipIf, [
    { concept: 'nema:heat-control', ability: 'recognize', status: 'uncertain' }
  ]);
  assert.deepEqual(ACTIVITIES[SAUCE_LESSON].skipIf, [
    { concept: 'nema:pan-sauces', ability: 'recognize', status: 'uncertain' }
  ]);
  assert.deepEqual(ACTIVITIES[LAB].unlock, [
    { concept: 'nema:emulsions', ability: 'explain', minStatus: 'uncertain' }
  ]);
  assert.deepEqual(ACTIVITIES[TRIAGE].unlock, [
    { concept: 'nema:emulsions', ability: 'explain', minStatus: 'uncertain' },
    { concept: 'nema:food-safety', ability: 'apply', minStatus: 'verified' },
    { concept: 'nema:mise-en-place', ability: 'explain', minStatus: 'verified' }
  ]);
  assert.deepEqual(ACTIVITIES[LAB].skipIf, []);
  assert.deepEqual(ACTIVITIES[TRIAGE].skipIf, []);
});

test('the labs carry the outcomes the unit promises', () => {
  assert.deepEqual(
    ACTIVITIES[LAB].outcomes.map((o) => [o.concept, o.ability, o.evidenceType]),
    [
      ['nema:food-safety', 'apply', 'application'],
      ['nema:cross-contamination', 'discriminate', 'discrimination']
    ]
  );
  assert.deepEqual(
    ACTIVITIES[TRIAGE].outcomes.map((o) => [o.concept, o.ability, o.evidenceType]),
    [
      ['nema:service-timing', 'apply', 'application'],
      ['nema:temperature-control', 'apply', 'application']
    ]
  );
  assert.deepEqual(MANIFEST.outcomes, [
    { concept: 'nema:food-safety', ability: 'apply' },
    { concept: 'nema:cross-contamination', ability: 'discriminate' },
    { concept: 'nema:service-timing', ability: 'apply' },
    { concept: 'nema:temperature-control', ability: 'apply' }
  ]);
});

test('the lab content matches the documented shape', () => {
  const lab = ACTIVITIES[LAB];
  assert.equal(lab.trace.length, 10);
  assert.equal(lab.trace.filter((entry) => entry.actor === 'cook').length, 6);
  assert.equal(lab.trace.filter((entry) => entry.untrusted).length, 3);
  assert.deepEqual(
    lab.trace.filter((entry) => entry.untrusted).map((entry) => entry.id),
    KEY.untrustedIds
  );
  for (const entry of lab.trace) {
    assert.ok(['ticket', 'cook', 'pass'].includes(entry.actor), entry.id + ' has a kitchen actor');
    assert.ok(entry.id && entry.label && entry.content);
    assert.equal(typeof entry.untrusted, 'boolean');
    // Only work done at a station can be unsafe. Tickets and pass calls cannot.
    assert.ok(!entry.untrusted || entry.actor === 'cook');
  }
  assert.equal(lab.mitigations.length, 7);
  assert.equal(lab.mitigations.filter((m) => m.kind === 'effective').length, 3);
  assert.equal(lab.mitigations.filter((m) => m.kind === 'harmful').length, 2);
  assert.equal(lab.mitigations.filter((m) => m.kind === 'neutral').length, 2);
  assert.deepEqual(
    lab.mitigations.filter((m) => m.kind === 'effective').map((m) => m.id),
    KEY.effectiveMitigations
  );
  assert.deepEqual(
    lab.mitigations.filter((m) => m.kind === 'harmful').map((m) => m.id),
    KEY.harmfulMitigations
  );
  assert.deepEqual(
    lab.mitigations.filter((m) => m.kind === 'neutral').map((m) => m.id),
    KEY.neutralMitigations
  );

  assert.equal(INCIDENTS.length, 4);
  const chosen = new Set();
  for (const incident of INCIDENTS) {
    assert.equal(incident.options.length, 4);
    assert.ok(incident.options.some((option) => option.id === incident.answerKey));
    assert.equal(ACTIVITIES[TRIAGE].answerKey[incident.id], incident.answerKey);
    assert.ok(incident.evidence.length >= 3);
    assert.ok(incident.rationale.length > 80, incident.id + ' needs a rationale');
    for (const option of incident.options) {
      assert.ok(option.id.startsWith(incident.id + '-'));
      assert.ok(option.label.includes(':'), option.id + ' needs an action prefix');
    }
    chosen.add(incident.answerKey.replace(incident.id + '-', ''));
  }
  // Each of the four kitchen actions is the right call exactly once.
  assert.deepEqual([...chosen].sort(), ['discard', 'reprobe', 'rescue', 'stop']);
});

test('CONTENT_HASH_INPUT is the serialized activity set', () => {
  assert.equal(typeof CONTENT_HASH_INPUT, 'string');
  assert.deepEqual(Object.keys(JSON.parse(CONTENT_HASH_INPUT)), ACTIVITY_ORDER);
});

/* --------------------------------------------------------------------- */
/* grade: service-log-audit                                              */
/* --------------------------------------------------------------------- */

test('service log audit passes with the exact unsafe set and all three effective fixes', () => {
  const out = grade(LAB, {
    untrusted: [...KEY.untrustedIds],
    mitigations: [...KEY.effectiveMitigations]
  });
  assert.equal(out.result, 'passed');
  assert.equal(out.score, 1);
  assert.ok(out.feedback.length > 0);
  assert.deepEqual(
    out.claims.map((claim) => [claim.concept, claim.ability, claim.evidenceType, claim.result]),
    [
      ['nema:food-safety', 'apply', 'application', 'passed'],
      ['nema:cross-contamination', 'discriminate', 'discrimination', 'passed']
    ]
  );
});

test('neutral fixes do not spoil a pass', () => {
  const out = grade(LAB, {
    untrusted: [...KEY.untrustedIds].reverse(),
    mitigations: [...KEY.effectiveMitigations, ...KEY.neutralMitigations]
  });
  assert.equal(out.result, 'passed');
  assert.ok(
    out.feedback.some((line) => line.startsWith('Neutral choices do not count against you')),
    'neutral picks are named but not penalised'
  );
});

test('service log audit is partial with two effective fixes', () => {
  const out = grade(LAB, {
    untrusted: [...KEY.untrustedIds],
    mitigations: KEY.effectiveMitigations.slice(0, 2)
  });
  assert.equal(out.result, 'partial');
  assert.ok(out.score > 0 && out.score < 1);
  assert.equal(out.claims.length, 2);
  assert.ok(out.claims.every((claim) => claim.result === 'partial'));
});

test('service log audit fails when a harmful fix is selected', () => {
  const out = grade(LAB, {
    untrusted: [...KEY.untrustedIds],
    mitigations: [...KEY.effectiveMitigations, KEY.harmfulMitigations[0]]
  });
  assert.equal(out.result, 'failed');
  assert.deepEqual(out.claims, []);
  assert.ok(out.feedback.some((line) => line.includes('Harmful fix selected')));
});

test('service log audit fails when an unsafe step is missed', () => {
  const out = grade(LAB, {
    untrusted: KEY.untrustedIds.slice(0, 2),
    mitigations: [...KEY.effectiveMitigations]
  });
  assert.equal(out.result, 'failed');
  assert.deepEqual(out.claims, []);
  assert.ok(out.feedback.some((line) => line.includes('Missed unsafe work')));
});

test('service log audit fails when correct work is marked unsafe', () => {
  const out = grade(LAB, {
    untrusted: [...KEY.untrustedIds, 's7'],
    mitigations: [...KEY.effectiveMitigations]
  });
  assert.equal(out.result, 'failed');
  assert.ok(out.feedback.some((line) => line.includes('Marked as unsafe with no rule broken')));
});

test('service log audit handles an empty submission', () => {
  const out = grade(LAB, {});
  assert.equal(out.result, 'failed');
  assert.equal(out.score, 0);
  assert.deepEqual(out.claims, []);
});

/* --------------------------------------------------------------------- */
/* grade: incident-triage                                                */
/* --------------------------------------------------------------------- */

test('incident triage passes on four correct calls', () => {
  const out = grade(TRIAGE, { answers: correctTriageAnswers() });
  assert.equal(out.result, 'passed');
  assert.equal(out.score, 1);
  assert.deepEqual(
    out.claims.map((claim) => [claim.concept, claim.ability, claim.evidenceType, claim.result]),
    [
      ['nema:service-timing', 'apply', 'application', 'passed'],
      ['nema:temperature-control', 'apply', 'application', 'passed']
    ]
  );
});

test('incident triage is partial on three correct calls', () => {
  const answers = correctTriageAnswers();
  answers[INCIDENTS[1].id] = wrongOptionFor(INCIDENTS[1]);
  const out = grade(TRIAGE, { answers });
  assert.equal(out.result, 'partial');
  assert.equal(out.score, 0.75);
  assert.equal(out.claims.length, 2);
  assert.ok(out.claims.every((claim) => claim.result === 'partial'));
  assert.ok(out.feedback[0].startsWith('3 of 4'));
});

test('incident triage fails on two correct calls', () => {
  const answers = correctTriageAnswers();
  answers[INCIDENTS[0].id] = wrongOptionFor(INCIDENTS[0]);
  answers[INCIDENTS[3].id] = wrongOptionFor(INCIDENTS[3]);
  const out = grade(TRIAGE, { answers });
  assert.equal(out.result, 'failed');
  assert.equal(out.score, 0.5);
  assert.deepEqual(out.claims, []);
});

test('incident triage fails with no answers at all', () => {
  const out = grade(TRIAGE, {});
  assert.equal(out.result, 'failed');
  assert.equal(out.score, 0);
  assert.ok(out.feedback.some((line) => line.includes('No option was recorded')));
});

/* --------------------------------------------------------------------- */
/* grade: lessons and unknown activities                                  */
/* --------------------------------------------------------------------- */

test('a completed lesson produces one exposure claim', () => {
  const out = grade('mise-en-place-intro', { completed: true });
  assert.equal(out.result, 'passed');
  assert.deepEqual(out.claims, [
    {
      concept: 'nema:mise-en-place',
      ability: 'recognize',
      evidenceType: 'recognition',
      result: 'passed',
      difficulty: 'introductory'
    }
  ]);
  assert.deepEqual(
    ACTIVITIES['mise-en-place-intro'].lesson.exposureClaim,
    { concept: 'nema:mise-en-place', ability: 'recognize', evidenceType: 'recognition' }
  );
  assert.deepEqual(
    ACTIVITIES['food-safety-intro'].lesson.exposureClaim,
    { concept: 'nema:food-safety', ability: 'recognize', evidenceType: 'recognition' }
  );
  assert.deepEqual(
    grade(HEAT_LESSON, { completed: true }).claims[0],
    {
      concept: 'nema:heat-control',
      ability: 'recognize',
      evidenceType: 'recognition',
      result: 'passed',
      difficulty: 'introductory'
    }
  );
});

test('an unopened lesson claims nothing', () => {
  const out = grade('food-safety-intro', {});
  assert.equal(out.result, 'failed');
  assert.deepEqual(out.claims, []);
});

test('an unknown activity fails instead of throwing', () => {
  const out = grade('does-not-exist', { untrusted: [] });
  assert.equal(out.result, 'failed');
  assert.deepEqual(out.claims, []);
});

/* --------------------------------------------------------------------- */
/* checkPrerequisites                                                     */
/* --------------------------------------------------------------------- */

test('knowledge from Saucier marks the shared lessons done and unlocks both labs', () => {
  const out = checkPrerequisites({
    'nema:mise-en-place|explain': 'verified',
    'nema:food-safety|apply': 'verified',
    'nema:emulsions|explain': 'uncertain',
    'nema:heat-control|recognize': 'verified',
    'nema:pan-sauces|recognize': 'uncertain'
  });

  assert.deepEqual(out.recognized, [
    { concept: 'nema:mise-en-place', ability: 'explain', status: 'verified' },
    { concept: 'nema:emulsions', ability: 'explain', status: 'uncertain' },
    { concept: 'nema:food-safety', ability: 'apply', status: 'verified' }
  ]);
  assert.deepEqual(out.skippable, ['mise-en-place-intro', 'food-safety-intro', HEAT_LESSON, SAUCE_LESSON]);
  assert.deepEqual(out.unlocked, [
    'mise-en-place-intro',
    'food-safety-intro',
    HEAT_LESSON,
    SAUCE_LESSON,
    LAB,
    TRIAGE
  ]);
  assert.deepEqual(out.locked, []);
  assert.equal(out.recommendedFirst, LAB);
});

test('the same story works with bare concept ids', () => {
  const out = checkPrerequisites({
    'mise-en-place|explain': 'verified',
    'food-safety|apply': 'verified',
    'emulsions|explain': 'uncertain',
    'heat-control|recognize': 'verified',
    'pan-sauces|recognize': 'uncertain'
  });
  assert.equal(out.recommendedFirst, LAB);
  assert.deepEqual(out.locked, []);
  assert.equal(out.recognized[1].status, 'uncertain');
});

test('without emulsions both labs are locked with the missing entry', () => {
  const out = checkPrerequisites({
    'nema:mise-en-place|explain': 'verified',
    'nema:food-safety|apply': 'verified',
    'nema:emulsions|explain': 'missing',
    'nema:heat-control|recognize': 'uncertain',
    'nema:pan-sauces|recognize': 'uncertain'
  });

  assert.deepEqual(out.locked, [
    {
      activityId: LAB,
      missing: [{ concept: 'nema:emulsions', ability: 'explain', needed: 'uncertain' }]
    },
    {
      activityId: TRIAGE,
      missing: [{ concept: 'nema:emulsions', ability: 'explain', needed: 'uncertain' }]
    }
  ]);
  assert.deepEqual(out.unlocked, ['mise-en-place-intro', 'food-safety-intro', HEAT_LESSON, SAUCE_LESSON]);
  assert.deepEqual(out.skippable, ['mise-en-place-intro', 'food-safety-intro', HEAT_LESSON, SAUCE_LESSON]);
  assert.equal(out.recommendedFirst, null);
});

test('an empty assertion locks the labs and recommends the first intro', () => {
  const out = checkPrerequisites({});
  assert.deepEqual(out.recognized.map((entry) => entry.status), ['missing', 'missing', 'missing']);
  assert.deepEqual(out.skippable, []);
  assert.equal(out.recommendedFirst, 'mise-en-place-intro');
  assert.equal(out.locked.length, 2);
  assert.equal(out.locked[1].missing.length, 3);
});

test('uncertain never satisfies a requirement that needs verified', () => {
  const out = checkPrerequisites({
    'nema:mise-en-place|explain': 'uncertain',
    'nema:food-safety|apply': 'uncertain',
    'nema:emulsions|explain': 'verified'
  });
  assert.deepEqual(out.skippable, []);
  assert.deepEqual(out.unlocked, ['mise-en-place-intro', 'food-safety-intro', HEAT_LESSON, SAUCE_LESSON, LAB]);
  assert.deepEqual(out.locked, [
    {
      activityId: TRIAGE,
      missing: [
        { concept: 'nema:food-safety', ability: 'apply', needed: 'verified' },
        { concept: 'nema:mise-en-place', ability: 'explain', needed: 'verified' }
      ]
    }
  ]);
  assert.equal(out.recommendedFirst, 'mise-en-place-intro');
});

test('lesson exposure crosses between both cooking providers through nema', () => {
  const fromLineCook = grade(HEAT_LESSON, { completed: true }).claims[0];
  assert.ok(
    personalizePath({ [`${fromLineCook.concept}|${fromLineCook.ability}`]: statusFromNema(fromLineCook) })
      .skipped.some((entry) => entry.activityId === 'heat-control-primer')
  );

  const fromSaucier = gradeSaucier('pan-sauce-anatomy', { completed: true }).claims[0];
  assert.ok(
    checkPrerequisites({ [`${fromSaucier.concept}|${fromSaucier.ability}`]: statusFromNema(fromSaucier) })
      .skippable.includes(SAUCE_LESSON)
  );
});

test('garbage input is treated as missing, not as an error', () => {
  for (const input of [undefined, null, 'nonsense', 42, { 'nema:mise-en-place|explain': 'maybe' }]) {
    const out = checkPrerequisites(input);
    assert.equal(out.locked.length, 2);
    assert.deepEqual(out.recognized.map((entry) => entry.status), ['missing', 'missing', 'missing']);
  }
});

/* --------------------------------------------------------------------- */
/* House style                                                            */
/* --------------------------------------------------------------------- */

test('no emojis and no em dashes in the provider content', async () => {
  const path = fileURLToPath(new URL('../apps/security/public/content.js', import.meta.url));
  const source = await readFile(path, 'utf8');
  assert.equal(/[\u2013\u2014]/.test(source), false, 'found an em dash or en dash');
  assert.equal(
    /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}]/u.test(source),
    false,
    'found an emoji'
  );
});

/* --------------------------------------------------------------------- */
/* Rendering contract: only `html` fields are markup                      */
/* --------------------------------------------------------------------- */

/** What a browser would actually display if trace content were assigned with
 *  innerHTML: comments and tags are swallowed and whitespace collapses. */
function asInnerHtmlWouldShow(text) {
  return text
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<[^>]*>/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

test('service log content must be rendered as text, not as markup', () => {
  const trace = ACTIVITIES[LAB].trace;

  // Every entry is a stack of timed lines. innerHTML would collapse them into
  // one paragraph and the learner could no longer read a temperature against
  // a clock, which is the whole exercise.
  const multiline = trace.filter((entry) => entry.content.includes('\n'));
  assert.equal(multiline.length, trace.length);
  for (const entry of multiline) {
    assert.notEqual(asInnerHtmlWouldShow(entry.content), entry.content);
  }

  // No plain text field smuggles markup or HTML entities of its own.
  const plain = [];
  for (const entry of trace) plain.push(entry.label, entry.source, entry.why, entry.content);
  for (const fix of ACTIVITIES[LAB].mitigations) plain.push(fix.label, fix.detail);
  for (const incident of INCIDENTS) {
    plain.push(incident.summary, incident.rationale, ...incident.evidence);
    for (const option of incident.options) plain.push(option.label);
  }
  plain.push(...ACTIVITIES[LAB].hints, ...ACTIVITIES[TRIAGE].hints);
  for (const id of ACTIVITY_ORDER) {
    const activity = ACTIVITIES[id];
    plain.push(activity.whatTheLearnerDoes, activity.includeReason, activity.skipReason);
    plain.push(activity.unlockReason, activity.lockedReason);
    if (activity.lesson) plain.push(activity.lesson.intro, ...activity.lesson.keyPoints);
  }
  for (const value of plain) {
    assert.equal(typeof value, 'string');
    assert.equal(/&[a-z]+;|&#\d+;/i.test(value), false, 'HTML entity in a plain text field: ' + value);
    assert.equal(/<[a-z/]/i.test(value), false, 'markup in a plain text field: ' + value);
  }

  // The fields that are markup are the only ones named html.
  for (const activity of [ACTIVITIES[LAB], ACTIVITIES[TRIAGE]]) {
    assert.ok(activity.scenario.html.startsWith('<p>'));
  }
  for (const id of ['mise-en-place-intro', 'food-safety-intro', HEAT_LESSON, SAUCE_LESSON]) {
    for (const section of ACTIVITIES[id].lesson.sections) {
      assert.ok(section.html.startsWith('<p>'));
      assert.equal(/[<>]/.test(section.heading), false);
    }
  }
});

/* --------------------------------------------------------------------- */
/* Path copy the tools and the UI depend on                               */
/* --------------------------------------------------------------------- */

test('every activity carries the copy start_activity and the path panel need', () => {
  for (const id of ACTIVITY_ORDER) {
    const activity = ACTIVITIES[id];
    assert.ok(activity.whatTheLearnerDoes.length > 20, id + ' needs whatTheLearnerDoes');
    assert.ok(activity.includeReason.startsWith('Included:'), id + ' needs includeReason');
    assert.equal(activity.skipReason === '', activity.skipIf.length === 0);
    assert.equal(activity.unlockReason === '', activity.unlock.length === 0);
    assert.equal(activity.lockedReason === '', activity.unlock.length === 0);
  }

  assert.ok(ACTIVITIES['mise-en-place-intro'].skipReason.startsWith('Skipped:'));
  assert.ok(ACTIVITIES['food-safety-intro'].skipReason.startsWith('Skipped:'));
  assert.ok(ACTIVITIES[HEAT_LESSON].skipReason.startsWith('Done via nema:'));
  assert.ok(ACTIVITIES[SAUCE_LESSON].skipReason.startsWith('Done via nema:'));

  for (const id of [LAB, TRIAGE]) {
    assert.ok(
      ACTIVITIES[id].unlockReason.includes('Prerequisite recognised from another provider'),
      id + ' must carry the story beat copy'
    );
    assert.ok(ACTIVITIES[id].lockedReason.startsWith('Locked:'));
  }
});

/* --------------------------------------------------------------------- */
/* The log is evidence, not a label giveaway                              */
/* --------------------------------------------------------------------- */

test('labels name the station and the time only, and every entry carries a source', () => {
  for (const entry of ACTIVITIES[LAB].trace) {
    assert.ok(entry.source && entry.source.length > 8, entry.id + ' needs a source');
    assert.ok(entry.why && entry.why.length > 20, entry.id + ' needs a why');
    assert.match(entry.label, /, \d{2}:\d{2}$/, entry.id + ' label must end in a clock time');
    if (entry.actor === 'cook') {
      assert.match(entry.label, /^[A-Z][a-z]+ station, \d{2}:\d{2}$/, entry.id + ' label leaks more than the station');
    }
  }
  const stationLabels = ACTIVITIES[LAB].trace
    .filter((entry) => entry.actor === 'cook')
    .map((entry) => entry.label.toLowerCase());
  for (const label of stationLabels) {
    for (const giveaway of ['unsafe', 'safe', 'wrong', 'correct', 'allergen', 'contamination', 'danger']) {
      assert.equal(label.includes(giveaway), false, 'label gives the answer away: ' + label);
    }
  }
});

test('the scenario tells the learner to judge by the rule, not by the plate', () => {
  const html = ACTIVITIES[LAB].scenario.html.toLowerCase();
  assert.ok(html.includes('food safety rule'));
  assert.ok(html.includes('the rule decides this, not the plate'));
  // How many steps are unsafe stays out of the brief: the learner derives it.
  assert.equal(/\b(three|four|3|4) (of the )?(steps|station steps)\b/.test(html), false);
});

/* --------------------------------------------------------------------- */
/* Feedback only talks about the steps the learner got wrong               */
/* --------------------------------------------------------------------- */

test('missed unsafe feedback quotes the missed step and nothing else', () => {
  const out = grade(LAB, {
    untrusted: ['s6', 's8'], // s4, the reused red board, is missing
    mitigations: [...KEY.effectiveMitigations]
  });
  assert.equal(out.result, 'failed');
  const missedLine = out.feedback.find((line) => line.startsWith('Missed unsafe work'));
  assert.ok(missedLine);
  assert.ok(missedLine.includes('Larder station, 19:09'));
  assert.ok(missedLine.includes('a dry wipe moves campylobacter'));
  // Nothing about the hollandaise or the dressing spoon, which were marked.
  assert.equal(missedLine.includes('hollandaise'), false);
  assert.equal(missedLine.includes('walnut'), false);
  assert.equal(
    out.feedback.some((line) => line.startsWith('Marked as unsafe with no rule broken')),
    false
  );
});

test('over marked feedback quotes the over marked step and nothing else', () => {
  const out = grade(LAB, {
    untrusted: [...KEY.untrustedIds, 's9'], // the stock cooling, which was correct
    mitigations: [...KEY.effectiveMitigations]
  });
  assert.equal(out.result, 'failed');
  const overLine = out.feedback.find((line) =>
    line.startsWith('Marked as unsafe with no rule broken')
  );
  assert.ok(overLine);
  assert.ok(overLine.includes('Stock station, 19:20'));
  assert.ok(overLine.includes('two stage cooling'));
  // Nothing about the grill or the tickets, which the learner did not mark.
  assert.equal(overLine.includes('Grill station'), false);
  assert.equal(overLine.includes('Table 12'), false);
  assert.equal(out.feedback.some((line) => line.startsWith('Missed unsafe work')), false);
});

test('a correct unsafe set is praised without naming individual steps', () => {
  const out = grade(LAB, {
    untrusted: [...KEY.untrustedIds],
    mitigations: [...KEY.effectiveMitigations]
  });
  const line = out.feedback.find((entry) => entry.startsWith('Unsafe steps: correct'));
  assert.ok(line);
  assert.ok(line.includes('All 3 steps'));
  assert.ok(line.includes('the 3 that were done properly'));
  assert.equal(line.includes('19:09'), false);
});

/* --------------------------------------------------------------------- */
/* The cooking content is specific enough to be worth grading             */
/* --------------------------------------------------------------------- */

test('the food safety lesson names the danger zone, the cook and the cooling rule', () => {
  const lesson = ACTIVITIES['food-safety-intro'].lesson;
  const text = lesson.sections.map((section) => section.html).join(' ');
  assert.ok(text.includes('5 and 63 C'), 'the danger zone is 5 to 63 C');
  assert.ok(text.includes('75 C for 30 seconds'), 'the reference cook for poultry');
  assert.ok(text.includes('60 C down to 21 C within two hours'), 'first leg of two stage cooling');
  assert.ok(text.includes('21 C to 5 C within a further four hours'), 'second leg');
  assert.ok(text.includes('Red for raw meat'), 'the board colour code');
  assert.ok(text.includes('Fourteen allergens'), 'the declarable allergen list');
  assert.equal(lesson.keyPoints.length, 5);
});

test('the three unsafe steps are the three the unit is about', () => {
  const byId = Object.fromEntries(ACTIVITIES[LAB].trace.map((entry) => [entry.id, entry]));
  // Raw chicken board reused for a salad.
  assert.ok(byId.s4.content.includes('Red board'));
  assert.ok(byId.s4.content.includes('garden salad'));
  // Hollandaise held out of temperature control for about two hours.
  assert.ok(byId.s6.content.includes('17:10'));
  assert.ok(byId.s6.content.includes('24 C'));
  // A nut allergy ticket plated with the shared spoon.
  assert.ok(byId.s5.content.includes('TREE NUT ALLERGY'));
  assert.ok(byId.s8.content.includes('Same spoon'));
  for (const id of ['s4', 's6', 's8']) assert.equal(byId[id].untrusted, true);
});

test('the effective fixes are the ones the contract asks for and the harmful ones are the classics', () => {
  const byId = Object.fromEntries(ACTIVITIES[LAB].mitigations.map((fix) => [fix.id, fix]));
  assert.equal(byId['f-colour-coded-boards'].kind, 'effective');
  assert.equal(byId['f-hold-or-remake-sauce'].kind, 'effective');
  assert.equal(byId['f-allergen-station'].kind, 'effective');
  assert.ok(byId['f-hold-or-remake-sauce'].label.includes('63 C'));
  assert.equal(byId['f-rinse-the-chicken'].kind, 'harmful');
  assert.equal(byId['f-boil-the-sauce'].kind, 'harmful');
  assert.ok(byId['f-rinse-the-chicken'].detail.startsWith('Harmful.'));
  assert.ok(byId['f-boil-the-sauce'].detail.startsWith('Harmful.'));
  assert.ok(byId['f-better-probes'].detail.startsWith('Neutral'));
  assert.ok(byId['f-end-of-service-log'].detail.startsWith('Neutral'));
});

test('each incident is the scenario the contract names, with a rationale per option kind', () => {
  const byId = Object.fromEntries(INCIDENTS.map((incident) => [incident.id, incident]));
  assert.match(byId['inc-1'].summary, /beurre blanc/);
  assert.equal(byId['inc-1'].answerKey, 'inc-1-rescue');
  assert.match(byId['inc-2'].summary, /60 C/);
  assert.equal(byId['inc-2'].answerKey, 'inc-2-reprobe');
  assert.match(byId['inc-3'].summary, /shellfish/);
  assert.equal(byId['inc-3'].answerKey, 'inc-3-stop');
  assert.match(byId['inc-4'].summary, /walk in/);
  assert.equal(byId['inc-4'].answerKey, 'inc-4-discard');

  // The evidence has to make the answer derivable rather than guessable.
  assert.ok(byId['inc-1'].evidence.join(' ').includes('never entered the danger zone'));
  assert.ok(byId['inc-2'].evidence.join(' ').includes('75 C for 30 seconds'));
  assert.ok(byId['inc-3'].evidence.join(' ').includes('nobody can say'));
  assert.ok(byId['inc-4'].evidence.join(' ').includes('twelve hours'));
});
