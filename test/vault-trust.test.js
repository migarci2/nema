// The vault's trust rule, contract section 21. Run with:
//   node --test test/vault-trust.test.js
//
// The vault itself is a browser module: it holds localStorage, absolute
// /shared/ imports and a real fetch, so it cannot be imported here. What can be
// tested is the rule it composes, which is the part that decides what a
// stranger's receipt is worth:
//
//   verifyReceipt  -> registered | self | pending
//   the well known document -> self may become origin
//   deriveState(weightCap) -> a self certified receipt is capped at the
//                             self-report weight, whatever grader it claims
//
// `stage` below is that composition, written the way apps/vault/public/vault.js
// writes it. The last test in this file guards against the two halves drifting
// apart: it reads vault.js and checks that no derivation there skips the cap.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { generateKeyPair } from '../shared/crypto.js';
import {
  RECEIPT_TYPE,
  SELF_KEY_PREFIX,
  assertShape,
  buildReceiptPayload,
  decodeToken,
  encodeToken,
  matchesPublishedKey,
  signToken,
  verifyReceipt
} from '../shared/protocol.js';
import { WEIGHTS, deriveState } from '../shared/inference.js';

const NOW = '2026-09-02T12:00:00Z';
const SAUCIER = 'https://saucier.migarci2.dev';
const BLOG = 'https://maillard.migarci2.dev';
const SELF_KEY_ID = `${SELF_KEY_PREFIX}${BLOG}`;

/** The rule the vault passes to deriveState. */
const trustWeightCap = (entry) => (
  entry && entry.trust === 'self' ? WEIGHTS['self-report'] : Infinity
);

const claim = (concept, ability = 'apply') => ({
  concept,
  ability,
  evidenceType: ability === 'apply' ? 'application' : 'explanation',
  result: 'passed',
  difficulty: 'intermediate'
});

const activity = { id: 'check', version: '1.0.0', title: 'Two questions before you go' };
const conditions = { attempts: 1, hintsUsed: 0, durationSeconds: 120, grader: 'deterministic', graderVersion: '1' };

async function registeredReceipt(key, overrides = {}) {
  const payload = buildReceiptPayload({
    issuer: SAUCIER,
    keyId: 'saucier-2026-09',
    subject: 'lk_fixture',
    activity: { ...activity, id: 'fix-the-broken-sauce', title: 'Fix the broken sauce' },
    claims: [claim('nema:pan-sauces')],
    conditions,
    now: NOW,
    receiptId: 'rcpt_registered_001',
    ...overrides
  });
  return { payload, token: await signToken(payload, key.privateJwk) };
}

async function selfReceipt(key, overrides = {}) {
  const payload = buildReceiptPayload({
    issuer: BLOG,
    keyId: SELF_KEY_ID,
    issuerKey: key.publicJwk,
    subject: 'lk_fixture',
    activity,
    claims: [claim('nema:maillard-reaction')],
    conditions,
    now: NOW,
    receiptId: 'rcpt_self_001',
    ...overrides
  });
  return { payload, token: await signToken(payload, key.privateJwk) };
}

/**
 * One staging pass, as the vault runs it. `published` stands in for the fetch
 * of https://<issuer>/.well-known/nema-issuer.json: a document, or null for
 * every way that fetch can fail (offline, timeout, 404, CORS, bad JSON).
 */
async function stage(token, { issuers, ledger = [], published = null }) {
  const seen = new Set(ledger.map((entry) => entry.receiptId));
  const result = await verifyReceipt(token, issuers, { seenReceiptIds: seen });

  if (!result.ok && result.reason === 'unknown-issuer') {
    const entry = {
      receiptId: result.payload.receiptId,
      payload: result.payload,
      status: 'pending',
      trust: 'pending'
    };
    return { status: 'pending', reason: 'unknown-issuer', trust: 'pending', entry, ledger: [...ledger, entry] };
  }
  if (!result.ok) {
    return { status: 'rejected', reason: result.reason, trust: 'pending', ledger };
  }

  const trust = result.trust === 'self' && matchesPublishedKey(result.payload, published)
    ? 'origin'
    : result.trust;

  const entry = {
    receiptId: result.payload.receiptId,
    payload: result.payload,
    status: 'verified',
    trust
  };
  return { status: 'accepted', trust, entry, ledger: [...ledger, entry] };
}

