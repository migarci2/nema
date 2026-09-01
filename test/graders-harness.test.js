/**
 * Saucier School provider: content, graders and path personalization.
 * Run: node --test test/graders-harness.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  ACTIVITIES,
  CONTENT_HASH_INPUT,
  MANIFEST,
  grade,
  personalizePath
} from '../apps/harness/public/content.js';

/* ------------------------------------------------------------------ */
/* Fixtures                                                            */
/* ------------------------------------------------------------------ */

const LAB = ACTIVITIES['fix-the-broken-sauce'].content;
const LAB_KEY = LAB.answerKey;

const ALL_MISSING = {
  'nema:knife-skills|apply': 'missing',
  'nema:heat-control|explain': 'missing',
  'nema:ratios|apply': 'missing'
};

const SEED = {
  'nema:knife-skills|apply': 'verified',
  'nema:heat-control|explain': 'verified',
  'nema:ratios|apply': 'uncertain'
};

const AFTER_DIAGNOSTIC = {
  'nema:knife-skills|apply': 'verified',
  'nema:heat-control|explain': 'verified',
  'nema:ratios|apply': 'verified'
};

const GOOD_ANSWER =
  'A pan sauce is an emulsion, not a liquid somebody thickened: the butterfat is broken into droplets and held ' +
  'inside the reduced stock instead of floating on top of it. The milk solids in the butter are the emulsifier ' +
  'doing that work, the same job the mustard does in a vinaigrette. Ours split because it went back to a rolling ' +
  'boil after it was mounted, and past about 90 C the droplets merge again and the fat comes out. Mount off the ' +
  'heat and hold it near 65 C.';

// Meets the first two criteria and nothing about temperature, which is the
// most common gap: cooks describe the structure and forget what breaks it.
const PARTIAL_ANSWER =
  'A pan sauce is an emulsion rather than a liquid somebody thickened with flour. The butterfat ends up as tiny ' +
  'droplets suspended through the reduced stock, and something has to keep those droplets from finding each other ' +
  'again. In a vinaigrette that job belongs to the mustard; in a mounted pan sauce the milk solids in the butter ' +
  'do the same work while you swirl the pan and drop the cubes in a few at a time.';

// Covers all three criteria without using a single keyword verbatim: every hit
// is an inflection ("emulsified", "droplets", "Boiling").
const INFLECTED_ANSWER =
  'The stock and the butterfat are emulsified into one another rather than layered, so what you are looking at is ' +
  'millions of fat droplets that never get the chance to find each other again. Boiling the finished sauce is what ' +
  'undoes that, which is why the pan comes off the flame before the butter goes in, and why nothing that has been ' +
  'mounted ever goes back over a live flame.';

const WEAK_ANSWER =
  'I would follow the recipe the way I was taught at the restaurant, taste it at the end of service, and if it looks ' +
  'wrong I would start again with a clean pan, a better wine and more butter, because that is what the chef always ' +
  'did on a busy Saturday night when the plates were already going out.';

/* ------------------------------------------------------------------ */
/* Manifest and content integrity                                      */
/* ------------------------------------------------------------------ */

test('manifest describes the Saucier School provider', () => {
  assert.equal(MANIFEST.protocol, 'nema/0.1');
  assert.equal(MANIFEST.provider.origin, 'https://saucier.migarci2.dev');
  assert.equal(MANIFEST.provider.name, 'Saucier School');
  assert.equal(MANIFEST.provider.keyId, 'saucier-2026-09');
  assert.equal(MANIFEST.unit.id, 'pan-sauces-foundations');
  assert.equal(MANIFEST.unit.title, 'Pan Sauces and Emulsions');
  assert.equal(MANIFEST.unit.language, 'en');
  assert.equal(MANIFEST.unit.price, 'free');
});

test('estimated minutes equal the sum of the full path', () => {
  const sum = Object.values(ACTIVITIES).reduce((total, a) => total + a.minutes, 0);
  assert.equal(sum, 68);
  assert.equal(MANIFEST.unit.estimatedMinutes, 68);
  assert.equal(MANIFEST.activities.length, 7);
  assert.deepEqual(
    MANIFEST.activities.map((a) => a.id),
    [
      'heat-control-primer',
      'knife-skills-refresher',
      'ratios-diagnostic',
      'ratios-primer',
      'pan-sauce-anatomy',
      'fix-the-broken-sauce',
      'explain-without-the-recipe'
    ]
  );
});

