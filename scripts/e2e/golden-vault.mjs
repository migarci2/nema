// Golden path, vault half, on native WebMCP (Chrome for Testing canary).
// Usage: CHROME=<chrome with WebMCP> node scripts/e2e/golden-vault.mjs [vaultOrigin] [harnessOrigin]
import { launch, tool } from './cdp.mjs';
import { fileURLToPath } from 'node:url';
const REPO = fileURLToPath(new URL('../..', import.meta.url)).replace(/\/$/, '');
const [V = 'http://localhost:8781', H = 'http://localhost:8782'] = process.argv.slice(2);
const bin = process.env.CHROME;
if (!bin) { console.error('set CHROME to a Chrome binary with native WebMCP'); process.exit(2); }
const proto = await import(REPO + '/shared/protocol.js');
const content = await import(REPO + '/apps/harness/public/content.js');
const parse = s => JSON.parse(s);
const ok = (cond, msg) => { console.log((cond ? 'PASS ' : 'FAIL ') + msg); if (!cond) process.exitCode = 1; };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const page = await launch(bin);
try {
  await page.goto(V + '/', 2500); await page.waitForTools();
  await page.evaluate(`localStorage.clear(); true`);
  await page.goto(V + '/', 2500); await page.waitForTools();
  const empty = parse(await page.evaluate(tool('get_vault_summary', {})));
  ok(empty.status === 'ok' && empty.receipts === 0, 'empty vault summary: ' + JSON.stringify(empty).slice(0, 120));
  await page.evaluate(`document.querySelector('[data-action="load-demo"]').click(); new Promise(r => setTimeout(r, 3000))`);
  const sum = parse(await page.evaluate(tool('get_vault_summary', {})));
  ok(sum.receipts >= 40 && sum.fragile === 7 && sum.reviewsDue === 4 && (sum.durable + sum.usable) === 18, `demo summary: receipts ${sum.receipts} durable ${sum.durable} usable ${sum.usable} fragile ${sum.fragile} due ${sum.reviewsDue}`);
  const state = parse(await page.evaluate(tool('get_learner_state', { concepts: ['nema:ratios', 'nema:pan-sauces', 'nema:knife-skills'] })));
  const band = c => state.state.find(x => x.concept === c)?.bands;
  ok(band('nema:ratios')?.apply === 'uncertain' && (band('nema:pan-sauces')?.apply || 'unknown') === 'unknown', `bands: ratios.apply=${band('nema:ratios')?.apply} pan-sauces.apply=${band('nema:pan-sauces')?.apply} knife-skills.apply=${band('nema:knife-skills')?.apply}`);
  ok(JSON.stringify(state).includes('evidence') === false || !JSON.stringify(state).includes('receiptId'), 'learner state carries no receipt ids');

  // Consent flow: start the tool, approve in the page, collect the token.
  const req = { audience: H, purpose: 'personalize-pan-sauces-path', requirements: [
    { concept: 'nema:knife-skills', ability: 'apply' }, { concept: 'nema:heat-control', ability: 'explain' }, { concept: 'nema:ratios', ability: 'apply' } ] };
  await page.evaluate(`window.__p = ${tool('create_readiness_assertion', req)}; true`);
  await sleep(800);
  const modalVisible = await page.evaluate(`!document.getElementById('consent-modal').hidden`);
  ok(modalVisible, 'consent modal is shown');
  await page.shot('/tmp/nema-e2e-consent.png');
  await page.evaluate(`document.querySelector('[data-consent-approve]').click(); true`);
  const a = parse(await page.evaluate(`window.__p`));
  ok(a.status === 'approved' && typeof a.token === 'string' && a.token.startsWith('nema1.'), 'assertion approved: ' + a.status + ' shared=' + JSON.stringify(a.shared?.map(s => s.status)));
  const v = await proto.verifyAssertion(a.token, { audience: H, now: new Date().toISOString() });
  ok(v.ok && v.payload.assertions.length === 3 && Object.keys(v.payload).every(k => proto.ALLOWED_ASSERTION_KEYS.includes(k)), 'assertion verifies for the harness audience with only allowed keys: ' + (v.reason || 'ok'));
  const vWrong = await proto.verifyAssertion(a.token, { audience: 'http://localhost:8783', now: new Date().toISOString() });
  ok(!vWrong.ok && vWrong.reason === 'wrong-audience', 'assertion is audience bound: ' + vWrong.reason);
  const led = parse(await page.evaluate(tool('get_disclosure_ledger', {})));
  ok(led.disclosures?.length === 1 && led.disclosures[0].audience === H, 'disclosure ledger has the entry');

  // Denied consent
  await page.evaluate(`window.__d = ${tool('create_readiness_assertion', { ...req, purpose: 'second-ask' })}; true`);
  await sleep(600);
  await page.evaluate(`(document.querySelector('[data-consent-deny]') || document.querySelector('#consent-modal button.n-btn--secondary')).click(); true`);
  const d = parse(await page.evaluate(`window.__d`));
  ok(d.status === 'denied', 'denied consent returns denied: ' + d.status);

  // Receipt from the harness worker (diagnostic pass), then stage it.
  const diag = content.ACTIVITIES['ratios-diagnostic'];
  const learnerKeyId = v.payload.learnerKeyId;
  const res = await fetch(H + '/api/receipt', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ activityId: 'ratios-diagnostic', submission: { optionId: diag.content.answerKey, hintsUsed: 0 }, learnerKeyId, conditions: { attempts: 1, hintsUsed: 0, durationSeconds: 90 } }) });
  const issued = await res.json();
  ok(res.status === 200 && issued.status === 'issued' && issued.token, 'saucier worker issued a receipt: ' + res.status + ' ' + (issued.status || issued.error || ''));
  const staged = parse(await page.evaluate(tool('stage_evidence_receipt', { token: issued.token })));
  ok(staged.status === 'accepted' && staged.changes?.some(c => c.concept === 'nema:ratios' && c.ability === 'apply'), 'receipt accepted, ratios.apply moved: ' + JSON.stringify(staged.changes || staged).slice(0, 200));
  const replay = parse(await page.evaluate(tool('stage_evidence_receipt', { token: issued.token })));
  ok(replay.status === 'rejected' && replay.reason === 'duplicate', 'replay rejected: ' + replay.reason);
  const parts = issued.token.split('.');
  const tampered = parts[0] + '.' + parts[1].slice(0, -4) + 'AAAA' + '.' + parts[2];
  const bad = parse(await page.evaluate(tool('stage_evidence_receipt', { token: tampered })));
  ok(bad.status === 'rejected', 'tampered token rejected: ' + bad.reason);
  const unknown = await proto.signToken({ ...(proto.decodeToken(issued.token).payload), receiptId: 'rcpt_unknown_1', keyId: 'nobody-2026' }, (await (await import(REPO + '/shared/crypto.js')).generateKeyPair()).privateJwk);
  const pend = parse(await page.evaluate(tool('stage_evidence_receipt', { token: unknown })));
  ok(pend.status === 'pending' && pend.reason === 'unknown-issuer', 'unknown issuer stays pending: ' + pend.status + ' ' + pend.reason);
  const ev = parse(await page.evaluate(tool('get_evidence_ledger', { limit: 3 })));
  ok(ev.receipts?.length === 3 && ev.receipts.some(r => r.signature === 'pending'), 'evidence ledger lists the pending receipt');

  // Needs and an agent assessment
  const needs = parse(await page.evaluate(tool('get_learning_needs', { budgetMinutes: 5 })));
  ok(needs.status === 'ok' && needs.needs.length > 0 && needs.needs.every(n => n.rubric?.length > 0), `needs for 5 min: ${needs.needs.map(n => n.kind + ':' + n.concept.replace('nema:', '')).join(', ')}`);
  const n0 = needs.needs[0];
  const rec = parse(await page.evaluate(tool('record_agent_assessment', { needId: n0.needId, rubricResults: n0.rubric.map(c => ({ criterion: c, met: true })), learnerAnswerSummary: 'Learner answered every criterion in the chat.' })));
  ok(rec.status === 'accepted' && rec.result === 'passed', 'agent assessment recorded: ' + rec.status + ' ' + rec.result);
  const badNeed = parse(await page.evaluate(tool('record_agent_assessment', { needId: 'need_nope', rubricResults: [], learnerAnswerSummary: 'x' })));
  ok(badNeed.status !== 'accepted', 'unknown needId rejected: ' + badNeed.status);
  const goal = parse(await page.evaluate(tool('set_learning_goal', { title: 'Hold a pan sauce through service', concepts: ['nema:pan-sauces'] })));
  ok(goal.status === 'ok' && goal.goalId, 'goal set');

  // A page that installed the one tag: it signs with a key it made itself and
  // encloses the public half. Nothing listens on 9999, so the well known
  // lookup fails and the receipt stays at the self tier.
  const cryptoMod = await import(REPO + '/shared/crypto.js');
  const selfKey = await cryptoMod.generateKeyPair();
  const selfOrigin = 'http://localhost:9999';
  const selfToken = await proto.signToken(proto.buildReceiptPayload({
    issuer: selfOrigin, keyId: 'self:' + selfOrigin, issuerKey: selfKey.publicJwk, subject: learnerKeyId,
    activity: { id: 'check', version: '1.0.0', title: 'Two questions before you go' },
    claims: [{ concept: 'nema:bread-basics', ability: 'apply', evidenceType: 'application', result: 'passed', difficulty: 'intermediate' }],
    conditions: { attempts: 1, hintsUsed: 0, durationSeconds: 90, grader: 'deterministic', graderVersion: '1' }
  }), selfKey.privateJwk);
  const selfStaged = parse(await page.evaluate(tool('stage_evidence_receipt', { token: selfToken })));
  ok(selfStaged.status === 'accepted' && selfStaged.trust === 'self', 'self signed receipt accepted at the self tier: ' + selfStaged.status + ' ' + selfStaged.trust);
  ok((selfStaged.changes || []).length > 0 && selfStaged.changes.every(c => ['uncertain', 'fragile'].includes(c.to)), 'self certified evidence moves a band at most to fragile: ' + JSON.stringify(selfStaged.changes || []));
  const selfLedger = parse(await page.evaluate(tool('get_evidence_ledger', { limit: 1 })));
  ok(selfLedger.receipts?.[0]?.trust === 'self' && selfLedger.receipts[0].signature === 'verified', 'the ledger row carries the tier: ' + JSON.stringify(selfLedger.receipts?.[0]?.trust));
  // Contract section 26: the row says one word for what the vault could check,
  // and the tier, the grader and the receipt id are under the hood.
  const trustWord = await page.evaluate(`document.querySelector('[data-evidence-ledger] [data-state-word]')?.textContent || ''`);
  ok(trustWord === 'self issued', 'the ledger shows the state as one word: ' + JSON.stringify(trustWord));
  const rowText = await page.evaluate(`document.querySelector('[data-evidence-ledger]').textContent`);
  ok(!/rcpt_|nema1\.|self:http/.test(rowText), 'and no id, key or token is on the ledger rows');
  const underText = await page.evaluate(`document.querySelector('[data-evidence-under]').textContent`);
  ok(/rcpt_/.test(underText) && /grader/.test(underText), 'the block under the hood still has them: ' + underText.trim().slice(0, 80));
  // The forgery that matters: a readable receipt, someone else's key enclosed,
  // the original signature kept. The signature covers the key, so it fails.
  const decodedSelf = proto.decodeToken(selfToken);
  const impostorKey = await cryptoMod.generateKeyPair();
  const forgedSelf = proto.encodeToken({ ...decodedSelf.payload, receiptId: 'rcpt_forged_1', issuerKey: impostorKey.publicJwk }, decodedSelf.signature);
  const tamperedSelf = parse(await page.evaluate(tool('stage_evidence_receipt', { token: forgedSelf })));
  ok(tamperedSelf.status === 'rejected' && tamperedSelf.reason === 'bad-signature', 'tampered self signed receipt rejected: ' + tamperedSelf.status + ' ' + tamperedSelf.reason);

  // A site that names things its own way (contract section 23). The blog says
  // "browning-science"; the registry says nema:maillard-reaction. The receipt is
  // kept, moves nothing, and starts counting the moment the learner confirms
  // what the name means, with no second staging and no change to the ledger.
  const BLOG = 'http://localhost:8785';
  const blogKey = await cryptoMod.generateKeyPair();
  const bandsOf = async c => (parse(await page.evaluate(tool('get_learner_state', { concepts: [c] })))).state[0].bands;
  const beforeBands = await bandsOf('nema:maillard-reaction');
  const localToken = await proto.signToken(proto.buildReceiptPayload({
    issuer: BLOG, keyId: 'self:' + BLOG, issuerKey: blogKey.publicJwk, subject: learnerKeyId,
    activity: { id: 'check', version: '1.0.0', title: 'Two questions before you go' },
    claims: [{ concept: 'browning-science', ability: 'transfer', evidenceType: 'transfer', result: 'passed', difficulty: 'introductory' }],
    conditions: { attempts: 1, hintsUsed: 0, durationSeconds: 120, grader: 'deterministic', graderVersion: '1' }
  }), blogKey.privateJwk);
  const localStaged = parse(await page.evaluate(tool('stage_evidence_receipt', { token: localToken })));
  ok(localStaged.status === 'accepted' && JSON.stringify(localStaged.pendingAlignment) === '["browning-science"]' && (localStaged.changes || []).length === 0,
    'a receipt in the site own words is kept and moves nothing: ' + localStaged.status + ' pending=' + JSON.stringify(localStaged.pendingAlignment) + ' changes=' + (localStaged.changes || []).length);
  const pendingBands = await bandsOf('nema:maillard-reaction');
  ok(JSON.stringify(pendingBands) === JSON.stringify(beforeBands), 'nothing moved while the name is unaligned: ' + JSON.stringify(pendingBands));

  const proposed = parse(await page.evaluate(tool('propose_concept_alignment', {
    origin: BLOG, providerConcept: 'browning-science', concept: 'nema:maillard-reaction', relation: 'equivalent',
    rationale: 'The whole article is about the Maillard reaction under another name.' })));
  ok(proposed.status === 'proposed' && /^aln_/.test(proposed.alignmentId || ''), 'the agent proposes what the name means: ' + proposed.status);
  const stillPending = parse(await page.evaluate(tool('get_concept_alignments', { origin: BLOG })));
  ok(stillPending.alignments?.length === 1 && stillPending.alignments[0].status === 'proposed' && stillPending.alignments[0].proposedBy === 'agent',
    'and it waits for the learner: ' + JSON.stringify(stillPending.alignments?.[0]?.status));
  ok(JSON.stringify(await bandsOf('nema:maillard-reaction')) === JSON.stringify(beforeBands), 'proposing translates nothing on its own');

  // The learner confirms it. There is no tool for this click, on purpose.
  await page.shot('/tmp/nema-e2e-alignment.png');
  const clicked = await page.evaluate(`(() => { const b = document.querySelector('[data-confirm-alignment="${proposed.alignmentId}"]'); if (!b) return false; b.click(); return true; })()`);
  ok(clicked === true, 'the vault page offers a Confirm button for the proposal');
  await sleep(400);
  const afterBands = await bandsOf('nema:maillard-reaction');
  ok(afterBands.transfer !== beforeBands.transfer && afterBands.transfer !== 'unknown',
    'confirming moved the Maillard band: transfer ' + beforeBands.transfer + ' to ' + afterBands.transfer);
  const confirmed = parse(await page.evaluate(tool('get_concept_alignments', {})));
  ok(confirmed.alignments?.[0]?.status === 'confirmed' && confirmed.alignments[0].decidedAt, 'the alignment is confirmed and dated');
  const alignedLedger = parse(await page.evaluate(tool('get_evidence_ledger', { limit: 1 })));
  ok(alignedLedger.receipts?.[0]?.claims?.[0]?.concept === 'browning-science' && alignedLedger.receipts[0].claims[0].alignedTo === 'nema:maillard-reaction',
    'the ledger still says what the site said, and what it is read as: ' + JSON.stringify(alignedLedger.receipts?.[0]?.claims?.[0]));

  // The same thing with no agent in the room: the panel names the word that is
  // waiting and the learner says what it means themselves.
  const sugarToken = await proto.signToken(proto.buildReceiptPayload({
    issuer: BLOG, keyId: 'self:' + BLOG, issuerKey: blogKey.publicJwk, subject: learnerKeyId,
    activity: { id: 'check', version: '1.0.0', title: 'Two questions before you go' },
    claims: [{ concept: 'sugar-browning', ability: 'discriminate', evidenceType: 'discrimination', result: 'passed', difficulty: 'introductory' }],
    conditions: { attempts: 1, hintsUsed: 0, durationSeconds: 90, grader: 'deterministic', graderVersion: '1' }
  }), blogKey.privateJwk);
  const sugarStaged = parse(await page.evaluate(tool('stage_evidence_receipt', { token: sugarToken })));
  ok(JSON.stringify(sugarStaged.pendingAlignment) === '["sugar-browning"]', 'a second name waits: ' + JSON.stringify(sugarStaged.pendingAlignment));
  const waitingWord = await page.evaluate(`document.querySelector('[data-align-name] , .v-align--waiting')?.textContent.trim().slice(0, 60) || ''`);
  ok(waitingWord.length > 0, 'the alignments panel names the waiting word: ' + JSON.stringify(waitingWord));
  const beforeSugar = await bandsOf('nema:caramelization');
  await page.evaluate(`(() => {
    document.querySelector('[data-align-name="${BLOG}"][data-align-word="sugar-browning"]').click();
    const f = document.querySelector('[data-align-form]');
    f.elements.concept.value = 'nema:caramelization';
    f.requestSubmit();
    return true;
  })()`);
  await sleep(400);
  const afterSugar = await bandsOf('nema:caramelization');
  ok(afterSugar.discriminate !== beforeSugar.discriminate, 'aligning by hand moved the band: discriminate ' + beforeSugar.discriminate + ' to ' + afterSugar.discriminate);
  const byHand = parse(await page.evaluate(tool('get_concept_alignments', { origin: BLOG })));
  const learnerOwn = byHand.alignments.find(a => a.providerConcept === 'sugar-browning');
  ok(learnerOwn?.proposedBy === 'learner' && learnerOwn.status === 'confirmed', 'and it is recorded as the learner own word: ' + JSON.stringify([learnerOwn?.proposedBy, learnerOwn?.status]));

  // A self check: the learner answers their own review question, no agent.
  const selfNeeds = parse(await page.evaluate(tool('get_learning_needs', { budgetMinutes: 5 })));
  const ticked = await page.evaluate(`(() => {
    const box = document.querySelector('[data-self-check]');
    if (!box) return 'no checklist';
    for (const input of box.querySelectorAll('[data-check-criterion]')) input.checked = true;
    box.querySelector('[data-action="self-check"]').click();
    return box.getAttribute('data-self-check');
  })()`);
  ok(typeof ticked === 'string' && ticked.startsWith('need_') && selfNeeds.needs.some(n => n.needId === ticked),
    'the needs panel offers the first need as a checklist: ' + ticked);
  await sleep(400);
  const selfLedgerRow = parse(await page.evaluate(tool('get_evidence_ledger', { limit: 1 }))).receipts?.[0];
  ok(selfLedgerRow?.signature === 'self-check' && selfLedgerRow.grader === 'self-report',
    'the ledger labels it a self check at the self report weight: ' + JSON.stringify([selfLedgerRow?.signature, selfLedgerRow?.grader]));

  // Hand delivery: the same consent modal, driven from the page, no agent.
  await page.evaluate(`(() => {
    document.querySelector('#share-audience').value = ${JSON.stringify(H)};
    document.querySelector('#share-purpose').value = 'hand-delivered-path';
    document.querySelector('#share-concepts').value = 'nema:knife-skills:apply, nema:heat-control:explain, nema:ratios:apply';
    document.querySelector('[data-share-form]').requestSubmit();
    return true;
  })()`);
  await sleep(800);
  ok(await page.evaluate(`!document.getElementById('consent-modal').hidden`), 'the share form asks for consent in the same modal');
  await page.evaluate(`document.querySelector('[data-consent-approve]').click(); true`);
  await sleep(600);
  const handToken = await page.evaluate(`document.querySelector('[data-share-token]')?.textContent || ''`);
  const handVerified = await proto.verifyAssertion(handToken, { audience: H, now: new Date().toISOString() });
  ok(handVerified.ok && handVerified.payload.assertions.length === 3 && handVerified.payload.purpose === 'hand-delivered-path',
    'the hand delivered token verifies for the Saucier audience: ' + (handVerified.reason || handVerified.payload.assertions.map(a => a.status).join(',')));
  const handLedger = parse(await page.evaluate(tool('get_disclosure_ledger', {})));
  ok(handLedger.disclosures?.[0]?.purpose === 'hand-delivered-path', 'the hand delivered share is in the disclosure ledger');

  await page.shot('/tmp/nema-e2e-vault.png');
  ok(page.errors.length === 0, 'vault console errors: ' + JSON.stringify(page.errors));
} finally { await page.close(); }
