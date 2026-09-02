// Tests for shared/protocol.js. Run with: node --test test/protocol.test.js

import test from 'node:test';
import assert from 'node:assert/strict';

import { b64url, generateKeyPair, sha256 } from '../shared/crypto.js';
import {
  PROTOCOL,
  TOKEN_PREFIX,
  ASSERTION_TYPE,
  RECEIPT_TYPE,
  ALLOWED_ASSERTION_KEYS,
  SEED_ORIGIN,
  assertShape,
  encodeToken,
  decodeToken,
  signToken,
  verifyToken,
  buildReadinessRequest,
  requestHash,
  learnerKeyId,
  buildAssertionPayload,
  verifyAssertion,
  inspectAssertion,
  buildReceiptPayload,
  verifyReceipt,
  isSelfCertified,
  matchesPublishedKey,
  SELF_KEY_PREFIX,
  ISSUER_WELL_KNOWN_PATH,
  TRUST_TIERS,
  buildIssuerMap,
  loadIssuers,
  isToken
} from '../shared/protocol.js';

const HARNESS = 'https://saucier.migarci2.dev';
const SECURITY = 'https://linecook.migarci2.dev';
const NOW = '2026-09-02T10:00:00Z';

const ORIGINS = {
  site: 'https://nema.migarci2.dev',
  vault: 'https://nema-vault.migarci2.dev',
  harness: HARNESS,
  security: SECURITY,
  coach: 'https://nema-coach.migarci2.dev'
};

function minutesAfter(iso, minutes) {
  return new Date(new Date(iso).getTime() + minutes * 60 * 1000).toISOString();
}

function sampleRequest(audience = HARNESS) {
  return buildReadinessRequest({
    audience,
    purpose: 'personalize-pan-sauces-path',
    requirements: [
      { concept: 'nema:knife-skills', ability: 'apply' },
      { concept: 'nema:heat-control', ability: 'explain' }
    ]
  });
}

const SAMPLE_STATUSES = [
  {
    concept: 'nema:knife-skills',
    ability: 'apply',
    status: 'verified',
    confidence: 'high'
  },
  { concept: 'nema:heat-control', ability: 'explain', status: 'uncertain', confidence: 'low' }
];

async function issueAssertion(overrides = {}) {
  const vault = overrides.vault || (await generateKeyPair());
  const request = overrides.request || sampleRequest(overrides.audience);
  const payload = await buildAssertionPayload({
    request,
    statuses: overrides.statuses || SAMPLE_STATUSES,
    vaultPublicJwk: vault.publicJwk,
    now: overrides.now || NOW,
    ttlMinutes: overrides.ttlMinutes
  });
  const token = await signToken(payload, vault.privateJwk);
  return { vault, request, payload, token };
}

function sampleReceiptInput(overrides = {}) {
  return {
    issuer: HARNESS,
    keyId: 'saucier-2026-09',
    subject: 'lk_5NIcERfrWDlOO6bR',
    activity: {
      id: 'eval-design-lab',
      version: '1.0.0',
      title: 'Fix the broken harness',
      contentHash: 'sha256:0000000000000000000000000000000000000000000000000000000000000000'
    },
    claims: [
      {
        concept: 'nema:pan-sauces',
        ability: 'apply',
        evidenceType: 'application',
        result: 'passed',
        difficulty: 'intermediate'
      }
    ],
    conditions: {
      attempts: 2,
      hintsUsed: 1,
      durationSeconds: 641,
      grader: 'deterministic',
      graderVersion: '1'
    },
    now: NOW,
    receiptId: 'rcpt_test_001',
    ...overrides
  };
}

// ---------------------------------------------------------------------------
// tokens
// ---------------------------------------------------------------------------

test('encodeToken and decodeToken roundtrip without re-serializing', () => {
  const payload = { type: RECEIPT_TYPE, protocol: PROTOCOL, receiptId: 'rcpt_1' };
  const token = encodeToken(payload, 'c2ln');

  const parts = token.split('.');
  assert.equal(parts.length, 3);
  assert.equal(parts[0], TOKEN_PREFIX);
  assert.equal(parts[2], 'c2ln');
  assert.ok(isToken(token));

  const decoded = decodeToken(token);
  assert.deepEqual(decoded.payload, payload);
  assert.equal(decoded.payloadString, JSON.stringify(payload));
  assert.equal(decoded.signature, 'c2ln');
});

test('decodeToken preserves the exact payload string, whitespace included', () => {
  // A producer that formats its JSON differently still verifies, because the
  // decoded string is what gets checked, not a fresh JSON.stringify of the
  // parsed object.
  const payloadString = '{ "protocol": "nema/0.1", "type": "evidence-receipt" }';
  const token = `${TOKEN_PREFIX}.${b64url.encode(payloadString)}.c2ln`;
  const decoded = decodeToken(token);
  assert.equal(decoded.payloadString, payloadString);
  assert.notEqual(JSON.stringify(decoded.payload), payloadString);
  assert.equal(decoded.payload.protocol, PROTOCOL);
});

