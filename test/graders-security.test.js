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

const LAB = 'feedback-loop-attack-surface';
const TRIAGE = 'injection-triage-advanced';

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

/* --------------------------------------------------------------------- */
/* Manifest and content shape                                            */
/* --------------------------------------------------------------------- */

test('manifest describes the security unit', () => {
  assert.equal(MANIFEST.protocol, 'nema/0.1');
  assert.equal(MANIFEST.provider.origin, 'https://nema-security.migarci2.dev');
  assert.equal(MANIFEST.provider.keyId, 'security-2026-09');
  assert.equal(MANIFEST.provider.name, 'Agent Security');
  assert.equal(MANIFEST.unit.id, 'feedback-loop-attack-surface');
  assert.equal(MANIFEST.unit.title, 'Feedback Loop Attack Surface');
  assert.deepEqual(MANIFEST.requirements, [
    { concept: 'nema:tool-calling', ability: 'explain' },
    { concept: 'nema:feedback-loops', ability: 'explain' },
    { concept: 'nema:threat-modeling', ability: 'apply' }
  ]);
  assert.deepEqual(ACTIVITY_ORDER, [
    'tool-calling-intro',
    'threat-modeling-intro',
    LAB,
    TRIAGE
  ]);
  assert.equal(MANIFEST.activities.length, 4);
  assert.equal(
    MANIFEST.unit.estimatedMinutes,
    ACTIVITY_ORDER.reduce((total, id) => total + ACTIVITIES[id].minutes, 0)
  );
});

test('the intros carry skipIf and the labs carry unlock', () => {
  assert.deepEqual(ACTIVITIES['tool-calling-intro'].skipIf, [
    { concept: 'nema:tool-calling', ability: 'explain', status: 'verified' }
  ]);
  assert.deepEqual(ACTIVITIES['threat-modeling-intro'].skipIf, [
    { concept: 'nema:threat-modeling', ability: 'apply', status: 'verified' }
  ]);
  assert.deepEqual(ACTIVITIES[LAB].unlock, [
    { concept: 'nema:feedback-loops', ability: 'explain', minStatus: 'uncertain' }
  ]);
  assert.equal(ACTIVITIES[TRIAGE].unlock.length, 3);
  assert.deepEqual(ACTIVITIES[LAB].skipIf, []);
  assert.deepEqual(ACTIVITIES[TRIAGE].skipIf, []);
});

test('the lab content matches the documented shape', () => {
  const lab = ACTIVITIES[LAB];
  assert.equal(lab.trace.length, 10);
  assert.equal(lab.trace.filter((entry) => entry.actor === 'tool').length, 6);
  assert.equal(lab.trace.filter((entry) => entry.injected).length, 3);
  assert.deepEqual(
    lab.trace.filter((entry) => entry.untrusted).map((entry) => entry.id),
    KEY.untrustedIds
  );
  for (const entry of lab.trace) {
    assert.ok(['user', 'agent', 'tool'].includes(entry.actor));
    assert.ok(entry.id && entry.label && entry.content);
    assert.ok(!entry.untrusted || entry.actor === 'tool');
  }
  assert.equal(lab.mitigations.length, 7);
  assert.equal(lab.mitigations.filter((m) => m.kind === 'effective').length, 3);
  assert.equal(lab.mitigations.filter((m) => m.kind === 'harmful').length, 2);
  assert.equal(lab.mitigations.filter((m) => m.kind === 'neutral').length, 2);

  assert.equal(INCIDENTS.length, 4);
  const chosen = new Set();
  for (const incident of INCIDENTS) {
    assert.equal(incident.options.length, 4);
    assert.ok(incident.options.some((option) => option.id === incident.answerKey));
    assert.equal(ACTIVITIES[TRIAGE].answerKey[incident.id], incident.answerKey);
    assert.ok(incident.evidence.length >= 3);
    chosen.add(incident.answerKey.replace(incident.id + '-', ''));
  }
  assert.deepEqual([...chosen].sort(), ['block', 'escalate', 'none', 'sanitize']);
});