test('manifest requirements match the activity gates', () => {
  const requirements = MANIFEST.requirements.map((r) => r.concept + '|' + r.ability).sort();
  assert.deepEqual(requirements, [
    'nema:heat-control|explain',
    'nema:knife-skills|apply',
    'nema:ratios|apply'
  ]);
});

test('manifest outcomes are the four the unit claims to produce', () => {
  const outcomes = MANIFEST.outcomes.map((o) => o.concept + '|' + o.ability).sort();
  assert.deepEqual(outcomes, [
    'nema:emulsions|discriminate',
    'nema:pan-sauces|apply',
    'nema:pan-sauces|explain',
    'nema:ratios|apply'
  ]);
});

test('every activity carries the fields the UI and the worker read', () => {
  for (const [id, activity] of Object.entries(ACTIVITIES)) {
    assert.equal(activity.id, id);
    assert.equal(activity.version, '1.0.0');
    assert.ok(activity.title.length > 0);
    assert.ok(['lesson', 'diagnostic', 'interactive-lab', 'free-recall'].includes(activity.type));
    assert.ok(activity.minutes > 0);
    assert.ok(Array.isArray(activity.outcomes) && activity.outcomes.length > 0);
    assert.ok(Array.isArray(activity.skipIf));
    assert.ok(typeof activity.whatTheLearnerDoes === 'string' && activity.whatTheLearnerDoes.length > 0);
    assert.ok(activity.content && typeof activity.content === 'object');
  }
});

test('lessons have three sections and an exposure claim', () => {
  const lessons = Object.values(ACTIVITIES).filter((a) => a.type === 'lesson');
  assert.equal(lessons.length, 4);
  for (const lesson of lessons) {
    assert.equal(lesson.grader, 'exposure');
    assert.equal(lesson.content.sections.length, 3);
    assert.ok(lesson.content.keyPoints.length >= 4);
    assert.equal(lesson.content.exposureClaim.ability, 'recognize');
    assert.equal(lesson.content.exposureClaim.evidenceType, 'recognition');
    const words = lesson.content.sections
      .map((s) => s.html.replace(/<[^>]+>/g, ' '))
      .join(' ')
      .trim()
      .split(/\s+/).length;
    assert.ok(words >= 300, lesson.id + ' is too short to be a real lesson: ' + words + ' words');
  }
});

test('the diagnostic has four written ratios and exactly one answer key', () => {
  const content = ACTIVITIES['ratios-diagnostic'].content;
  assert.equal(content.options.length, 4);
  const correct = content.options.filter((o) => o.whyWrong === '');
  assert.equal(correct.length, 1);
  assert.equal(correct[0].id, content.answerKey);
  assert.equal(content.answerKey, 'ratio-b');
  assert.equal(content.hints.length, 2);
  // The three distractors are wrong in three different ways: too much acid,
  // no emulsifier, and an inverted ratio.
  const wrong = content.options.filter((o) => o.id !== content.answerKey);
  assert.equal(wrong.length, 3);
  for (const option of wrong) assert.ok(option.whyWrong.length > 40);
  assert.ok(correct[0].html.includes('3 parts oil to 1 part acid'));
  assert.ok(correct[0].html.toLowerCase().includes('dijon'));
});

test('the lab has 8 checks split 3 required, 2 harmful, 3 neutral', () => {
  const counts = { required: 0, harmful: 0, neutral: 0 };
  for (const check of LAB.checks) counts[check.kind] += 1;
  assert.equal(LAB.checks.length, 8);
  assert.deepEqual(counts, { required: 3, harmful: 2, neutral: 3 });
  assert.deepEqual(
    LAB.checks.filter((c) => c.kind === 'required').map((c) => c.id).sort(),
    [...LAB_KEY.requiredChecks].sort()
  );
  assert.deepEqual(
    LAB.checks.filter((c) => c.kind === 'harmful').map((c) => c.id).sort(),
    [...LAB_KEY.harmfulChecks].sort()
  );
  for (const check of LAB.checks) assert.ok(check.detail.length > 40);
});

