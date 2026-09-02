/**
 * The one tag install (contract section 21), tested in Node.
 *
 * `shared/provider-embed.js` keeps its browser half behind a `document` guard,
 * so importing it here registers no tools, touches no network and reads no
 * storage. Everything below is the pure half: the manifest parser, the
 * deterministic grader, the personalisation rules and the self certifying
 * receipt payload.
 *
 * The manifest under test is the one in the contract and in
 * `apps/blog/public/index.html`, read from the blog page itself so the two can
 * never drift apart.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import {
  parseManifest,
  gradeQuiz,
  gradeExposure,
  personalize,
  selfReceiptInput,
  buildConditions,
  selfKeyId,
  EVIDENCE_TYPES,
  PROTOCOL
} from '../shared/provider-embed.js';

import {
  buildReceiptPayload,
  signToken,
  decodeToken,
  verifyToken,
  isSelfCertified
} from '../shared/protocol.js';
import { generateKeyPair, verify, randomId } from '../shared/crypto.js';

const BLOG_ORIGIN = 'http://localhost:8785';

/** The manifest exactly as the blog ships it, straight out of the page. */
function manifestSourceFromBlog() {
  const path = fileURLToPath(new URL('../apps/blog/public/index.html', import.meta.url));
  const html = readFileSync(path, 'utf8');
  const opening = html.indexOf('<script type="application/nema+json">');
  assert.notEqual(opening, -1, 'the blog page must carry a nema manifest');
  const start = html.indexOf('>', opening) + 1;
  const end = html.indexOf('</script>', start);
  return html.slice(start, end);
}

const SOURCE = manifestSourceFromBlog();

function parsed() {
  return parseManifest(SOURCE, { origin: BLOG_ORIGIN });
}

// ---------------------------------------------------------------------------
// manifest parsing
// ---------------------------------------------------------------------------

test('the blog manifest parses into a LearningManifest for this origin', () => {
  const { manifest } = parsed();

  assert.equal(manifest.protocol, PROTOCOL);
  assert.equal(manifest.provider.origin, BLOG_ORIGIN);
  assert.equal(manifest.provider.name, 'Maillard, explained');
  assert.equal(manifest.provider.keyId, 'self:http://localhost:8785');
  assert.equal(manifest.unit.id, 'maillard-explained');
  assert.equal(manifest.unit.title, 'Why browning tastes like that');
  assert.equal(manifest.unit.estimatedMinutes, 8);
  assert.equal(manifest.unit.version, '1.0.0');
  assert.equal(manifest.unit.language, 'en');
  assert.equal(manifest.unit.price, 'free');
  assert.deepEqual(manifest.requirements, [{ concept: 'nema:heat-control', ability: 'explain' }]);

  const ids = manifest.activities.map((activity) => activity.id);
  assert.deepEqual(ids, ['read', 'check']);

  const [lesson, quiz] = manifest.activities;
  assert.equal(lesson.type, 'lesson');
  assert.equal(lesson.grader, 'exposure');
  assert.equal(lesson.evidenceProduced, 'recognition');
  assert.equal(lesson.minutes, 6);
  assert.equal(quiz.type, 'quiz');
  assert.equal(quiz.grader, 'deterministic');
  assert.equal(quiz.evidenceProduced, 'explanation');
  assert.equal(quiz.minutes, 2);

  assert.deepEqual(manifest.outcomes, [
    { concept: 'nema:maillard-reaction', ability: 'recognize' },
    { concept: 'nema:maillard-reaction', ability: 'explain' },
    { concept: 'nema:caramelization', ability: 'discriminate' }
  ]);
});

test('the manifest an agent reads carries no questions and no answer key', () => {
  const { manifest, activities } = parsed();
  const serialized = JSON.stringify(manifest);
  assert.equal(serialized.includes('"questions"'), false);
  assert.equal(serialized.includes('"answer"'), false);
  for (const activity of manifest.activities) {
    assert.equal(activity.questions, undefined);
  }
  // The page itself still has them, that is how it grades.
  assert.equal(activities.check.questions.length, 2);
  assert.equal(activities.check.questions[0].answer, 'a');
  assert.equal(activities.check.questions[1].answer, 'b');
});