test('decodeToken throws on malformed tokens', () => {
  assert.throws(() => decodeToken('nope'), /three parts/);
  assert.throws(() => decodeToken('jwt.aaa.bbb'), /unknown token prefix/);
  assert.throws(() => decodeToken(`${TOKEN_PREFIX}..bbb`), /empty part/);
  assert.throws(() => decodeToken(`${TOKEN_PREFIX}.${b64url.encode('[1,2]')}.bbb`), /object/);
  assert.throws(() => decodeToken(null), /string/);
});

test('signToken and verifyToken roundtrip, and a tampered token fails', async () => {
  const { publicJwk, privateJwk } = await generateKeyPair();
  const payload = { type: RECEIPT_TYPE, protocol: PROTOCOL, receiptId: 'rcpt_1' };
  const token = await signToken(payload, privateJwk);

  const good = await verifyToken(token, publicJwk);
  assert.equal(good.ok, true);
  assert.deepEqual(good.payload, payload);

  const [prefix, , signature] = token.split('.');
  const forged = `${prefix}.${b64url.encode(
    JSON.stringify({ ...payload, receiptId: 'rcpt_2' })
  )}.${signature}`;
  const bad = await verifyToken(forged, publicJwk);
  assert.equal(bad.ok, false);
  assert.equal(bad.reason, 'bad-signature');

  const broken = await verifyToken('nema1.not-a-token', publicJwk);
  assert.equal(broken.ok, false);
  assert.equal(broken.reason, 'malformed');
});

// ---------------------------------------------------------------------------
// requests and learner ids
// ---------------------------------------------------------------------------

test('buildReadinessRequest normalizes and requestHash is stable', async () => {
  const request = sampleRequest();
  assert.deepEqual(Object.keys(request), ['protocol', 'audience', 'purpose', 'requirements']);
  assert.deepEqual(request.requirements[0], {
    concept: 'nema:knife-skills',
    ability: 'apply'
  });

  const hash = await requestHash(request);
  assert.match(hash, /^sha256:[0-9a-f]{64}$/);
  assert.equal(hash, await sha256(JSON.stringify(request)));
  assert.equal(hash, await requestHash(sampleRequest()));
  assert.notEqual(hash, await requestHash(sampleRequest(SECURITY)));
});

test('learnerKeyId differs per audience and is stable per audience', async () => {
  const { publicJwk } = await generateKeyPair();

  const forHarness = await learnerKeyId(publicJwk, HARNESS);
  const forSecurity = await learnerKeyId(publicJwk, SECURITY);

  assert.match(forHarness, /^lk_[A-Za-z0-9_-]{16}$/);
  assert.match(forSecurity, /^lk_[A-Za-z0-9_-]{16}$/);
  assert.notEqual(forHarness, forSecurity);
  assert.equal(forHarness, await learnerKeyId(publicJwk, HARNESS));

  // Another vault never collides with this one for the same audience.
  const other = await generateKeyPair();
  assert.notEqual(forHarness, await learnerKeyId(other.publicJwk, HARNESS));

  // Only the public coordinates are used, so a provider can recompute nothing.
  assert.equal(forHarness, await learnerKeyId({ kty: 'EC', crv: 'P-256', x: publicJwk.x, y: publicJwk.y }, HARNESS));
});

// ---------------------------------------------------------------------------
// assertions
// ---------------------------------------------------------------------------

test('an assertion carries only the allowed keys and nothing about history', async () => {
  const { payload, request, vault } = await issueAssertion();

  assert.deepEqual(Object.keys(payload), [...ALLOWED_ASSERTION_KEYS]);
  for (const key of Object.keys(payload)) {
    assert.ok(ALLOWED_ASSERTION_KEYS.includes(key), `unexpected key: ${key}`);
  }

  assert.equal(payload.type, ASSERTION_TYPE);
  assert.equal(payload.protocol, PROTOCOL);
  assert.equal(payload.audience, HARNESS);
  assert.equal(payload.requestHash, await requestHash(request));
  assert.equal(payload.learnerKeyId, await learnerKeyId(vault.publicJwk, HARNESS));
  assert.equal(payload.issuedAt, NOW);
  assert.equal(payload.expiresAt, minutesAfter(NOW, 30).replace(/\.\d{3}Z$/, 'Z'));
  assert.deepEqual(Object.keys(payload.vaultKey), ['kty', 'crv', 'x', 'y']);
  assert.equal(payload.vaultKey.d, undefined);

  for (const entry of payload.assertions) {
    assert.deepEqual(Object.keys(entry), ['concept', 'ability', 'status', 'confidence']);
  }

  // The serialized token mentions no evidence, no score and no receipt.
  const serialized = JSON.stringify(payload);
  for (const forbidden of ['receipt', 'score', 'attempts', 'grader', 'lastSuccess', 'history']) {
    assert.ok(!serialized.includes(forbidden), `assertion leaks ${forbidden}`);
  }
});