test('CONTENT_HASH_INPUT is the serialized activity set', () => {
  assert.equal(typeof CONTENT_HASH_INPUT, 'string');
  assert.deepEqual(Object.keys(JSON.parse(CONTENT_HASH_INPUT)), ACTIVITY_ORDER);
});

/* --------------------------------------------------------------------- */
/* grade: feedback-loop-attack-surface                                    */
/* --------------------------------------------------------------------- */

test('attack surface lab passes with the exact untrusted set and all three effective mitigations', () => {
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
      ['nema:attack-surface', 'apply', 'application', 'passed'],
      ['nema:prompt-injection', 'discriminate', 'discrimination', 'passed']
    ]
  );
});

test('neutral mitigations do not spoil a pass', () => {
  const out = grade(LAB, {
    untrusted: [...KEY.untrustedIds].reverse(),
    mitigations: [...KEY.effectiveMitigations, ...KEY.neutralMitigations]
  });
  assert.equal(out.result, 'passed');
});

test('attack surface lab is partial with two effective mitigations', () => {
  const out = grade(LAB, {
    untrusted: [...KEY.untrustedIds],
    mitigations: KEY.effectiveMitigations.slice(0, 2)
  });
  assert.equal(out.result, 'partial');
  assert.ok(out.score > 0 && out.score < 1);
  assert.equal(out.claims.length, 2);
  assert.ok(out.claims.every((claim) => claim.result === 'partial'));
});

test('attack surface lab fails when a harmful mitigation is selected', () => {
  const out = grade(LAB, {
    untrusted: [...KEY.untrustedIds],
    mitigations: [...KEY.effectiveMitigations, KEY.harmfulMitigations[0]]
  });
  assert.equal(out.result, 'failed');
  assert.deepEqual(out.claims, []);
  assert.ok(out.feedback.some((line) => line.includes('Harmful mitigation selected')));
});

test('attack surface lab fails when only the injected results are marked', () => {
  const out = grade(LAB, {
    untrusted: [...KEY.injectedIds],
    mitigations: [...KEY.effectiveMitigations]
  });
  assert.equal(out.result, 'failed');
  assert.deepEqual(out.claims, []);
  assert.ok(out.feedback.some((line) => line.includes('Missed untrusted content')));
});

test('attack surface lab fails when a trusted result is marked untrusted', () => {
  const out = grade(LAB, {
    untrusted: [...KEY.untrustedIds, 't8'],
    mitigations: [...KEY.effectiveMitigations]
  });
  assert.equal(out.result, 'failed');
  assert.ok(out.feedback.some((line) => line.includes('Marked as untrusted without an outside author')));
});

test('attack surface lab handles an empty submission', () => {
  const out = grade(LAB, {});
  assert.equal(out.result, 'failed');
  assert.equal(out.score, 0);
  assert.deepEqual(out.claims, []);
});

/* --------------------------------------------------------------------- */
/* grade: injection-triage-advanced                                       */
/* --------------------------------------------------------------------- */

test('triage lab passes on four correct calls', () => {
  const out = grade(TRIAGE, { answers: correctTriageAnswers() });
  assert.equal(out.result, 'passed');
  assert.equal(out.score, 1);
  assert.deepEqual(
    out.claims.map((claim) => [claim.concept, claim.ability, claim.evidenceType, claim.result]),
    [
      ['nema:prompt-injection', 'apply', 'application', 'passed'],
      ['nema:output-validation', 'apply', 'application', 'passed']
    ]
  );
});

test('triage lab is partial on three correct calls', () => {
  const answers = correctTriageAnswers();
  answers[INCIDENTS[1].id] = wrongOptionFor(INCIDENTS[1]);
  const out = grade(TRIAGE, { answers });
  assert.equal(out.result, 'partial');
  assert.equal(out.score, 0.75);
  assert.equal(out.claims.length, 2);
  assert.ok(out.claims.every((claim) => claim.result === 'partial'));
  assert.ok(out.feedback[0].startsWith('3 of 4'));
});