test('the lab orders three stages and shows a before and after tasting log', () => {
  assert.equal(LAB.stages.length, 3);
  assert.deepEqual(LAB.stages.map((s) => s.id).sort(), [...LAB_KEY.stageOrder].sort());
  assert.deepEqual(LAB_KEY.stageOrder, ['deglaze', 'reduce', 'mount']);
  assert.ok(LAB.beforeRun.length >= 5 && LAB.beforeRun.length <= 7);
  assert.ok(LAB.afterRun.length >= 5 && LAB.afterRun.length <= 7);
  assert.ok(LAB.beforeRun.some((line) => line.includes('greasy')));
  assert.ok(LAB.beforeRun.some((line) => line.includes('sauce rejected')));
  assert.ok(LAB.afterRun.some((line) => line.includes('coats the back of the spoon')));
  assert.ok(LAB.afterRun.some((line) => line.includes('holds on the pass')));
  assert.equal(LAB.hints.length, 3);
});

test('the free recall rubric has three keyword criteria', () => {
  const content = ACTIVITIES['explain-without-the-recipe'].content;
  assert.equal(content.rubric.length, 3);
  assert.equal(content.minWords, 40);
  for (const criterion of content.rubric) {
    assert.ok(criterion.keywords.length > 0);
    assert.ok(criterion.criterion.length > 0);
  }
  assert.deepEqual(content.rubric.map((c) => c.id), [
    'emulsion-named',
    'what-holds-it',
    'heat-window'
  ]);
});

test('content hash input is stable and parses back to the activities', () => {
  assert.equal(typeof CONTENT_HASH_INPUT, 'string');
  assert.deepEqual(JSON.parse(CONTENT_HASH_INPUT), JSON.parse(JSON.stringify(ACTIVITIES)));
});

test('content has no emojis and no em dashes', () => {
  const serialized = CONTENT_HASH_INPUT + JSON.stringify(MANIFEST);
  assert.equal(/[\u2013\u2014]/.test(serialized), false, 'en dash or em dash found');
  assert.equal(
    /[\u{1F300}-\u{1FAFF}\u{2190}-\u{21FF}\u{2600}-\u{27BF}\u{FE0F}]/u.test(serialized),
    false,
    'emoji found'
  );
});

/* ------------------------------------------------------------------ */
/* grade(): lessons                                                    */
/* ------------------------------------------------------------------ */

for (const lessonId of [
  'heat-control-primer',
  'knife-skills-refresher',
  'ratios-primer',
  'pan-sauce-anatomy'
]) {
  test('lesson ' + lessonId + ' passes when completed and fails otherwise', () => {
    const passed = grade(lessonId, { completed: true });
    assert.equal(passed.result, 'passed');
    assert.equal(passed.score, 1);
    assert.equal(passed.claims.length, 1);
    assert.equal(passed.claims[0].ability, 'recognize');
    assert.equal(passed.claims[0].evidenceType, 'recognition');
    assert.equal(passed.claims[0].result, 'passed');
    assert.equal(passed.claims[0].concept, ACTIVITIES[lessonId].content.exposureClaim.concept);

    const failed = grade(lessonId, { completed: false });
    assert.equal(failed.result, 'failed');
    assert.equal(failed.score, 0);
    assert.deepEqual(failed.claims, []);

    const empty = grade(lessonId, {});
    assert.equal(empty.result, 'failed');
  });
}

/* ------------------------------------------------------------------ */
/* grade(): diagnostic                                                 */
/* ------------------------------------------------------------------ */

test('diagnostic passes on 3 parts oil to 1 part acid with mustard', () => {
  const result = grade('ratios-diagnostic', { optionId: 'ratio-b' });
  assert.equal(result.result, 'passed');
  assert.equal(result.score, 1);
  assert.deepEqual(result.claims, [
    {
      concept: 'nema:ratios',
      ability: 'apply',
      evidenceType: 'application',
      result: 'passed',
      difficulty: 'intermediate'
    }
  ]);
  assert.ok(result.feedback[0].includes('Three parts oil to one part acid'));
});

test('hints do not change the diagnostic result', () => {
  // hintsUsed reaches the vault in the receipt conditions. The provider does
  // not grade it a second time, so the 27 -> 21 beat cannot be broken by a
  // judge who opens both hints before answering.
  const baseline = grade('ratios-diagnostic', { optionId: 'ratio-b' });
  for (const hintsUsed of [0, 1, 2, 5]) {
    const result = grade('ratios-diagnostic', { optionId: 'ratio-b', hintsUsed });
    assert.equal(result.result, 'passed', hintsUsed + ' hints must still pass');
    assert.equal(result.score, 1);
    assert.deepEqual(result.claims, baseline.claims);
  }

  // Hints do not rescue a wrong answer either.
  assert.equal(grade('ratios-diagnostic', { optionId: 'ratio-a', hintsUsed: 0 }).result, 'failed');
});

