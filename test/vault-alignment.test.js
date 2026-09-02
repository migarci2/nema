/**
 * Concept alignment and the self check, contract section 23. Run with:
 *   node --test test/vault-alignment.test.js
 *
 * This file drives the real vault module, `apps/vault/public/vault.js`, rather
 * than a copy of its rules. The vault is a browser module: it holds
 * localStorage, absolute `/shared/` imports and a real fetch. Node gets those
 * from the two dependency free files `packages/nema-mcp` already uses to serve
 * the same vault over MCP, so what is tested here is the code that ships, with
 * one difference: `fetch` answers 404 for anything off the repo, so an issuer's
 * well known lookup is offline and deterministic.
 *
 * What the section asks for, and what is checked below:
 *
 *   - the lifecycle: propose, exists, confirm, reject
 *   - a provider's own declaration arrives confirmed, marked as the provider's
 *   - assertions translate at the edge: the three relations, and the honest
 *     `missing` with `reason: 'unaligned'` for a name nobody has aligned
 *   - a receipt with local claims is kept, moves nothing, and moves bands the
 *     moment the learner confirms what the name means, with no ledger change
 *   - a self check is worth 0.3 and says who graded it
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs, { readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { register } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { installGlobals } from '../packages/nema-mcp/shim.mjs';
import { generateKeyPair } from '../shared/crypto.js';
import { buildReceiptPayload, signToken, verifyAssertion } from '../shared/protocol.js';
import { WEIGHTS } from '../shared/inference.js';

const REPO = fileURLToPath(new URL('..', import.meta.url)).replace(/\/$/, '');
const VAULT_FILE = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'nema-alignment-')), 'vault.json');

installGlobals({ file: VAULT_FILE, repo: REPO });

/* Everything outside the repo is offline here. The only fetch the vault makes
 * to the open web is the issuer's well known document, and a test that depends
 * on whether a domain is reachable is not a test. */
const repoFetch = globalThis.fetch;
globalThis.fetch = (input, init) => {
  const url = typeof input === 'string' ? input : input && input.url;
  if (typeof url === 'string' && !url.startsWith('/')) {
    return Promise.resolve(new Response('not found', { status: 404 }));
  }
  return repoFetch(input, init);
};

register(pathToFileURL(path.join(REPO, 'packages/nema-mcp/hooks.mjs')), { data: { repo: REPO } });

const vault = await import('/vault.js');
const { TOOLS } = await import(path.join(REPO, 'apps/vault/public/tools.js'));
const { evidenceRows } = await import(path.join(REPO, 'apps/vault/public/tools.js'));
await vault.init();

const BLOG = 'http://localhost:8785';
const APPROVE = async () => ({ approved: true });

/** A vault with nothing in it, and a learner who says yes to disclosures. */
async function fresh() {
  await vault.reset();
  vault.setConsentHandler(APPROVE);
}

const propose = (overrides = {}) =>
  vault.proposeAlignment({
    origin: BLOG,
    providerConcept: 'browning-science',
    concept: 'nema:maillard-reaction',
    relation: 'equivalent',
    rationale: 'The whole article is about the Maillard reaction under another name.',
    ...overrides
  });

/** A receipt the blog signed with a key it generated for itself. */
async function blogReceipt(claims, overrides = {}) {
  const key = await generateKeyPair();
  const payload = buildReceiptPayload({
    issuer: BLOG,
    keyId: `self:${BLOG}`,
    issuerKey: key.publicJwk,
    subject: 'lk_fixture',
    activity: { id: 'check', version: '1.0.0', title: 'Two questions before you go' },
    claims,
    conditions: { attempts: 1, hintsUsed: 0, durationSeconds: 90, grader: 'deterministic', graderVersion: '1' },
    now: new Date(),
    ...overrides
  });
  return signToken(payload, key.privateJwk);
}

const claim = (concept, ability = 'explain', result = 'passed') => ({
  concept,
  ability,
  evidenceType: ability === 'discriminate' ? 'discrimination' : 'explanation',
  result,
  difficulty: 'introductory'
});

/* ----------------------------------------------------------- lifecycle -- */