test('triage lab fails on two correct calls', () => {
  const answers = correctTriageAnswers();
  answers[INCIDENTS[0].id] = wrongOptionFor(INCIDENTS[0]);
  answers[INCIDENTS[3].id] = wrongOptionFor(INCIDENTS[3]);
  const out = grade(TRIAGE, { answers });
  assert.equal(out.result, 'failed');
  assert.equal(out.score, 0.5);
  assert.deepEqual(out.claims, []);
});

test('triage lab fails with no answers at all', () => {
  const out = grade(TRIAGE, {});
  assert.equal(out.result, 'failed');
  assert.equal(out.score, 0);
  assert.ok(out.feedback.some((line) => line.includes('No option was recorded')));
});

/* --------------------------------------------------------------------- */
/* grade: lessons and unknown activities                                  */
/* --------------------------------------------------------------------- */

test('a completed lesson produces one exposure claim', () => {
  const out = grade('tool-calling-intro', { completed: true });
  assert.equal(out.result, 'passed');
  assert.deepEqual(out.claims, [
    {
      concept: 'nema:tool-calling',
      ability: 'recognize',
      evidenceType: 'recognition',
      result: 'passed',
      difficulty: 'introductory'
    }
  ]);
  assert.deepEqual(
    ACTIVITIES['tool-calling-intro'].lesson.exposureClaim,
    { concept: 'nema:tool-calling', ability: 'recognize', evidenceType: 'recognition' }
  );
});