test('a valid assertion verifies for its audience', async () => {
  const { token, payload } = await issueAssertion();
  const result = await verifyAssertion(token, { audience: HARNESS, now: NOW });
  assert.equal(result.ok, true);
  assert.equal(result.reason, undefined);
  assert.deepEqual(result.payload, payload);
});

test('an assertion for another audience is rejected', async () => {
  const { token } = await issueAssertion();
  const result = await verifyAssertion(token, { audience: SECURITY, now: NOW });
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'wrong-audience');
});

test('verifyAssertion without an audience throws instead of accepting', async () => {
  const { token } = await issueAssertion();

  // A provider that cannot name its own origin, for example a Worker where
  // location is undefined, must fail loudly rather than accept every token.
  await assert.rejects(() => verifyAssertion(token, { now: NOW }), TypeError);
  await assert.rejects(() => verifyAssertion(token, { audience: undefined, now: NOW }), TypeError);
  await assert.rejects(() => verifyAssertion(token, { audience: '', now: NOW }), TypeError);
  await assert.rejects(() => verifyAssertion(token, { audience: null, now: NOW }), TypeError);
  await assert.rejects(() => verifyAssertion(token), TypeError);

  // The waiver is explicit, and it still checks signature, shape and expiry.
  const waived = await verifyAssertion(token, { skipAudience: true, now: NOW });
  assert.equal(waived.ok, true);
});

test('inspectAssertion reads a token that is addressed to someone else', async () => {
  const { token, payload } = await issueAssertion();

  const read = await inspectAssertion(token, { now: NOW });
  assert.equal(read.ok, true);
  assert.deepEqual(read.payload, payload);

  // It is not a way around expiry or a bad signature.
  const expired = await inspectAssertion(token, { now: minutesAfter(NOW, 31) });
  assert.equal(expired.ok, false);
  assert.equal(expired.reason, 'expired');

  const mallory = await generateKeyPair();
  const impersonated = await inspectAssertion(await signToken(payload, mallory.privateJwk), {
    now: NOW
  });
  assert.equal(impersonated.ok, false);
  assert.equal(impersonated.reason, 'bad-signature');
});

test('an assertion never discloses a concept the request did not ask about', async () => {
  const vault = await generateKeyPair();
  const request = sampleRequest();

  await assert.rejects(
    () =>
      buildAssertionPayload({
        request,
        statuses: [
          ...SAMPLE_STATUSES,
          {
            concept: 'nema:prompt-injection',
            ability: 'apply',
            status: 'verified',
            confidence: 'high'
          }
        ],
        vaultPublicJwk: vault.publicJwk,
        now: NOW
      }),
    /did not ask about/
  );

  // The same concept at an ability that was not requested is refused too.
  await assert.rejects(
    () =>
      buildAssertionPayload({
        request,
        statuses: [
          { concept: 'nema:knife-skills', ability: 'transfer', status: 'verified', confidence: 'high' }
        ],
        vaultPublicJwk: vault.publicJwk,
        now: NOW
      }),
    /did not ask about/
  );

  // Answering with fewer entries than were asked about is always allowed.
  const partial = await buildAssertionPayload({
    request,
    statuses: [SAMPLE_STATUSES[0]],
    vaultPublicJwk: vault.publicJwk,
    now: NOW
  });
  assert.equal(partial.assertions.length, 1);
});

test('an expired assertion is rejected', async () => {
  const { token } = await issueAssertion({ ttlMinutes: 30 });

  const justInside = await verifyAssertion(token, {
    audience: HARNESS,
    now: minutesAfter(NOW, 29)
  });
  assert.equal(justInside.ok, true);

  const expired = await verifyAssertion(token, { audience: HARNESS, now: minutesAfter(NOW, 31) });
  assert.equal(expired.ok, false);
  assert.equal(expired.reason, 'expired');

  // Exactly at the expiry instant the token is already dead.
  const atExpiry = await verifyAssertion(token, { audience: HARNESS, now: minutesAfter(NOW, 30) });
  assert.equal(atExpiry.ok, false);
  assert.equal(atExpiry.reason, 'expired');
});