test('propose, exists, confirm, reject: the learner has the only vote', async () => {
  await fresh();

  const first = propose();
  assert.equal(first.status, 'proposed');
  assert.match(first.alignmentId, /^aln_/);

  const stored = vault.getAlignments(BLOG);
  assert.equal(stored.length, 1);
  assert.equal(stored[0].status, 'proposed');
  assert.equal(stored[0].proposedBy, 'agent');
  assert.equal(stored[0].decidedAt, null);
  assert.equal(stored[0].providerConcept, 'browning-science');

  // Asking twice does not stack up questions for the learner.
  const again = propose();
  assert.equal(again.status, 'exists');
  assert.equal(again.alignmentId, first.alignmentId);
  assert.equal(again.current.status, 'proposed');

  // Nor does asking for the same name under a different registry concept.
  const sideways = propose({ concept: 'nema:caramelization' });
  assert.equal(sideways.status, 'exists');
  assert.equal(sideways.alignmentId, first.alignmentId);

  const confirmed = vault.confirmAlignment(first.alignmentId);
  assert.equal(confirmed.status, 'ok');
  assert.equal(confirmed.alignment.status, 'confirmed');
  assert.ok(confirmed.alignment.decidedAt, 'a decision is dated');

  const rejected = vault.rejectAlignment(first.alignmentId);
  assert.equal(rejected.alignment.status, 'rejected');
  assert.equal(vault.getAlignments()[0].status, 'rejected');

  // A rejected name is still on file: the vault holds the answer, and an agent
  // that proposes the very same thing is told it has already been answered.
  assert.equal(propose().status, 'exists');
  assert.equal(vault.getAlignments().length, 1);

  assert.equal(vault.rejectAlignment('aln_nope').status, 'rejected');
  assert.equal(vault.rejectAlignment('aln_nope').reason, 'unknown-alignment');
});

test('a proposal must name a local id and a concept that exists', async () => {
  await fresh();

  assert.match(propose({ providerConcept: 'nema:caramelization' }).error, /without the nema: prefix/);
  assert.match(propose({ concept: 'nema:not-a-concept' }).error, /not a concept in the nema registry/);
  assert.match(propose({ concept: 'browning' }).error, /not a concept in the nema registry/);
  assert.match(propose({ relation: 'sort-of' }).error, /relation must be one of/);
  assert.match(propose({ origin: '' }).error, /origin must be/);
  assert.deepEqual(vault.getAlignments(), [], 'nothing invalid was stored');
});

test('a site may vouch for its own vocabulary, and it arrives confirmed', async () => {
  await fresh();

  // Exactly the concepts block of the blog manifest, contract section 23.
  const result = vault.declareAlignments({
    origin: BLOG,
    concepts: [
      { id: 'browning-science', title: 'Browning science' },
      {
        id: 'sugar-browning',
        title: 'Sugar browning',
        alignsTo: [{ concept: 'nema:caramelization', relation: 'equivalent' }]
      }
    ]
  });

  assert.equal(result.status, 'ok');
  assert.equal(result.declared, 1, 'only the one the site actually declared');

  const [alignment] = vault.getAlignments(BLOG);
  assert.equal(alignment.providerConcept, 'sugar-browning');
  assert.equal(alignment.concept, 'nema:caramelization');
  assert.equal(alignment.status, 'confirmed');
  assert.equal(alignment.proposedBy, 'provider');
  assert.ok(alignment.decidedAt, 'confirmed on arrival');
  assert.match(alignment.rationale, /Sugar browning/);

  // The name the site did not vouch for is still nobody's business but the
  // learner's: an agent proposes it, and it waits.
  assert.equal(propose().status, 'proposed');
  assert.equal(vault.getAlignments(BLOG).length, 2);

  // Declaring twice adds nothing, and cannot overrule a decision.
  vault.rejectAlignment(alignment.alignmentId);
  const repeat = vault.declareAlignments({
    origin: BLOG,
    concepts: [{ id: 'sugar-browning', alignsTo: [{ concept: 'nema:caramelization' }] }]
  });
  assert.equal(repeat.declared, 0);
  assert.equal(repeat.skipped, 1);
  assert.equal(vault.getAlignments(BLOG).filter((entry) => entry.providerConcept === 'sugar-browning').length, 1);
});

/* -------------------------------------------------------- the assertion -- */