test('an unopened lesson claims nothing', () => {
  const out = grade('threat-modeling-intro', {});
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

test('the demo story: both intros skippable, both labs unlocked', () => {
  const out = checkPrerequisites({
    'nema:tool-calling|explain': 'verified',
    'nema:threat-modeling|apply': 'verified',
    'nema:feedback-loops|explain': 'uncertain'
  });

  assert.deepEqual(out.recognized, [
    { concept: 'nema:tool-calling', ability: 'explain', status: 'verified' },
    { concept: 'nema:feedback-loops', ability: 'explain', status: 'uncertain' },
    { concept: 'nema:threat-modeling', ability: 'apply', status: 'verified' }
  ]);
  assert.deepEqual(out.skippable, ['tool-calling-intro', 'threat-modeling-intro']);
  assert.deepEqual(out.unlocked, [
    'tool-calling-intro',
    'threat-modeling-intro',
    LAB,
    TRIAGE
  ]);
  assert.deepEqual(out.locked, []);
  assert.equal(out.recommendedFirst, LAB);
});

test('the same story works with bare concept ids', () => {
  const out = checkPrerequisites({
    'tool-calling|explain': 'verified',
    'threat-modeling|apply': 'verified',
    'feedback-loops|explain': 'uncertain'
  });
  assert.equal(out.recommendedFirst, LAB);
  assert.deepEqual(out.locked, []);
  assert.equal(out.recognized[1].status, 'uncertain');
});

test('without feedback-loops both labs are locked with the missing entry', () => {
  const out = checkPrerequisites({
    'nema:tool-calling|explain': 'verified',
    'nema:threat-modeling|apply': 'verified',
    'nema:feedback-loops|explain': 'missing'
  });

  assert.deepEqual(out.locked, [
    {
      activityId: LAB,
      missing: [{ concept: 'nema:feedback-loops', ability: 'explain', needed: 'uncertain' }]
    },
    {
      activityId: TRIAGE,
      missing: [{ concept: 'nema:feedback-loops', ability: 'explain', needed: 'uncertain' }]
    }
  ]);
  assert.deepEqual(out.unlocked, ['tool-calling-intro', 'threat-modeling-intro']);
  assert.deepEqual(out.skippable, ['tool-calling-intro', 'threat-modeling-intro']);
  assert.equal(out.recommendedFirst, null);
});

test('an empty assertion locks the labs and recommends the first intro', () => {
  const out = checkPrerequisites({});
  assert.deepEqual(out.recognized.map((entry) => entry.status), ['missing', 'missing', 'missing']);
  assert.deepEqual(out.skippable, []);
  assert.equal(out.recommendedFirst, 'tool-calling-intro');
  assert.equal(out.locked.length, 2);
  assert.equal(out.locked[1].missing.length, 3);
});

test('uncertain never satisfies a requirement that needs verified', () => {
  const out = checkPrerequisites({
    'nema:tool-calling|explain': 'uncertain',
    'nema:threat-modeling|apply': 'uncertain',
    'nema:feedback-loops|explain': 'verified'
  });
  assert.deepEqual(out.skippable, []);
  assert.deepEqual(out.unlocked, ['tool-calling-intro', 'threat-modeling-intro', LAB]);
  assert.deepEqual(out.locked, [
    {
      activityId: TRIAGE,
      missing: [
        { concept: 'nema:threat-modeling', ability: 'apply', needed: 'verified' },
        { concept: 'nema:tool-calling', ability: 'explain', needed: 'verified' }
      ]
    }
  ]);
  assert.equal(out.recommendedFirst, 'tool-calling-intro');
});

test('garbage input is treated as missing, not as an error', () => {
  for (const input of [undefined, null, 'nonsense', 42, { 'nema:tool-calling|explain': 'maybe' }]) {
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

test('trace content must be rendered as text, not as markup', () => {
  const trace = ACTIVITIES[LAB].trace;
  const byId = Object.fromEntries(trace.map((entry) => [entry.id, entry]));

  // t5 hides its payload in an HTML comment. innerHTML would delete it.
  assert.ok(byId.t5.content.includes('<!--'));
  assert.ok(byId.t5.content.includes('SYSTEM NOTE'));
  assert.equal(asInnerHtmlWouldShow(byId.t5.content).includes('SYSTEM NOTE'), false);

  // Every multi line result would collapse to one line under innerHTML.
  const multiline = trace.filter((entry) => entry.content.includes('\n'));
  assert.ok(multiline.length >= 5);
  for (const entry of multiline) {
    assert.notEqual(asInnerHtmlWouldShow(entry.content), entry.content);
  }

  // No plain text field smuggles markup or HTML entities of its own.
  const plain = [];
  for (const entry of trace) plain.push(entry.label, entry.source, entry.why, entry.content);
  for (const m of ACTIVITIES[LAB].mitigations) plain.push(m.label, m.detail);
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
  }

  // The two fields that are markup are the only ones named html.
  for (const activity of [ACTIVITIES[LAB], ACTIVITIES[TRIAGE]]) {
    assert.ok(activity.scenario.html.startsWith('<p>'));
  }
  for (const id of ['tool-calling-intro', 'threat-modeling-intro']) {
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

  assert.ok(ACTIVITIES['tool-calling-intro'].skipReason.startsWith('Skipped:'));
  assert.ok(ACTIVITIES['threat-modeling-intro'].skipReason.startsWith('Skipped:'));

  for (const id of [LAB, TRIAGE]) {
    assert.ok(
      ACTIVITIES[id].unlockReason.includes('Prerequisite recognised from another provider'),
      id + ' must carry the story beat copy'
    );
    assert.ok(ACTIVITIES[id].lockedReason.startsWith('Locked:'));
  }
});

/* --------------------------------------------------------------------- */
/* Trace provenance is evidence, not a label giveaway                     */
/* --------------------------------------------------------------------- */

test('labels name the call only, and every entry carries a source', () => {
  for (const entry of ACTIVITIES[LAB].trace) {
    assert.ok(entry.source && entry.source.length > 8, entry.id + ' needs a source');
    assert.ok(entry.why && entry.why.length > 20, entry.id + ' needs a why');
    if (entry.actor === 'tool') {
      assert.match(entry.label, /^[a-z_]+\(.*\) result$/, entry.id + ' label leaks more than the call');
    }
  }
  const toolLabels = ACTIVITIES[LAB].trace
    .filter((entry) => entry.actor === 'tool')
    .map((entry) => entry.label.toLowerCase());
  for (const label of toolLabels) {
    for (const giveaway of ['our own', 'outside', 'runtime', 'untrusted', 'third party']) {
      assert.equal(label.includes(giveaway), false, 'label gives the answer away: ' + label);
    }
  }
});

test('the scenario states that untrusted and injected are different sets', () => {
  const html = ACTIVITIES[LAB].scenario.html.toLowerCase();
  assert.ok(html.includes('provenance'));
  assert.ok(html.includes('not the same as the set that carries an injection'));
  // The exact counts stay out of the brief: the learner has to derive them.
  assert.equal(/\b(three|four|3|4) (of the )?(results|tool results)\b/.test(html), false);
});

/* --------------------------------------------------------------------- */
/* Feedback only talks about the entries the learner got wrong            */
/* --------------------------------------------------------------------- */

test('missed untrusted feedback quotes the missed entry and nothing else', () => {
  const out = grade(LAB, {
    untrusted: ['t5', 't6', 't7'], // t3, the ticket, is missing
    mitigations: [...KEY.effectiveMitigations]
  });
  assert.equal(out.result, 'failed');
  const missedLine = out.feedback.find((line) => line.startsWith('Missed untrusted content'));
  assert.ok(missedLine);
  assert.ok(missedLine.includes('ticket_get("SUP-4127") result'));
  assert.ok(missedLine.includes('typed this body into your ticket form'));
  // Nothing about the git log, which the learner marked correctly.
  assert.equal(missedLine.includes('git_log'), false);
  assert.equal(missedLine.includes('commit'), false);
  assert.equal(
    out.feedback.some((line) => line.startsWith('Marked as untrusted without an outside author')),
    false
  );
});

test('over marked feedback quotes the over marked entry and nothing else', () => {
  const out = grade(LAB, {
    untrusted: [...KEY.untrustedIds, 't1'], // the principal request
    mitigations: [...KEY.effectiveMitigations]
  });
  assert.equal(out.result, 'failed');
  const overLine = out.feedback.find((line) =>
    line.startsWith('Marked as untrusted without an outside author')
  );
  assert.ok(overLine);
  assert.ok(overLine.includes('Request from the principal'));
  assert.ok(overLine.includes('the party you decided to obey'));
  // Nothing about the harness or the clock, which the learner did not mark.
  assert.equal(overLine.includes('run_tests'), false);
  assert.equal(overLine.includes('clock'), false);
  assert.equal(out.feedback.some((line) => line.startsWith('Missed untrusted content')), false);
});

test('a correct untrusted set is praised without naming individual entries', () => {
  const out = grade(LAB, {
    untrusted: [...KEY.untrustedIds],
    mitigations: [...KEY.effectiveMitigations]
  });
  const line = out.feedback.find((entry) => entry.startsWith('Untrusted surface: correct'));
  assert.ok(line);
  assert.ok(line.includes('All 4 results'));
  assert.ok(line.includes('the 2 produced by your own infrastructure'));
});

/* --------------------------------------------------------------------- */
/* Incident evidence supports the answer key                              */
/* --------------------------------------------------------------------- */

test('sanitize is a real state change in inc-2 and the status quo in inc-4', () => {
  const inc2 = INCIDENTS.find((incident) => incident.id === 'inc-2');
  const inc4 = INCIDENTS.find((incident) => incident.id === 'inc-4');

  const inc2Evidence = inc2.evidence.join(' ').toLowerCase();
  assert.ok(inc2Evidence.includes('no envelope is applied'));
  assert.ok(inc2Evidence.includes('instruction prompt'));
  assert.equal(inc2.answerKey, 'inc-2-sanitize');

  const inc4Evidence = inc4.evidence.join(' ').toLowerCase();
  assert.ok(inc4Evidence.includes('untrusted envelope'));
  assert.equal(inc4.answerKey, 'inc-4-none');
});