const derive = (ledger) => deriveState(ledger, { now: NOW, weightCap: trustWeightCap });

/* --------------------------------------------------------------- tiers -- */

test('a receipt from a registered issuer is unchanged: full trust, full weight', async () => {
  const saucier = await generateKeyPair();
  const issuers = { 'saucier-2026-09': { origin: SAUCIER, jwk: saucier.publicJwk, name: 'Saucier School' } };
  const { token } = await registeredReceipt(saucier);

  const staged = await stage(token, { issuers });
  assert.equal(staged.status, 'accepted');
  assert.equal(staged.trust, 'registered');

  const state = derive(staged.ledger);
  assert.equal(state['nema:pan-sauces'].apply.score, 1, 'a deterministic pass from a registered issuer is worth 1');
  assert.equal(state['nema:pan-sauces'].apply.band, 'usable');
  assert.equal(state['nema:pan-sauces'].apply.graderWeight, WEIGHTS.deterministic);
});

test('a self certified receipt is accepted at the self tier and capped at a self report', async () => {
  const blog = await generateKeyPair();
  const issuers = { 'saucier-2026-09': { origin: SAUCIER, jwk: (await generateKeyPair()).publicJwk } };
  const { token } = await selfReceipt(blog);

  const staged = await stage(token, { issuers });
  assert.equal(staged.status, 'accepted', 'a site the vault has never heard of can still be read');
  assert.equal(staged.trust, 'self');

  const state = derive(staged.ledger);
  const entry = state['nema:maillard-reaction'].apply;
  assert.equal(entry.score, WEIGHTS['self-report'], 'the page graded itself deterministically, it is worth a self report');
  assert.equal(entry.graderWeight, WEIGHTS['self-report']);
  assert.equal(entry.band, 'uncertain', 'one self signed pass moves a band at most to fragile');
  assert.equal(entry.confidence, 'low');

  // Uncapped, the same receipt would have certified the concept as usable,
  // which is exactly what a site must not be able to do for itself.
  const uncapped = deriveState(staged.ledger, { now: NOW });
  assert.equal(uncapped['nema:maillard-reaction'].apply.band, 'usable');
});

test('a self certified receipt whose issuer publishes the key is trusted like a registered one', async () => {
  const blog = await generateKeyPair();
  const { token, payload } = await selfReceipt(blog);
  const published = { keyId: SELF_KEY_ID, jwk: blog.publicJwk };

  const staged = await stage(token, { issuers: {}, published });
  assert.equal(staged.status, 'accepted');
  assert.equal(staged.trust, 'origin', 'the domain vouched for the key that signed');
  assert.equal(matchesPublishedKey(payload, published), true);

  const state = derive(staged.ledger);
  assert.equal(state['nema:maillard-reaction'].apply.score, 1, 'origin is not capped');
  assert.equal(state['nema:maillard-reaction'].apply.band, 'usable');
});

test('a published key that is not the signing key leaves the receipt at self', async () => {
  const blog = await generateKeyPair();
  const impostor = await generateKeyPair();
  const { token } = await selfReceipt(blog);

  // The document is well formed and names the right keyId. It simply carries
  // another key, which is what a stale, spoofed or copy pasted well known file
  // looks like from here.
  const fake = await stage(token, { issuers: {}, published: { keyId: SELF_KEY_ID, jwk: impostor.publicJwk } });
  assert.equal(fake.status, 'accepted');
  assert.equal(fake.trust, 'self');
  assert.equal(derive(fake.ledger)['nema:maillard-reaction'].apply.score, WEIGHTS['self-report']);

  // And so does every way the fetch can fail.
  for (const published of [null, undefined, {}, { keyId: SELF_KEY_ID }, { jwk: blog.publicJwk }, 'not json']) {
    const staged = await stage(token, { issuers: {}, published });
    assert.equal(staged.trust, 'self', `published ${JSON.stringify(published) ?? 'undefined'} must not lift the tier`);
  }
});