test('an assertion answers in the site own words, or says it cannot', async () => {
  await fresh();

  // One piece of evidence, in the shared vocabulary, from a registered issuer.
  const seeded = await vault.stageReceipt(await blogReceipt([claim('nema:maillard-reaction', 'explain')]));
  assert.equal(seeded.status, 'accepted');

  const { alignmentId } = propose();
  vault.confirmAlignment(alignmentId);

  const result = await vault.createAssertion({
    audience: BLOG,
    purpose: 'personalize-maillard-explained',
    requirements: [
      { concept: 'browning-science', ability: 'explain' },
      { concept: 'water-control', ability: 'explain' },
      { concept: 'nema:heat-control', ability: 'explain' }
    ]
  });
  assert.equal(result.status, 'approved');

  const verified = await verifyAssertion(result.token, { audience: BLOG, now: new Date() });
  assert.equal(verified.ok, true);
  const [browning, water, heat] = verified.payload.assertions;

  // The site asked in its own words and is answered in them, with the registry
  // concept the band was actually read from.
  assert.equal(browning.concept, 'browning-science');
  assert.equal(browning.alignedTo, 'nema:maillard-reaction');
  assert.equal(browning.status, 'uncertain', 'a single self signed pass is worth a self report');

  // A local name with no confirmed alignment is missing, and says why. It is
  // not a lie and it is not a leak: the vault does not know what that means.
  assert.equal(water.concept, 'water-control');
  assert.equal(water.status, 'missing');
  assert.equal(water.reason, 'unaligned');
  assert.equal(water.alignedTo, undefined);

  // A registry id is untouched by any of this.
  assert.equal(heat.concept, 'nema:heat-control');
  assert.equal(heat.status, 'missing');
  assert.equal(heat.reason, undefined);

  // The disclosure ledger records what left, in the same words.
  const disclosure = vault.getDisclosures().at(-1);
  assert.equal(disclosure.shared[0].concept, 'browning-science');
  assert.equal(disclosure.shared[0].alignedTo, 'nema:maillard-reaction');
});

test('the relation caps the direction it weakens', async () => {
  await fresh();

  // Enough self signed evidence to carry the registry concept to `usable`,
  // which is the band a provider reads as `verified`. Four at 0.3 each: this is
  // the honest ceiling for a site that grades itself.
  for (const receiptId of ['rcpt_a', 'rcpt_b', 'rcpt_c', 'rcpt_d']) {
    const token = await blogReceipt([claim('nema:maillard-reaction', 'explain')], { receiptId });
    assert.equal((await vault.stageReceipt(token)).status, 'accepted');
  }
  assert.equal(vault.derived().state['nema:maillard-reaction'].explain.band, 'usable');

  const ask = async (providerConcept) => {
    const result = await vault.createAssertion({
      audience: BLOG,
      purpose: 'p',
      requirements: [{ concept: providerConcept, ability: 'explain' }]
    });
    return result.shared[0];
  };

  // equivalent: the band passes through as it stands.
  vault.confirmAlignment(propose({ relation: 'equivalent' }).alignmentId);
  const equivalent = await ask('browning-science');
  assert.equal(equivalent.status, 'verified');
  assert.equal(equivalent.alignedTo, 'nema:maillard-reaction');

  // narrower: the site's name is a part of the registry concept, so knowing the
  // whole does not prove the part. Uncertain at best, whatever the band says.
  vault.confirmAlignment(propose({ providerConcept: 'crust-chemistry', relation: 'narrower' }).alignmentId);
  const narrower = await ask('crust-chemistry');
  assert.equal(narrower.status, 'uncertain');

  // The band itself is untouched: the cap is on what may be said about it, and
  // the exact band never leaves the vault anyway.
  const preview = vault.previewDisclosure([{ concept: 'crust-chemistry', ability: 'explain' }], BLOG)[0];
  assert.equal(preview.relation, 'narrower');
  assert.equal(preview.band, 'usable');
  assert.equal(preview.status, 'uncertain');
  assert.equal(narrower.band, undefined, 'the caller is told a status, never a band');

  // broader: the mirror. The requirement is answered in full, and the cap moves
  // to the evidence side instead, where a pass on the whole is partial evidence
  // for the part.
  vault.confirmAlignment(propose({ providerConcept: 'kitchen-chemistry', relation: 'broader' }).alignmentId);
  const broader = await ask('kitchen-chemistry');
  assert.equal(broader.status, 'verified');

  const before = vault.derived().state['nema:maillard-reaction'].explain.score;
  const token = await blogReceipt([claim('kitchen-chemistry', 'explain')], { receiptId: 'rcpt_broad' });
  const staged = await vault.stageReceipt(token);
  assert.equal(staged.claims[0].alignedTo, 'nema:maillard-reaction');
  const after = vault.derived().state['nema:maillard-reaction'].explain.score;
  assert.ok(after - before < WEIGHTS['self-report'], 'a broader pass counts as a partial');
  assert.ok(after > before, 'and it still counts');
});