test('diagnostic fails on each distractor and on no answer', () => {
  for (const optionId of ['ratio-a', 'ratio-c', 'ratio-d']) {
    const result = grade('ratios-diagnostic', { optionId });
    assert.equal(result.result, 'failed', optionId + ' must not pass');
    assert.equal(result.score, 0);
    assert.deepEqual(result.claims, []);
    assert.ok(result.feedback[0].length > 0);
  }
  assert.equal(grade('ratios-diagnostic', {}).result, 'failed');
  assert.equal(grade('ratios-diagnostic', { optionId: 'ratio-z' }).result, 'failed');
});

/* ------------------------------------------------------------------ */
/* grade(): interactive lab                                            */
/* ------------------------------------------------------------------ */

test('lab passes with the three required steps, no harmful step and the right order', () => {
  const result = grade('fix-the-broken-sauce', {
    checks: [...LAB_KEY.requiredChecks],
    stageOrder: [...LAB_KEY.stageOrder]
  });
  assert.equal(result.result, 'passed');
  assert.equal(result.score, 1);
  assert.deepEqual(result.claims, [
    {
      concept: 'nema:pan-sauces',
      ability: 'apply',
      evidenceType: 'application',
      result: 'passed',
      difficulty: 'intermediate'
    },
    {
      concept: 'nema:emulsions',
      ability: 'discriminate',
      evidenceType: 'discrimination',
      result: 'passed',
      difficulty: 'intermediate'
    }
  ]);
});

test('lab still passes when neutral steps are selected too', () => {
  const result = grade('fix-the-broken-sauce', {
    checks: [...LAB_KEY.requiredChecks, 'warm-the-plates', 'pass-through-chinois', 'log-the-timings'],
    stageOrder: [...LAB_KEY.stageOrder]
  });
  assert.equal(result.result, 'passed');
});

test('lab is partial when the steps are right and the stage order is wrong', () => {
  const result = grade('fix-the-broken-sauce', {
    checks: [...LAB_KEY.requiredChecks],
    stageOrder: ['mount', 'deglaze', 'reduce']
  });
  assert.equal(result.result, 'partial');
  assert.equal(result.score, 0.7);
  assert.equal(result.claims.length, 1);
  assert.equal(result.claims[0].concept, 'nema:pan-sauces');
  assert.equal(result.claims[0].ability, 'apply');
  assert.equal(result.claims[0].result, 'partial');
});

test('lab fails when a harmful step is selected, even with every required step', () => {
  const result = grade('fix-the-broken-sauce', {
    checks: [...LAB_KEY.requiredChecks, 'boil-after-mounting'],
    stageOrder: [...LAB_KEY.stageOrder]
  });
  assert.equal(result.result, 'failed');
  assert.deepEqual(result.claims, []);
  assert.ok(result.feedback.some((line) => line.includes('breaks a sauce')));
});

test('lab fails when a required step is missing', () => {
  const result = grade('fix-the-broken-sauce', {
    checks: ['deglaze-the-fond', 'reduce-by-half'],
    stageOrder: [...LAB_KEY.stageOrder]
  });
  assert.equal(result.result, 'failed');
  assert.ok(result.score > 0 && result.score < 1);
  assert.deepEqual(result.claims, []);
});

test('lab fails on an empty or malformed submission', () => {
  assert.equal(grade('fix-the-broken-sauce', {}).result, 'failed');
  assert.equal(
    grade('fix-the-broken-sauce', { checks: 'deglaze-the-fond', stageOrder: 7 }).result,
    'failed'
  );
  const duplicates = grade('fix-the-broken-sauce', {
    checks: [...LAB_KEY.requiredChecks, 'deglaze-the-fond', 'unknown-step'],
    stageOrder: [...LAB_KEY.stageOrder, 'mount']
  });
  assert.equal(duplicates.result, 'passed', 'duplicates and unknown ids are ignored, not fatal');
});

/* ------------------------------------------------------------------ */
/* grade(): free recall                                                */
/* ------------------------------------------------------------------ */