test('a re-signed or tampered assertion is rejected', async () => {
  const { token, payload } = await issueAssertion();

  // Someone widens the status bands but keeps the original signature.
  const forgedPayload = {
    ...payload,
    assertions: payload.assertions.map((entry) => ({ ...entry, status: 'verified' }))
  };
  const [, , signature] = token.split('.');
  const forged = `${TOKEN_PREFIX}.${b64url.encode(JSON.stringify(forgedPayload))}.${signature}`;

  const result = await verifyAssertion(forged, { audience: HARNESS, now: NOW });
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'bad-signature');

  // Someone signs a valid looking assertion with their own key but leaves the
  // vault key in place. Self-certifying means the embedded key must match.
  const mallory = await generateKeyPair();
  const mallorysToken = await signToken(payload, mallory.privateJwk);
  const impersonated = await verifyAssertion(mallorysToken, { audience: HARNESS, now: NOW });
  assert.equal(impersonated.ok, false);
  assert.equal(impersonated.reason, 'bad-signature');
});

test('an assertion with an extra key is malformed', async () => {
  const vault = await generateKeyPair();
  const { payload } = await issueAssertion({ vault });
  const token = await signToken({ ...payload, receipts: ['rcpt_1'] }, vault.privateJwk);

  const result = await verifyAssertion(token, { audience: HARNESS, now: NOW });
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'malformed');
});

test('a receipt presented as an assertion is malformed', async () => {
  const { publicJwk, privateJwk } = await generateKeyPair();
  const payload = buildReceiptPayload(sampleReceiptInput());
  const token = await signToken(payload, privateJwk);

  const result = await verifyAssertion(token, { audience: HARNESS, now: NOW });
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'malformed');
  assert.equal((await verifyToken(token, publicJwk)).ok, true);
});

// ---------------------------------------------------------------------------
// receipts
// ---------------------------------------------------------------------------

test('a receipt payload has the documented shape', () => {
  const payload = buildReceiptPayload(sampleReceiptInput());
  assert.deepEqual(Object.keys(payload), [
    'type',
    'protocol',
    'receiptId',
    'issuer',
    'keyId',
    'subject',
    'activity',
    'claims',
    'conditions',
    'issuedAt'
  ]);
  assert.equal(payload.type, RECEIPT_TYPE);
  assert.equal(payload.issuedAt, NOW);
  assert.equal(payload.receiptId, 'rcpt_test_001');

  // Without an explicit id the builder mints one.
  const minted = buildReceiptPayload(sampleReceiptInput({ receiptId: undefined }));
  assert.match(minted.receiptId, /^rcpt_[A-Za-z0-9_-]{12}$/);

  assert.throws(() => buildReceiptPayload(sampleReceiptInput({ claims: [] })), /non-empty/);
  assert.throws(() => buildReceiptPayload(sampleReceiptInput({ issuer: '' })), /issuer/);
});

test('a receipt from a known issuer verifies', async () => {
  const harness = await generateKeyPair();
  const issuers = {
    'saucier-2026-09': { origin: HARNESS, jwk: harness.publicJwk, name: 'Saucier School', id: 'harness' }
  };
  const token = await signToken(buildReceiptPayload(sampleReceiptInput()), harness.privateJwk);

  const result = await verifyReceipt(token, issuers, { seenReceiptIds: new Set() });
  assert.equal(result.ok, true);
  assert.equal(result.payload.receiptId, 'rcpt_test_001');
  assert.equal(result.issuer.name, 'Saucier School');
});

test('a receipt from an unknown issuer is not accepted', async () => {
  const stranger = await generateKeyPair();
  const harness = await generateKeyPair();
  const issuers = {
    'saucier-2026-09': { origin: HARNESS, jwk: harness.publicJwk, name: 'Saucier School' }
  };

  const unknownKeyId = await signToken(
    buildReceiptPayload(sampleReceiptInput({ keyId: 'nobody-2026-09', issuer: 'https://evil.example' })),
    stranger.privateJwk
  );
  const byKeyId = await verifyReceipt(unknownKeyId, issuers);
  assert.equal(byKeyId.ok, false);
  assert.equal(byKeyId.reason, 'unknown-issuer');

  // A known keyId claiming a different origin is just as unknown.
  const wrongOrigin = await signToken(
    buildReceiptPayload(sampleReceiptInput({ issuer: 'https://evil.example' })),
    harness.privateJwk
  );
  const byOrigin = await verifyReceipt(wrongOrigin, issuers);
  assert.equal(byOrigin.ok, false);
  assert.equal(byOrigin.reason, 'unknown-issuer');
});

test('a receipt signed by the wrong key is rejected', async () => {
  const harness = await generateKeyPair();
  const mallory = await generateKeyPair();
  const issuers = { 'saucier-2026-09': { origin: HARNESS, jwk: harness.publicJwk } };

  const token = await signToken(buildReceiptPayload(sampleReceiptInput()), mallory.privateJwk);
  const result = await verifyReceipt(token, issuers);
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'bad-signature');
});