/* ----------------------------------------------------------- the ledger -- */

test('a receipt in the site own words is kept, waits, and then moves bands', async () => {
  await fresh();

  const token = await blogReceipt([
    claim('browning-science', 'explain'),
    claim('nema:heat-control', 'explain')
  ]);
  const staged = await vault.stageReceipt(token, { source: 'agent' });

  // The receipt is accepted: it is the learner's evidence whether or not the
  // vault can read every name in it yet.
  assert.equal(staged.status, 'accepted');
  assert.equal(staged.trust, 'self');
  assert.deepEqual(staged.pendingAlignment, ['browning-science']);
  assert.match(staged.hint, /propose_concept_alignment/);
  assert.equal(staged.claims[0].pendingAlignment, true);
  assert.equal(staged.claims[1].pendingAlignment, undefined);

  // The claim it could read moved a band. The one it could not did not.
  assert.ok(staged.changes.some((change) => change.concept === 'nema:heat-control'));
  assert.equal(vault.derived().state['nema:maillard-reaction'], undefined);

  const ledgerBefore = evidenceRows(1)[0];
  assert.equal(ledgerBefore.claims[0].pendingAlignment, true);
  assert.match(ledgerBefore.effect.join(' '), /waiting on an alignment for browning-science/);

  // Now the learner says what the name means. Nothing is re-signed, nothing is
  // re-staged, and no line of the ledger is rewritten.
  const tokensBefore = vault.getReceipts().map((entry) => entry.token);
  const { alignmentId } = propose();
  const confirmed = vault.confirmAlignment(alignmentId);

  assert.ok(confirmed.changes.some((change) => change.concept === 'nema:maillard-reaction' && change.ability === 'explain'));
  const state = vault.derived().state['nema:maillard-reaction'].explain;
  assert.equal(state.score, WEIGHTS['self-report'], 'the site signed its own key, so it is worth a self report');
  assert.equal(state.band, 'uncertain');
  assert.deepEqual(vault.getReceipts().map((entry) => entry.token), tokensBefore, 'the evidence is untouched');

  const ledgerAfter = evidenceRows(1)[0];
  assert.equal(ledgerAfter.receiptId, ledgerBefore.receiptId);
  assert.equal(ledgerAfter.claims[0].concept, 'browning-science', 'the ledger still says what the site said');
  assert.equal(ledgerAfter.claims[0].alignedTo, 'nema:maillard-reaction');
  assert.equal(ledgerAfter.claims[0].pendingAlignment, undefined);

  // And rejecting it puts the band back where it was.
  vault.rejectAlignment(alignmentId);
  assert.equal(vault.derived().state['nema:maillard-reaction'], undefined);
});

test('an alignment confirmed before the receipt arrives is applied on arrival', async () => {
  await fresh();

  vault.declareAlignments({
    origin: BLOG,
    concepts: [{ id: 'sugar-browning', title: 'Sugar browning', alignsTo: [{ concept: 'nema:caramelization', relation: 'equivalent' }] }]
  });

  const staged = await vault.stageReceipt(await blogReceipt([claim('sugar-browning', 'discriminate')]));
  assert.equal(staged.status, 'accepted');
  assert.equal(staged.pendingAlignment, undefined);
  assert.equal(staged.claims[0].alignedTo, 'nema:caramelization');
  assert.ok(staged.changes.some((change) => change.concept === 'nema:caramelization'));
  assert.equal(vault.derived().state['nema:caramelization'].discriminate.band, 'uncertain');
});

/* ------------------------------------------------------- the self check -- */