test('the two quiz questions each have exactly one right answer', () => {
  const { activities } = parsed();
  for (const question of activities.check.questions) {
    assert.ok(question.options.length >= 2);
    const matches = question.options.filter((option) => option.id === question.answer);
    assert.equal(matches.length, 1, `${question.id} must have one answer among its options`);
  }
});

test('a broken manifest is reported, not swallowed', () => {
  assert.throws(() => parseManifest('{ not json', { origin: BLOG_ORIGIN }), /not valid JSON/);
  assert.throws(() => parseManifest('{}', { origin: BLOG_ORIGIN }), /unit must be an object/);
  assert.throws(
    () =>
      parseManifest(
        JSON.stringify({
          unit: { id: 'u', title: 't' },
          activities: [{ id: 'check', type: 'quiz', title: 'q', minutes: 1 }]
        }),
        { origin: BLOG_ORIGIN }
      ),
    /quiz with no questions/
  );
  assert.throws(
    () =>
      parseManifest(
        JSON.stringify({
          unit: { id: 'u', title: 't' },
          activities: [
            {
              id: 'check',
              type: 'quiz',
              title: 'q',
              minutes: 1,
              questions: [
                { id: 'q1', prompt: 'p', options: [{ id: 'a', text: 'a' }, { id: 'b', text: 'b' }], answer: 'z' }
              ]
            }
          ]
        }),
        { origin: BLOG_ORIGIN }
      ),
    /answer is not one of the options/
  );
});

// ---------------------------------------------------------------------------
// grading
// ---------------------------------------------------------------------------

test('the quiz grades deterministically: both right passes', () => {
  const { activities } = parsed();
  const grading = gradeQuiz(activities.check, { answers: { q1: 'a', q2: 'b' } });

  assert.equal(grading.result, 'passed');
  assert.equal(grading.score, 1);
  assert.equal(grading.correct, 2);
  assert.equal(grading.total, 2);
  assert.equal(grading.feedback.length, 2);
  assert.match(grading.feedback[0], /^Question 1: correct\./);
  assert.deepEqual(grading.claims, [
    {
      concept: 'nema:maillard-reaction',
      ability: 'explain',
      evidenceType: 'explanation',
      result: 'passed',
      difficulty: 'introductory'
    },
    {
      concept: 'nema:caramelization',
      ability: 'discriminate',
      evidenceType: 'discrimination',
      result: 'passed',
      difficulty: 'introductory'
    }
  ]);
});

test('one right is partial, none right is failed, and the claims say so', () => {
  const { activities } = parsed();

  const partial = gradeQuiz(activities.check, { answers: { q1: 'a', q2: 'd' } });
  assert.equal(partial.result, 'partial');
  assert.equal(partial.score, 0.5);
  assert.match(partial.feedback[1], /^Question 2: not right\./);
  assert.ok(partial.claims.every((claim) => claim.result === 'partial'));

  const failed = gradeQuiz(activities.check, { answers: { q1: 'c', q2: 'a' } });
  assert.equal(failed.result, 'failed');
  assert.equal(failed.score, 0);
  assert.ok(failed.claims.every((claim) => claim.result === 'failed'));

  const empty = gradeQuiz(activities.check, {});
  assert.equal(empty.result, 'failed');
  assert.match(empty.feedback[0], /^Question 1: no answer\./);
});

test('grading is a pure function of the submission', () => {
  const { activities } = parsed();
  const once = gradeQuiz(activities.check, { answers: { q1: 'a', q2: 'b' } });
  const twice = gradeQuiz(activities.check, { answers: { q1: 'a', q2: 'b' } });
  assert.deepEqual(once, twice);
});

test('Mark as read is exposure evidence and nothing more', () => {
  const { activities } = parsed();
  const grading = gradeExposure(activities.read);
  assert.equal(grading.result, 'passed');
  assert.deepEqual(grading.claims, [
    {
      concept: 'nema:maillard-reaction',
      ability: 'recognize',
      evidenceType: 'recognition',
      result: 'passed',
      difficulty: 'introductory'
    }
  ]);
  assert.equal(activities.read.grader, 'exposure');
  assert.equal(EVIDENCE_TYPES.recognize, 'recognition');
});