test('a tampered self certified receipt is rejected and never reaches the ledger', async () => {
  const blog = await generateKeyPair();
  const { token } = await selfReceipt(blog);
  const parts = token.split('.');

  const flipped = await stage(`${parts[0]}.${parts[1].slice(0, -4)}AAAA.${parts[2]}`, { issuers: {} });
  assert.notEqual(flipped.status, 'accepted');
  assert.deepEqual(flipped.ledger, [], 'nothing was stored');

  // Rewriting a claim and re-enclosing a key of one's own does not work
  // either: the signature covers the payload bytes, key included.
  const impostor = await generateKeyPair();
  const decoded = decodeToken(token);
  const rewritten = encodeToken(
    {
      ...decoded.payload,
      issuerKey: impostor.publicJwk,
      claims: [claim('nema:maillard-reaction', 'transfer')]
    },
    decoded.signature
  );
  const forged = await stage(rewritten, { issuers: {} });
  assert.equal(forged.status, 'rejected');
  assert.equal(forged.reason, 'bad-signature');
  assert.equal(forged.trust, 'pending');
  assert.deepEqual(derive(forged.ledger), {}, 'a forged receipt moves no band');
});

test('an unreadable issuer is still pending, and pending moves nothing', async () => {
  const stranger = await generateKeyPair();
  const token = await signToken(
    buildReceiptPayload({
      issuer: BLOG,
      keyId: 'maillard-2026-09',
      subject: 'lk_fixture',
      activity,
      claims: [claim('nema:maillard-reaction')],
      conditions,
      now: NOW,
      receiptId: 'rcpt_pending_001'
    }),
    stranger.privateJwk
  );

  const staged = await stage(token, { issuers: {} });
  assert.equal(staged.status, 'pending');
  assert.equal(staged.trust, 'pending');
  assert.equal(staged.ledger.length, 1, 'it is kept, so the learner can see what arrived');
  assert.deepEqual(derive(staged.ledger), {}, 'and it moves nothing at all');
});

test('assertShape accepts a receipt carrying issuerKey', async () => {
  const blog = await generateKeyPair();
  const { payload } = await selfReceipt(blog);

  assert.equal(assertShape(payload, RECEIPT_TYPE), payload);
  assert.equal(payload.keyId, SELF_KEY_ID);
  assert.deepEqual(Object.keys(payload.issuerKey), ['kty', 'crv', 'x', 'y']);
  assert.throws(() => assertShape({ ...payload, issuerKey: { x: 1 } }, RECEIPT_TYPE), /issuerKey/);
});

test('the tiers coexist in one ledger, each worth what it earned', async () => {
  const saucier = await generateKeyPair();
  const blog = await generateKeyPair();
  const issuers = { 'saucier-2026-09': { origin: SAUCIER, jwk: saucier.publicJwk } };

  let ledger = [];
  ({ ledger } = await stage((await registeredReceipt(saucier)).token, { issuers, ledger }));
  ({ ledger } = await stage((await selfReceipt(blog)).token, { issuers, ledger }));
  ({ ledger } = await stage(
    (await selfReceipt(blog, { receiptId: 'rcpt_self_002', claims: [claim('nema:pan-sauces')] })).token,
    { issuers, ledger }
  ));

  assert.deepEqual(ledger.map((entry) => entry.trust), ['registered', 'self', 'self']);

  const state = derive(ledger);
  assert.equal(state['nema:pan-sauces'].apply.score, 1.3, 'the registered 1 plus a self certified 0.3');
  assert.equal(state['nema:maillard-reaction'].apply.score, WEIGHTS['self-report']);
  assert.equal(state['nema:pan-sauces'].apply.graderWeight, WEIGHTS.deterministic);
  assert.equal(state['nema:maillard-reaction'].apply.graderWeight, WEIGHTS['self-report']);
});

/* --------------------------------------------------------------- guard -- */

test('the vault derives every state through the cap', () => {
  const source = readFileSync(
    fileURLToPath(new URL('../apps/vault/public/vault.js', import.meta.url)),
    'utf8'
  );

  // One helper, used everywhere: a second call site that passes the receipts
  // straight to deriveState would silently uncap self certified evidence.
  assert.match(source, /function deriveFrom\(receipts, now\) \{\s*return deriveState\(receipts, \{ now, weightCap: trustWeightCap \}\);/);
  assert.match(source, /trustWeightCap = \(entry\) => \(\s*entry && entry\.trust === 'self' \? WEIGHTS\['self-report'\] : Infinity/);

  const calls = source.match(/deriveState\(/g) || [];
  assert.equal(calls.length, 1, 'deriveState is called in exactly one place, inside deriveFrom');
});