test('a self check is the learner own word, and it is worth 0.3', async () => {
  await fresh();

  const goal = vault.addGoal({ title: 'Hold a pan sauce through service', concepts: ['nema:pan-sauces'] });
  assert.equal(goal.status, 'ok');

  const need = vault.getNeeds().find((entry) => entry.concept === 'nema:pan-sauces');
  assert.ok(need, 'a goal with no evidence behind it is something to learn');
  assert.ok(need.rubric.length > 0);

  const result = await vault.recordSelfCheck({
    needId: need.needId,
    rubricResults: need.rubric.map((criterion) => ({ criterion, met: true }))
  });
  assert.equal(result.status, 'accepted');
  assert.equal(result.result, 'passed');

  const entry = vault.getReceipts().at(-1);
  assert.equal(entry.payload.issuer, 'urn:nema:self');
  assert.equal(entry.payload.keyId, 'self-check');
  assert.equal(entry.payload.conditions.grader, 'self-report');
  assert.equal(entry.trust, 'registered', 'nobody else vouched, and nobody else is claimed');
  assert.equal(entry.source, 'self');

  const state = vault.derived().state['nema:pan-sauces'][need.ability];
  assert.equal(state.score, WEIGHTS['self-report']);
  assert.equal(state.score, 0.3);
  assert.equal(state.band, 'uncertain', 'ticking your own box does not make you ready');
  assert.equal(state.confidence, 'low');

  // The ledger says who graded it, and it is not an agent.
  const row = evidenceRows(1)[0];
  assert.equal(row.signature, 'self-check');
  assert.equal(row.grader, 'self-report');
  assert.equal(row.issuerName, 'you, in the vault');

  // Half the boxes is partial, and a need id this vault never issued is refused
  // whatever is ticked.
  const second = vault.getNeeds().find((entry2) => entry2.needId !== need.needId);
  if (second) {
    const partial = await vault.recordSelfCheck({
      needId: second.needId,
      rubricResults: second.rubric.map((criterion, index) => ({ criterion, met: index === 0 }))
    });
    assert.ok(['partial', 'failed'].includes(partial.result));
  }
  const refused = await vault.recordSelfCheck({ needId: 'need_nope', rubricResults: [{ criterion: 'x', met: true }] });
  assert.equal(refused.status, 'rejected');
  assert.equal(refused.reason, 'unknown-need');
});

/* ------------------------------------------------------------- the tools -- */

test('the two alignment tools are registered, and nothing confirms an alignment', () => {
  const names = TOOLS.map((tool) => tool.name);
  assert.ok(names.includes('propose_concept_alignment'));
  assert.ok(names.includes('get_concept_alignments'));
  assert.equal(names.length, 11);

  for (const name of ['confirm_concept_alignment', 'reject_concept_alignment', 'record_self_check', 'set_mastery']) {
    assert.equal(names.includes(name), false, `${name} must not exist`);
  }

  const proposeTool = TOOLS.find((tool) => tool.name === 'propose_concept_alignment');
  assert.equal(proposeTool.inputSchema.additionalProperties, false);
  assert.deepEqual(proposeTool.inputSchema.required, ['origin', 'providerConcept', 'concept', 'relation', 'rationale']);
  assert.match(proposeTool.description, /the learner must confirm it there/i);
});

test('a tool call cannot arrive labelled as the site own word', async () => {
  await fresh();

  // The MCP transport hands tool arguments through as they came, so the tool
  // passes the five fields one by one and never a `proposedBy`. Otherwise an
  // agent could sign the site's name to its own guess.
  const proposeTool = TOOLS.find((tool) => tool.name === 'propose_concept_alignment');
  const result = proposeTool.execute({
    origin: BLOG,
    providerConcept: 'browning-science',
    concept: 'nema:maillard-reaction',
    relation: 'equivalent',
    rationale: 'A guess.',
    proposedBy: 'provider'
  });

  assert.equal(result.status, 'proposed');
  assert.equal(vault.getAlignments()[0].proposedBy, 'agent');
  assert.equal(vault.getAlignments()[0].status, 'proposed', 'and it is still a question');
});

/* --------------------------------------------------------------- guard -- */

test('every derivation reads the receipts through the alignments', () => {
  const source = readFileSync(path.join(REPO, 'apps/vault/public/vault.js'), 'utf8');

  // One helper does the translating, and every derivation goes through it. A
  // call site that passed `doc.receipts` straight to `deriveFrom` would count a
  // claim the learner has not agreed to read, or miss one they have.
  const calls = (source.match(/deriveFrom\([^)]*\)/g) || []).filter(
    (call) => call !== 'deriveFrom(receipts, now)'
  );
  assert.ok(calls.length >= 6, `expected the derivation call sites, found ${calls.length}`);
  for (const call of calls) {
    assert.match(call, /^deriveFrom\(translated\(doc\.receipts\)/);
  }

  // And the ledger is never rewritten to make a band move: confirming an
  // alignment touches the notes beside the claims, never the claims.
  assert.match(source, /function translated\(receipts\)/);
  assert.equal(/payload\.claims\[[^\]]+\]\s*=/.test(source), false, 'signed claims are never assigned to');
});
