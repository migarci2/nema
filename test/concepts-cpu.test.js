/**
 * The computer architecture cluster of contract section 28.
 *
 * apps/cpu mirrors chapter 1 of cpu.land and aligns the chapter's own
 * vocabulary ("cpu-architecture", "rings", "syscall", ...) to six registry
 * ids. These tests hold the registry to what those alignments need: the ids
 * exist, every prereq resolves, the graph stays acyclic, and the demo learner
 * is untouched by the addition.
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

const CPU = [
  'nema:cpu-architecture',
  'nema:fetch-execute-cycle',
  'nema:privilege-rings',
  'nema:system-calls',
  'nema:interrupts',
  'nema:instruction-sets'
];

/* ------------------------------------------------------------ the cluster */

test('the six computer architecture ids exist and are described like every other concept', () => {
  for (const id of CPU) {
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

test('the chapter is aligned to six ids and adds nothing else to the registry', () => {
  // Contract section 28 names exactly these six. The count is pinned so that a
  // seventh id cannot arrive without a decision.
  assert.equal(CONCEPTS.length, 46, 'the registry holds 40 concepts plus this cluster');
  const local = CPU.map((id) => byId.get(id).aliases?.cpu);
  assert.deepEqual(local, [
    'cpu-architecture',
    'fetch-execute',
    'rings',
    'syscall',
    'interrupt',
    'cisc-risc'
  ], "each id records the name the chapter uses for it");
});

test('the pairs the chapter can be confused by are declared both ways round', () => {
  // Contract section 28: privilege rings against system calls, and interrupts
  // against system calls.
  assert.ok(
    byId.get('nema:privilege-rings').confusableWith.includes('nema:system-calls'),
    'privilege rings are confusable with system calls'
  );
  assert.ok(
    byId.get('nema:system-calls').confusableWith.includes('nema:privilege-rings'),
    'and the other way round'
  );
  assert.ok(
    byId.get('nema:interrupts').confusableWith.includes('nema:system-calls'),
    'interrupts are confusable with system calls'
  );
  assert.ok(
    byId.get('nema:system-calls').confusableWith.includes('nema:interrupts'),
    'and the other way round'
  );
});

test('system calls carry the misconception the chapter exists to correct', () => {
  const misconceptions = byId.get('nema:system-calls').misconceptions;
  const entry = misconceptions.find((item) => item.id === 'programs_call_the_kernel_like_a_function');
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

test('the cpu cluster hangs off the rest of the registry by prereqs only', () => {
  // The six are a cluster: five of them depend on another one of the six, so a
  // vault that knows the graph can order them for a learner, and none of them
  // reaches outside the cluster for a prereq.
  const internal = CPU.filter((id) =>
    byId.get(id).prereqs.some((prereq) => CPU.includes(prereq))
  );
  assert.equal(internal.length, 5, 'every id but the root has a prereq inside the cluster');
  assert.deepEqual(byId.get('nema:cpu-architecture').prereqs, [], 'the machine itself is the root');
  assert.deepEqual(byId.get('nema:fetch-execute-cycle').prereqs, ['nema:cpu-architecture']);
  assert.deepEqual(byId.get('nema:instruction-sets').prereqs, ['nema:cpu-architecture']);
  assert.deepEqual(byId.get('nema:privilege-rings').prereqs, ['nema:fetch-execute-cycle']);
  assert.deepEqual(byId.get('nema:interrupts').prereqs, ['nema:fetch-execute-cycle']);
  assert.deepEqual(byId.get('nema:system-calls').prereqs, [
    'nema:privilege-rings',
    'nema:interrupts'
  ], 'a syscall needs both the ring and the interrupt underneath it');
  for (const id of CPU) {
    for (const prereq of byId.get(id).prereqs) {
      assert.ok(CPU.includes(prereq), `${id} does not reach outside the cluster for ${prereq}`);
    }
  }
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

test('the demo learner is exactly what it was before the cpu cluster arrived', () => {
  // Contract section 27 pinned these numbers when the crypto cluster landed and
  // section 28 must not move one band in the shipped ledger either: 27 concepts
  // with evidence, 18 of them verified, 7 fragile and 4 reviews due on the day
  // this build is judged.
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

  // The seed says nothing about computer architecture, so none of the six may appear.
  for (const id of CPU) {
    assert.equal(state[id], undefined, `${id} has no evidence in the demo ledger`);
  }
});