test('a duplicate receipt is rejected', async () => {
  const harness = await generateKeyPair();
  const issuers = { 'saucier-2026-09': { origin: HARNESS, jwk: harness.publicJwk } };
  const token = await signToken(buildReceiptPayload(sampleReceiptInput()), harness.privateJwk);

  const seenReceiptIds = new Set();
  const first = await verifyReceipt(token, issuers, { seenReceiptIds });
  assert.equal(first.ok, true);
  seenReceiptIds.add(first.payload.receiptId);

  const second = await verifyReceipt(token, issuers, { seenReceiptIds });
  assert.equal(second.ok, false);
  assert.equal(second.reason, 'duplicate');

  // An array of ids works as well as a Set.
  const third = await verifyReceipt(token, issuers, { seenReceiptIds: ['rcpt_test_001'] });
  assert.equal(third.ok, false);
  assert.equal(third.reason, 'duplicate');
});

test('a malformed receipt is reported as malformed, never as unknown-issuer', async () => {
  const harness = await generateKeyPair();
  const issuers = { 'saucier-2026-09': { origin: HARNESS, jwk: harness.publicJwk } };

  const extraKey = await signToken(
    { ...buildReceiptPayload(sampleReceiptInput()), learnerEmail: 'nobody@example.com' },
    harness.privateJwk
  );
  const result = await verifyReceipt(extraKey, issuers);
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'malformed');

  const garbage = await verifyReceipt('not a token at all', issuers);
  assert.equal(garbage.ok, false);
  assert.equal(garbage.reason, 'malformed');
});

// ---------------------------------------------------------------------------
// shape validation and the issuer registry
// ---------------------------------------------------------------------------

test('assertShape rejects unknown keys, missing keys and wrong types', () => {
  const receipt = buildReceiptPayload(sampleReceiptInput());
  assert.equal(assertShape(receipt, RECEIPT_TYPE), receipt);

  assert.throws(() => assertShape({ ...receipt, mastery: 1 }, RECEIPT_TYPE), /unexpected key/);
  assert.throws(() => assertShape({ ...receipt, subject: undefined }, RECEIPT_TYPE), /missing key/);
  assert.throws(() => assertShape({ ...receipt, protocol: 'nema/9' }, RECEIPT_TYPE), /protocol/);
  assert.throws(() => assertShape(receipt, ASSERTION_TYPE), /expected type/);
  assert.throws(() => assertShape(null, RECEIPT_TYPE), /object/);
  assert.throws(() => assertShape(receipt, 'something-else'), /unknown payload type/);
});

test('assertShape rejects scalars of the wrong type, not just missing keys', () => {
  const receipt = buildReceiptPayload(sampleReceiptInput());

  assert.throws(() => assertShape({ ...receipt, receiptId: { a: 1 } }, RECEIPT_TYPE), /receiptId/);
  assert.throws(() => assertShape({ ...receipt, subject: 5 }, RECEIPT_TYPE), /subject/);
  assert.throws(() => assertShape({ ...receipt, issuer: 5 }, RECEIPT_TYPE), /issuer/);
  assert.throws(() => assertShape({ ...receipt, keyId: [] }, RECEIPT_TYPE), /keyId/);
  assert.throws(() => assertShape({ ...receipt, issuedAt: 'nope' }, RECEIPT_TYPE), /issuedAt/);
  assert.throws(
    () => assertShape({ ...receipt, activity: { id: 1 } }, RECEIPT_TYPE),
    /activity\.id/
  );
  assert.throws(() => assertShape({ ...receipt, claims: [1] }, RECEIPT_TYPE), /claims\[0\]/);
  assert.throws(
    () => assertShape({ ...receipt, claims: [{ ...receipt.claims[0], result: 7 }] }, RECEIPT_TYPE),
    /claims\[0\]\.result/
  );
  assert.throws(
    () => assertShape({ ...receipt, conditions: 'two attempts' }, RECEIPT_TYPE),
    /conditions/
  );
});

test('assertShape rejects an assertion with wrongly typed fields', async () => {
  const { payload } = await issueAssertion();

  assert.throws(() => assertShape({ ...payload, audience: 7 }, ASSERTION_TYPE), /audience/);
  assert.throws(() => assertShape({ ...payload, purpose: {} }, ASSERTION_TYPE), /purpose/);
  assert.throws(() => assertShape({ ...payload, requestHash: 1 }, ASSERTION_TYPE), /requestHash/);
  assert.throws(() => assertShape({ ...payload, learnerKeyId: [] }, ASSERTION_TYPE), /learnerKeyId/);
  assert.throws(() => assertShape({ ...payload, expiresAt: 'soon' }, ASSERTION_TYPE), /expiresAt/);
  assert.throws(
    () => assertShape({ ...payload, assertions: ['nema:pan-sauces'] }, ASSERTION_TYPE),
    /assertions\[0\]/
  );
});