// ---------------------------------------------------------------------------
// personalisation
// ---------------------------------------------------------------------------

const ASSERTION_FOR_A_READER_WHO_KNOWS_IT = {
  type: 'readiness-assertion',
  protocol: PROTOCOL,
  audience: BLOG_ORIGIN,
  purpose: 'personalize-maillard-explained',
  requestHash: 'sha256:0',
  learnerKeyId: 'lk_abcdefgh12345678',
  assertions: [
    { concept: 'nema:heat-control', ability: 'explain', status: 'verified', confidence: 'high' },
    { concept: 'nema:maillard-reaction', ability: 'recognize', status: 'verified', confidence: 'high' }
  ],
  issuedAt: '2026-09-02T10:00:00Z',
  expiresAt: '2026-09-02T10:30:00Z',
  vaultKey: { kty: 'EC', crv: 'P-256', x: 'x', y: 'y' }
};

test('an assertion that recognises the concept skips the article', () => {
  const { manifest } = parsed();
  const result = personalize(manifest, ASSERTION_FOR_A_READER_WHO_KNOWS_IT);

  assert.deepEqual(result.requirements, [
    { concept: 'nema:heat-control', ability: 'explain', status: 'verified' }
  ]);
  assert.equal(result.fullMinutes, 8);
  assert.equal(result.personalMinutes, 2);
  assert.deepEqual(result.path.map((entry) => entry.activityId), ['check']);
  assert.equal(result.path[0].reason, 'Always in the path');
  assert.deepEqual(result.skipped.map((entry) => entry.activityId), ['read']);
  assert.match(result.skipped[0].reason, /nema:maillard-reaction\.recognize/);
});

test('a reader the vault knows nothing about keeps the whole path', () => {
  const { manifest } = parsed();
  const empty = { ...ASSERTION_FOR_A_READER_WHO_KNOWS_IT, assertions: [] };
  const result = personalize(manifest, empty);

  assert.deepEqual(result.path.map((entry) => entry.activityId), ['read', 'check']);
  assert.deepEqual(result.skipped, []);
  assert.equal(result.personalMinutes, 8);
  assert.equal(result.fullMinutes, 8);
  assert.deepEqual(result.requirements, [
    { concept: 'nema:heat-control', ability: 'explain', status: 'missing' }
  ]);
  assert.match(result.path[0].reason, /^Not yet verified: nema:maillard-reaction\.recognize$/);
});

test('an uncertain band does not satisfy a skipIf that asks for verified', () => {
  const { manifest } = parsed();
  const uncertain = {
    ...ASSERTION_FOR_A_READER_WHO_KNOWS_IT,
    assertions: [
      { concept: 'nema:maillard-reaction', ability: 'recognize', status: 'uncertain', confidence: 'low' }
    ]
  };
  const result = personalize(manifest, uncertain);
  assert.deepEqual(result.path.map((entry) => entry.activityId), ['read', 'check']);
});

// ---------------------------------------------------------------------------
// the self certifying receipt
// ---------------------------------------------------------------------------

test('the receipt payload has the EvidenceReceipt shape plus issuerKey', async () => {
  const { activities } = parsed();
  const { publicJwk } = await generateKeyPair();
  const grading = gradeQuiz(activities.check, { answers: { q1: 'a', q2: 'b' } });
  const attempt = { attempts: 1, hintsUsed: 0, durationSeconds: 41.6 };

  // The embed builds its receipts exactly like a hosted provider: the same
  // builder from shared/protocol.js, with the self certifying fields filled in.
  const payload = buildReceiptPayload(
    selfReceiptInput({
      origin: BLOG_ORIGIN,
      issuerKey: publicJwk,
      subject: 'anonymous',
      activity: { ...activities.check, contentHash: 'sha256:deadbeef' },
      grading,
      attempt,
      now: '2026-09-02T10:41:12Z',
      receiptId: 'rcpt_test12345678'
    })
  );

  assert.deepEqual(Object.keys(payload), [
    'type',
    'protocol',
    'receiptId',
    'issuer',
    'keyId',
    'issuerKey',
    'subject',
    'activity',
    'claims',
    'conditions',
    'issuedAt'
  ]);
  assert.equal(payload.type, 'evidence-receipt');
  assert.equal(payload.protocol, PROTOCOL);
  assert.equal(payload.issuer, BLOG_ORIGIN);
  assert.equal(payload.keyId, 'self:http://localhost:8785');
  assert.equal(payload.keyId, selfKeyId(BLOG_ORIGIN));
  assert.deepEqual(payload.issuerKey, publicJwk);
  assert.equal(isSelfCertified(payload), true);
  assert.equal(payload.subject, 'anonymous');
  assert.deepEqual(payload.activity, {
    id: 'check',
    version: '1.0.0',
    title: 'Two questions before you go',
    contentHash: 'sha256:deadbeef'
  });
  assert.deepEqual(payload.claims, grading.claims);
  assert.deepEqual(payload.conditions, {
    attempts: 1,
    hintsUsed: 0,
    durationSeconds: 42,
    grader: 'deterministic',
    graderVersion: '1'
  });
  assert.equal(payload.issuedAt, '2026-09-02T10:41:12Z');
});