test('free recall passes when all three rubric criteria are met', () => {
  const result = grade('explain-without-the-recipe', { text: GOOD_ANSWER });
  assert.equal(result.result, 'passed');
  assert.equal(result.score, 1);
  assert.deepEqual(result.claims, [
    {
      concept: 'nema:pan-sauces',
      ability: 'explain',
      evidenceType: 'explanation',
      result: 'passed',
      difficulty: 'intermediate'
    }
  ]);
});

test('free recall accepts ordinary inflections of the rubric stems', () => {
  const inflected = grade('explain-without-the-recipe', { text: INFLECTED_ANSWER });
  assert.equal(inflected.result, 'passed');
  assert.equal(inflected.score, 1);
  assert.equal(inflected.claims.length, 1);
  assert.equal(
    inflected.feedback.some((line) => line.startsWith('Still missing:')),
    false,
    'an answer that covers all three criteria must not be told it missed one'
  );
});

test('free recall is partial when two criteria are met', () => {
  const result = grade('explain-without-the-recipe', { text: PARTIAL_ANSWER });
  assert.equal(result.result, 'partial');
  assert.ok(Math.abs(result.score - 0.67) < 0.01);
  assert.equal(result.claims.length, 1);
  assert.equal(result.claims[0].result, 'partial');
  assert.ok(result.feedback.some((line) => line.startsWith('Still missing:')));
});

test('free recall fails on a long answer that meets no criteria', () => {
  const result = grade('explain-without-the-recipe', { text: WEAK_ANSWER });
  assert.equal(result.result, 'failed');
  assert.deepEqual(result.claims, []);
});

test('free recall refuses to grade an answer under the word floor', () => {
  const result = grade('explain-without-the-recipe', {
    text: 'A pan sauce is an emulsion of fat and water held by the milk solids, and a boil splits it.'
  });
  assert.equal(result.result, 'failed');
  assert.equal(result.score, 0);
  assert.ok(result.feedback[0].includes('40'));
  assert.deepEqual(result.claims, []);
});

test('free recall keyword matching respects word boundaries and case', () => {
  const shouting = grade('explain-without-the-recipe', {
    text:
      'THE FAT AND WATER ARE HELD TOGETHER AS DROPLETS BY THE MILK SOLIDS IN THE BUTTER, AND THE WHOLE THING ' +
      'FALLS APART IF ANYONE LETS IT BOIL AGAIN AFTER THE BUTTER HAS GONE IN, WHICH IS EXACTLY WHAT HAPPENED ' +
      'TO THE FIRST ONE ON THE PASS TONIGHT.'
  });
  assert.equal(shouting.result, 'passed');

  const substringOnly = grade('explain-without-the-recipe', {
    text:
      'The preheating of the ovens went fine and the nonemulsified dressing on the salad course looked acceptable ' +
      'to everyone working the pass that night, so nobody bothered to taste the second sauce again before the ' +
      'plates went out to the tables in the dining room.'
  });
  assert.equal(substringOnly.result, 'failed', 'substrings inside words must not count');
});

/* ------------------------------------------------------------------ */
/* grade(): unknown activity                                           */
/* ------------------------------------------------------------------ */

test('unknown activity ids fail closed', () => {
  const result = grade('does-not-exist', { completed: true });
  assert.equal(result.result, 'failed');
  assert.deepEqual(result.claims, []);
});

/* ------------------------------------------------------------------ */
/* personalizePath(): the 68 -> 27 -> 21 story                          */
/* ------------------------------------------------------------------ */

test('no assertion yet: the whole offer, 68 minutes', () => {
  // null is the explicit "nothing has been presented" contract. undefined and
  // an empty object are accepted as the same thing.
  for (const nothing of [null, undefined, {}]) {
    const { path, skipped, fullMinutes, personalMinutes } = personalizePath(nothing);
    assert.equal(path.length, 7);
    assert.equal(skipped.length, 0);
    assert.equal(fullMinutes, 68);
    assert.equal(personalMinutes, 68);
  }
});