test('a receipt with wrongly typed fields is malformed, and never verifies', async () => {
  const harness = await generateKeyPair();
  const issuers = { 'saucier-2026-09': { origin: HARNESS, jwk: harness.publicJwk } };

  // Signed by the real key, so only the shape check can catch it. Without the
  // scalar checks the duplicate guard would end up comparing "[object Object]".
  const token = await signToken(
    { ...buildReceiptPayload(sampleReceiptInput()), receiptId: { a: 1 } },
    harness.privateJwk
  );
  const result = await verifyReceipt(token, issuers, { seenReceiptIds: new Set() });
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'malformed');
});

test('receipt conditions must be numbers, not anything Number() will swallow', () => {
  assert.throws(
    () =>
      buildReceiptPayload(
        sampleReceiptInput({ conditions: { attempts: 'two', grader: 'deterministic' } })
      ),
    /conditions\.attempts/
  );
  assert.throws(
    () => buildReceiptPayload(sampleReceiptInput({ conditions: { hintsUsed: null } })),
    /conditions\.hintsUsed/
  );
  assert.throws(
    () => buildReceiptPayload(sampleReceiptInput({ conditions: { durationSeconds: {} } })),
    /conditions\.durationSeconds/
  );

  // A numeric graderVersion is still written as the documented string.
  const payload = buildReceiptPayload(
    sampleReceiptInput({ conditions: { grader: 'deterministic', graderVersion: 1 } })
  );
  assert.equal(payload.conditions.graderVersion, '1');
});

test('buildIssuerMap joins issuers with origins and names', () => {
  const issuersJson = {
    harness: { kid: 'saucier-2026-09', jwk: { kty: 'EC', crv: 'P-256', x: 'x1', y: 'y1' } },
    security: { kid: 'linecook-2026-09', jwk: { kty: 'EC', crv: 'P-256', x: 'x2', y: 'y2' } },
    seed: { kid: 'seed-2026-09', jwk: { kty: 'EC', crv: 'P-256', x: 'x3', y: 'y3' } }
  };

  const map = buildIssuerMap(issuersJson, ORIGINS);
  assert.deepEqual(Object.keys(map).sort(), ['linecook-2026-09', 'saucier-2026-09', 'seed-2026-09']);
  assert.deepEqual(map['saucier-2026-09'], {
    origin: HARNESS,
    jwk: issuersJson.harness.jwk,
    name: 'Saucier School',
    id: 'harness'
  });
  assert.equal(map['linecook-2026-09'].name, 'Line Cook Lab');
  assert.equal(map['seed-2026-09'].origin, SEED_ORIGIN);
  assert.equal(map['seed-2026-09'].name, 'nema demo seed');

  // One malformed entry is skipped: it must not disable the other issuers.
  assert.deepEqual(buildIssuerMap({ broken: { kid: 'k' } }, ORIGINS), {});
  const partial = buildIssuerMap({ ...issuersJson, broken: { kid: 'k' } }, ORIGINS);
  assert.deepEqual(Object.keys(partial).sort(), ['linecook-2026-09', 'saucier-2026-09', 'seed-2026-09']);
});

test('an unusable issuer registry throws instead of silently trusting nobody', () => {
  // An empty map would turn every receipt, the seed ledger included, into
  // unknown-issuer with nothing thrown or logged. Misuse has to be loud.
  assert.throws(() => buildIssuerMap(null, ORIGINS), TypeError);
  assert.throws(() => buildIssuerMap(undefined, ORIGINS), TypeError);
  assert.throws(() => buildIssuerMap([], ORIGINS), TypeError);
  assert.throws(() => buildIssuerMap({}, null), TypeError);

  // Contract section 5.6 spells this loadIssuers(). Called that way, with no
  // arguments, it throws rather than returning an empty registry.
  assert.equal(loadIssuers, buildIssuerMap);
  assert.throws(() => loadIssuers(), TypeError);
});

test('the full handoff works end to end: assertion out, receipt back', async () => {
  const vault = await generateKeyPair();
  const harness = await generateKeyPair();
  const issuers = {
    'saucier-2026-09': { origin: HARNESS, jwk: harness.publicJwk, name: 'Saucier School' }
  };

  // 1. The provider asks, the vault answers with bands only.
  const request = sampleRequest();
  const assertionToken = await signToken(
    await buildAssertionPayload({
      request,
      statuses: SAMPLE_STATUSES,
      vaultPublicJwk: vault.publicJwk,
      now: NOW
    }),
    vault.privateJwk
  );

  // 2. The provider verifies it against its own origin.
  const checked = await verifyAssertion(assertionToken, { audience: HARNESS, now: NOW });
  assert.equal(checked.ok, true);
  const subject = checked.payload.learnerKeyId;

  // 3. The learner passes the lab and the provider signs a receipt for the
  //    same pseudonym it was given.
  const receiptToken = await signToken(
    buildReceiptPayload(
      sampleReceiptInput({ subject, receiptId: 'rcpt_handoff_001', now: minutesAfter(NOW, 25) })
    ),
    harness.privateJwk
  );

  // 4. The vault accepts it and can tie it back to its own key.
  const staged = await verifyReceipt(receiptToken, issuers, { seenReceiptIds: new Set() });
  assert.equal(staged.ok, true);
  assert.equal(staged.payload.subject, await learnerKeyId(vault.publicJwk, HARNESS));
  assert.equal(staged.payload.claims[0].concept, 'nema:pan-sauces');
});

