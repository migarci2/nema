/**
 * The cryptography cluster of contract section 27.
 *
 * apps/aesgcm mirrors a real article and aligns its own vocabulary ("aes",
 * "gf2-128", "ghash", ...) to six registry ids. These tests hold the registry
 * to what those alignments need: the ids exist, every prereq resolves, the
 * graph stays acyclic, and the demo learner is untouched by the addition.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { bestBand, deriveState, summarize, toAssertionStatus } from '../shared/inference.js';

function readJson(relative) {
  return JSON.parse(readFileSync(fileURLToPath(new URL(relative, import.meta.url)), 'utf8'));
}

const CONCEPTS = readJson('../shared/concepts.json');
const SEED = readJson('../shared/seed-evidence.json');

const byId = new Map(CONCEPTS.map((concept) => [concept.id, concept]));

const CRYPTO = [
  'nema:block-ciphers',
  'nema:counter-mode',
  'nema:authenticated-encryption',
  'nema:galois-field-arithmetic',
  'nema:message-authentication',
  'nema:nonce-misuse'
];

/* ------------------------------------------------------------ the cluster */

test('the six cryptography ids exist and are described like every other concept', () => {
  for (const id of CRYPTO) {
    const concept = byId.get(id);
    assert.ok(concept, `${id} is in the registry`);
    assert.equal(typeof concept.title, 'string');
    assert.ok(concept.title.length > 0, `${id} has a title`);
    assert.ok(concept.summary.length > 40, `${id} has a summary worth reading`);
    assert.ok(Array.isArray(concept.prereqs), `${id} has prereqs`);
    assert.ok(Array.isArray(concept.confusableWith), `${id} has confusableWith`);
    for (const ability of ['explain', 'apply', 'discriminate']) {
      assert.ok(Array.isArray(concept.rubric[ability]), `${id} has a ${ability} rubric`);
      assert.equal(concept.rubric[ability].length, 3, `${id} has three ${ability} criteria`);
    }
    for (const ability of ['retrieve', 'explain', 'apply', 'discriminate']) {
      assert.equal(typeof concept.minutes[ability], 'number', `${id} costs minutes at ${ability}`);
      assert.ok(concept.minutes[ability] > 0, `${id} minutes at ${ability} are positive`);
    }
  }
});

test('the ids are unique across the whole registry', () => {
  assert.equal(byId.size, CONCEPTS.length, 'no id appears twice');
});

test('the pairs the article can be confused by are declared both ways round', () => {
  // Contract section 27: authenticated encryption against message
  // authentication, and counter mode against the block cipher underneath it.
  assert.ok(
    byId.get('nema:authenticated-encryption').confusableWith.includes('nema:message-authentication'),
    'authenticated encryption is confusable with message authentication'
  );
  assert.ok(
    byId.get('nema:message-authentication').confusableWith.includes('nema:authenticated-encryption'),
    'and the other way round'
  );
  assert.ok(
    byId.get('nema:counter-mode').confusableWith.includes('nema:block-ciphers'),
    'counter mode is confusable with the block cipher'
  );
  assert.ok(
    byId.get('nema:block-ciphers').confusableWith.includes('nema:counter-mode'),
    'and the other way round'
  );
});

test('nonce misuse carries the misconception the article exists to correct', () => {
  const misconceptions = byId.get('nema:nonce-misuse').misconceptions;
  const entry = misconceptions.find((item) => item.id === 'a_nonce_only_needs_to_be_secret');
  assert.ok(entry, 'the misconception is declared');
  assert.ok(entry.text.length > 20, 'and it is written out for the learner');
});

/* ---------------------------------------------------------------- the DAG */

test('every prereq and every confusableWith resolves to a concept that exists', () => {
  for (const concept of CONCEPTS) {
    for (const prereq of concept.prereqs) {
      assert.ok(byId.has(prereq), `${concept.id} prereq ${prereq} exists`);
      assert.notEqual(prereq, concept.id, `${concept.id} is not its own prereq`);
    }
    for (const other of concept.confusableWith) {
      assert.ok(byId.has(other), `${concept.id} confusableWith ${other} exists`);
      assert.notEqual(other, concept.id, `${concept.id} is not confusable with itself`);
    }
  }
});

test('the crypto cluster hangs off the rest of the registry by prereqs only', () => {
  // The six are a cluster: at least one of them depends on another one, so a
  // vault that knows the graph can order them for a learner.
  const internal = CRYPTO.filter((id) =>
    byId.get(id).prereqs.some((prereq) => CRYPTO.includes(prereq))
  );
  assert.ok(internal.length >= 4, 'most of the cluster has a prereq inside the cluster');
  assert.deepEqual(byId.get('nema:block-ciphers').prereqs, [], 'the block cipher is the root');
  assert.deepEqual(byId.get('nema:counter-mode').prereqs, ['nema:block-ciphers']);
  assert.deepEqual(byId.get('nema:authenticated-encryption').prereqs, [
    'nema:counter-mode',
    'nema:message-authentication'
  ]);
  assert.ok(
    byId.get('nema:nonce-misuse').prereqs.includes('nema:authenticated-encryption'),
    'nonce misuse comes after authenticated encryption'
  );
});

test('the prereq graph is acyclic', () => {
  // Depth first search with three colours. A grey node reached twice is a cycle.
  const state = new Map();
  const trail = [];

  function visit(id) {
    const colour = state.get(id);
    if (colour === 'black') return;
    if (colour === 'grey') {
      assert.fail(`prereq cycle: ${[...trail, id].join(' -> ')}`);
    }
    state.set(id, 'grey');
    trail.push(id);
    for (const prereq of byId.get(id).prereqs) visit(prereq);
    trail.pop();
    state.set(id, 'black');
  }

  for (const concept of CONCEPTS) visit(concept.id);
  assert.equal(state.size, CONCEPTS.length, 'every concept was reached');
});

/* --------------------------------------------------------- the demo seed */

test('the demo learner is exactly what it was before the crypto cluster arrived', () => {
  // Contract section 27: "The demo seed does not change." Six new ids in the
  // registry must not move one band in the shipped ledger, so the numbers are
  // pinned here: 27 concepts with evidence, 18 of them verified, 7 fragile and
  // 4 reviews due on the day this build is judged.
  const now = '2026-09-02T12:00:00Z';
  const dayMs = 24 * 60 * 60 * 1000;
  const baseMs = Date.parse(SEED.baseDate);

  const receipts = SEED.receipts.map((entry, index) => ({
    receiptId: `rcpt_seed_${String(index + 1).padStart(3, '0')}`,
    status: 'verified',
    payload: {
      type: 'evidence-receipt',
      protocol: 'nema/0.1',
      claims: entry.claims,
      conditions: entry.conditions,
      issuedAt: new Date(baseMs - Number(entry.daysAgo) * dayMs).toISOString().replace(/\.\d{3}Z$/, 'Z')
    }
  }));

  const state = deriveState(receipts, { now });
  const counts = summarize(state, { now });

  assert.equal(counts.concepts, 27, 'the seed touches 27 concepts');
  assert.equal(counts.fragile, 7, 'seven of them are fragile');
  assert.equal(counts.reviewsDue, 4, 'four reviews are due');

  const verified = Object.values(state).filter(
    (concept) => toAssertionStatus(bestBand(concept)) === 'verified'
  ).length;
  assert.equal(verified, 18, 'eighteen answer a readiness question with verified');

  // The seed says nothing about cryptography, so none of the six may appear.
  for (const id of CRYPTO) {
    assert.equal(state[id], undefined, `${id} has no evidence in the demo ledger`);
  }
});