test('every requirement missing: nothing is skipped except the diagnostic', () => {
  const { path, skipped, fullMinutes, personalMinutes } = personalizePath(ALL_MISSING);
  assert.equal(fullMinutes, 68);
  assert.deepEqual(
    path.map((p) => p.activityId),
    [
      'heat-control-primer',
      'knife-skills-refresher',
      'ratios-primer',
      'pan-sauce-anatomy',
      'fix-the-broken-sauce',
      'explain-without-the-recipe'
    ]
  );
  // The remedial lessons are all present, which is the point of a missing
  // requirement. 62 is the longest path a real assertion can produce: 68 is the
  // offer before anyone has presented one.
  assert.equal(personalMinutes, 62);
  assert.deepEqual(skipped.map((s) => s.activityId), ['ratios-diagnostic']);
  assert.ok(skipped[0].reason.includes('only runs when ratios are uncertain'));
  assert.equal(
    skipped[0].reason.includes('already proves'),
    false,
    'a cook with no evidence must not be told the vault already proves the skill'
  );
});

test('seed learner: 68 becomes 27 at personalization time', () => {
  const { path, skipped, fullMinutes, personalMinutes } = personalizePath(SEED);
  assert.equal(fullMinutes, 68);
  assert.equal(personalMinutes, 27);
  assert.deepEqual(
    path.map((p) => p.activityId),
    [
      'ratios-diagnostic',
      'pan-sauce-anatomy',
      'fix-the-broken-sauce',
      'explain-without-the-recipe'
    ]
  );
  assert.deepEqual(
    skipped.map((s) => s.activityId),
    ['heat-control-primer', 'knife-skills-refresher', 'ratios-primer']
  );
  assert.equal(
    skipped.reduce((sum, s) => sum + s.minutes, 0),
    41
  );
  for (const item of path) assert.ok(item.reason.length > 0);
  for (const item of skipped) assert.ok(item.reason.length > 0);
});

test('after the diagnostic passes: 27 becomes 21', () => {
  const { path, skipped, personalMinutes } = personalizePath(AFTER_DIAGNOSTIC);
  assert.equal(personalMinutes, 21);
  assert.deepEqual(
    path.map((p) => p.activityId),
    ['pan-sauce-anatomy', 'fix-the-broken-sauce', 'explain-without-the-recipe']
  );
  assert.equal(skipped.length, 4);
  assert.ok(skipped.some((s) => s.activityId === 'ratios-primer'));

  // The learner just passed the diagnostic, so the panel must say so. Telling
  // them the check "only runs when ratios are uncertain" would be false at
  // exactly the moment a judge is reading the panel.
  const diagnostic = skipped.find((s) => s.activityId === 'ratios-diagnostic');
  assert.ok(diagnostic);
  assert.ok(
    diagnostic.reason.includes('already proves you can apply ratios'),
    'expected the vault-already-proves reason, got: ' + diagnostic.reason
  );
  for (const item of skipped) {
    assert.equal(
      item.reason.includes('Not applicable'),
      false,
      item.activityId + ' should not read as not applicable for this learner'
    );
  }
});

test('a verified status satisfies an uncertain gate, but not the reverse', () => {
  // ratios-primer is skipped at uncertain and at verified.
  const uncertain = personalizePath({ 'nema:ratios|apply': 'uncertain' });
  assert.ok(uncertain.skipped.some((s) => s.activityId === 'ratios-primer'));

  const verified = personalizePath({ 'nema:ratios|apply': 'verified' });
  assert.ok(verified.skipped.some((s) => s.activityId === 'ratios-primer'));

  // heat-control-primer requires verified: uncertain is not enough.
  const weakHeat = personalizePath({ 'nema:heat-control|explain': 'uncertain' });
  assert.ok(weakHeat.path.some((p) => p.activityId === 'heat-control-primer'));
});

test('unknown status values and unrelated keys are treated as missing', () => {
  const noisy = personalizePath({
    'nema:heat-control|explain': 'excellent',
    'nema:unrelated|apply': 'verified'
  });
  assert.ok(noisy.path.some((p) => p.activityId === 'heat-control-primer'));
  assert.equal(noisy.personalMinutes, 62);
});

test('the lab and the retrieval task are never skipped', () => {
  for (const statuses of [ALL_MISSING, SEED, AFTER_DIAGNOSTIC]) {
    const { path } = personalizePath(statuses);
    assert.ok(path.some((p) => p.activityId === 'fix-the-broken-sauce'));
    assert.ok(path.some((p) => p.activityId === 'explain-without-the-recipe'));
    assert.ok(path.some((p) => p.activityId === 'pan-sauce-anatomy'));
  }
});