// ---------------------------------------------------------------------------
// trust tiers: self certifying issuers (contract section 21)
// ---------------------------------------------------------------------------

const BLOG = 'https://maillard.migarci2.dev';

/** A receipt from a page that installed the one tag and signs with its own key. */
async function selfCertifiedReceipt(overrides = {}) {
  const key = overrides.key || (await generateKeyPair());
  const payload = buildReceiptPayload(
    sampleReceiptInput({
      issuer: BLOG,
      keyId: `${SELF_KEY_PREFIX}${BLOG}`,
      issuerKey: key.publicJwk,
      receiptId: 'rcpt_self_001',
      activity: { id: 'check', version: '1.0.0', title: 'Two questions before you go' },
      claims: [
        {
          concept: 'nema:maillard-reaction',
          ability: 'explain',
          evidenceType: 'explanation',
          result: 'passed'
        }
      ],
      ...overrides.payload
    })
  );
  return { key, payload, token: await signToken(payload, key.privateJwk) };
}

test('the trust tiers are the four the contract names', () => {
  assert.deepEqual(TRUST_TIERS, ['registered', 'origin', 'self', 'pending']);
  assert.equal(SELF_KEY_PREFIX, 'self:');
  assert.equal(ISSUER_WELL_KNOWN_PATH, '/.well-known/nema-issuer.json');
});

test('a receipt payload can carry the public key that signed it', async () => {
  const { key, payload } = await selfCertifiedReceipt();

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
  // Only the four public fields travel: a private key can never leak this way.
  assert.deepEqual(payload.issuerKey, {
    kty: 'EC',
    crv: 'P-256',
    x: key.publicJwk.x,
    y: key.publicJwk.y
  });
  assert.equal(isSelfCertified(payload), true);
  assert.throws(
    () => buildReceiptPayload(sampleReceiptInput({ issuerKey: { kty: 'RSA' } })),
    /issuerKey/
  );
});

test('assertShape accepts issuerKey and rejects one that is not a public JWK', async () => {
  const { payload } = await selfCertifiedReceipt();
  assert.equal(assertShape(payload, RECEIPT_TYPE), payload);

  // Optional: a registered issuer names a key the vault already holds.
  const registered = buildReceiptPayload(sampleReceiptInput());
  assert.equal(registered.issuerKey, undefined);
  assert.equal(assertShape(registered, RECEIPT_TYPE), registered);

  for (const broken of [{}, { kty: 'EC' }, { kty: 'EC', crv: 'P-256', x: 'x' }, 'a key', 7]) {
    assert.throws(() => assertShape({ ...payload, issuerKey: broken }, RECEIPT_TYPE), /issuerKey/);
  }
  // The private half is not a shape the protocol knows how to refuse, but it is
  // never produced: the builder copies the four public fields and nothing else.
  assert.equal(buildReceiptPayload(sampleReceiptInput({
    issuerKey: { kty: 'EC', crv: 'P-256', x: 'x', y: 'y', d: 'secret' }
  })).issuerKey.d, undefined);
});

test('a self certified receipt is accepted at the self tier', async () => {
  const { token, payload } = await selfCertifiedReceipt();
  const issuers = { 'saucier-2026-09': { origin: HARNESS, jwk: (await generateKeyPair()).publicJwk } };

  const result = await verifyReceipt(token, issuers, { seenReceiptIds: new Set() });
  assert.equal(result.ok, true);
  assert.equal(result.trust, 'self');
  assert.equal(result.issuer.origin, BLOG);
  assert.equal(result.issuer.selfCertified, true);
  assert.deepEqual(result.payload.claims, payload.claims);

  // The duplicate guard still runs, and a duplicate keeps the tier it earned.
  const again = await verifyReceipt(token, issuers, { seenReceiptIds: ['rcpt_self_001'] });
  assert.equal(again.ok, false);
  assert.equal(again.reason, 'duplicate');
  assert.equal(again.trust, 'self');
});