test('a lesson receipt says exposure, and the whole page is one graderVersion', () => {
  const { activities } = parsed();
  const conditions = buildConditions(activities.read, { attempts: 1, hintsUsed: 0, durationSeconds: 12 });
  assert.deepEqual(conditions, {
    attempts: 1,
    hintsUsed: 0,
    durationSeconds: 12,
    grader: 'exposure',
    graderVersion: '1'
  });
});

test('the subject is the presented learnerKeyId, or anonymous', async () => {
  const { activities } = parsed();
  const { publicJwk } = await generateKeyPair();
  const base = {
    origin: BLOG_ORIGIN,
    issuerKey: publicJwk,
    activity: activities.read,
    grading: gradeExposure(activities.read),
    attempt: { attempts: 1, hintsUsed: 0, durationSeconds: 12 },
    now: '2026-09-02T10:00:00Z',
    receiptId: 'rcpt_test12345678'
  };
  assert.equal(buildReceiptPayload(selfReceiptInput({ ...base, subject: 'anonymous' })).subject, 'anonymous');
  assert.equal(
    buildReceiptPayload(
      selfReceiptInput({ ...base, subject: ASSERTION_FOR_A_READER_WHO_KNOWS_IT.learnerKeyId })
    ).subject,
    'lk_abcdefgh12345678'
  );
});

test('a receipt signed with the per origin key verifies against its own issuerKey', async () => {
  const { activities } = parsed();
  const { publicJwk, privateJwk } = await generateKeyPair();
  const grading = gradeQuiz(activities.check, { answers: { q1: 'a', q2: 'b' } });

  const payload = buildReceiptPayload(
    selfReceiptInput({
      origin: BLOG_ORIGIN,
      issuerKey: publicJwk,
      subject: 'anonymous',
      activity: activities.check,
      grading,
      attempt: { attempts: 1, hintsUsed: 0, durationSeconds: 30 },
      now: '2026-09-02T10:41:12Z',
      receiptId: randomId('rcpt')
    })
  );

  const token = await signToken(payload, privateJwk);
  assert.match(token, /^nema1\./);

  // What a vault does with a receipt from an issuer it has never heard of:
  // read the key out of the payload and check the bytes that travelled.
  const decoded = decodeToken(token);
  assert.equal(decoded.payload.keyId, 'self:http://localhost:8785');
  assert.equal(await verify(decoded.payload.issuerKey, decoded.payloadString, decoded.signature), true);
  assert.equal((await verifyToken(token, decoded.payload.issuerKey)).ok, true);

  // A different key must not verify it.
  const other = await generateKeyPair();
  assert.equal(await verify(other.publicJwk, decoded.payloadString, decoded.signature), false);

  // And one flipped character in the payload breaks it.
  const tampered = token.replace(/\.([A-Za-z0-9_-])/, (match, first) => `.${first === 'e' ? 'f' : 'e'}`);
  assert.equal((await verifyToken(tampered, decoded.payload.issuerKey)).ok, false);
});

test('importing the embed in Node registers nothing', async () => {
  const module = await import('../shared/provider-embed.js');
  assert.equal(typeof module.parseManifest, 'function');
  assert.equal(typeof globalThis.document, 'undefined');
  assert.equal(typeof globalThis.window, 'undefined');
});