test('a registered receipt is unchanged by the self certifying path', async () => {
  const harness = await generateKeyPair();
  const issuers = {
    'saucier-2026-09': { origin: HARNESS, jwk: harness.publicJwk, name: 'Saucier School', id: 'harness' }
  };
  const token = await signToken(buildReceiptPayload(sampleReceiptInput()), harness.privateJwk);

  const result = await verifyReceipt(token, issuers, { seenReceiptIds: new Set() });
  assert.equal(result.ok, true);
  assert.equal(result.trust, 'registered');
  assert.equal(result.issuer.name, 'Saucier School');
  assert.equal(result.payload.issuerKey, undefined);
});

test('a registered keyId is always checked against the registry, never against a carried key', async () => {
  const harness = await generateKeyPair();
  const mallory = await generateKeyPair();
  const issuers = { 'saucier-2026-09': { origin: HARNESS, jwk: harness.publicJwk } };

  // Mallory signs with her own key and encloses it, hoping the vault will use
  // the key in the token instead of the one in its registry.
  const token = await signToken(
    buildReceiptPayload(sampleReceiptInput({ issuerKey: mallory.publicJwk })),
    mallory.privateJwk
  );
  const result = await verifyReceipt(token, issuers);
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'bad-signature');
  assert.equal(result.trust, 'pending');
});

test('a tampered self certified receipt is rejected', async () => {
  const { token } = await selfCertifiedReceipt();
  const parts = token.split('.');
  const tampered = `${parts[0]}.${parts[1].slice(0, -4)}AAAA.${parts[2]}`;

  const result = await verifyReceipt(tampered, {}, { seenReceiptIds: new Set() });
  assert.equal(result.ok, false);
  assert.notEqual(result.trust, 'self');

  // Swapping in another key does not help: the signature covers the payload
  // bytes, and the enclosed key is part of them.
  const stranger = await generateKeyPair();
  const decoded = decodeToken(token);
  const swapped = encodeToken({ ...decoded.payload, issuerKey: stranger.publicJwk }, decoded.signature);
  const result2 = await verifyReceipt(swapped, {}, { seenReceiptIds: new Set() });
  assert.equal(result2.ok, false);
  assert.equal(result2.reason, 'bad-signature');
  assert.equal(result2.trust, 'pending');
});

test('a self: keyId with no key, and a key with no self: keyId, stay pending', async () => {
  const key = await generateKeyPair();

  const noKey = await signToken(
    buildReceiptPayload(sampleReceiptInput({ issuer: BLOG, keyId: `${SELF_KEY_PREFIX}${BLOG}` })),
    key.privateJwk
  );
  const a = await verifyReceipt(noKey, {});
  assert.equal(a.ok, false);
  assert.equal(a.reason, 'unknown-issuer');
  assert.equal(a.trust, 'pending');

  const noPrefix = await signToken(
    buildReceiptPayload(
      sampleReceiptInput({ issuer: BLOG, keyId: 'maillard-2026-09', issuerKey: key.publicJwk })
    ),
    key.privateJwk
  );
  const b = await verifyReceipt(noPrefix, {});
  assert.equal(b.ok, false);
  assert.equal(b.reason, 'unknown-issuer');
  assert.equal(b.trust, 'pending');
  assert.equal(isSelfCertified(b.payload), false);
});

test('matchesPublishedKey lifts self to origin only on an exact match', async () => {
  const { payload, key } = await selfCertifiedReceipt();
  const published = { keyId: payload.keyId, jwk: { kty: 'EC', crv: 'P-256', x: key.publicJwk.x, y: key.publicJwk.y } };

  assert.equal(matchesPublishedKey(payload, published), true);

  // A different key under the right keyId is the interesting attack: the site
  // publishes one key, someone else signs with another and claims the name.
  const other = await generateKeyPair();
  assert.equal(
    matchesPublishedKey(payload, { keyId: payload.keyId, jwk: other.publicJwk }),
    false
  );
  assert.equal(matchesPublishedKey(payload, { keyId: 'self:https://elsewhere.example', jwk: published.jwk }), false);
  assert.equal(matchesPublishedKey(payload, { jwk: published.jwk }), false);
  assert.equal(matchesPublishedKey(payload, { keyId: payload.keyId }), false);
  assert.equal(matchesPublishedKey(payload, { keyId: payload.keyId, jwk: { ...published.jwk, crv: 'P-384' } }), false);

  // Every way the fetch can fail arrives here as a falsy document.
  assert.equal(matchesPublishedKey(payload, null), false);
  assert.equal(matchesPublishedKey(payload, undefined), false);
  assert.equal(matchesPublishedKey(payload, 'not json'), false);
  assert.equal(matchesPublishedKey(payload, []), false);

  // A receipt with no enclosed key can never be lifted, whatever is published.
  assert.equal(matchesPublishedKey(buildReceiptPayload(sampleReceiptInput()), published), false);
  assert.equal(matchesPublishedKey(null, published), false);
});
