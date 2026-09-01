// Golden path, provider half, on native WebMCP (Chrome for Testing canary).
// Usage: CHROME=<path to a Chrome with WebMCP, e.g. Chrome for Testing canary> node scripts/e2e/golden-providers.mjs [harnessOrigin] [securityOrigin]
// Install a suitable Chrome with: npx --yes @puppeteer/browsers install chrome@canary --path .chrome (gitignored)
import { launch, tool } from './cdp.mjs';
import { fileURLToPath } from 'node:url';
const REPO = fileURLToPath(new URL('../..', import.meta.url)).replace(/\/$/, '');
const [H = 'http://localhost:8782', SEC = 'http://localhost:8783'] = process.argv.slice(2);
const bin = process.env.CHROME;
if (!bin) { console.error('set CHROME to a Chrome binary with native WebMCP (see header)'); process.exit(2); }
const proto = await import(REPO + '/shared/protocol.js');
const crypto = await import(REPO + '/shared/crypto.js');
const { publicJwk, privateJwk } = await crypto.generateKeyPair();
const now = new Date().toISOString();
async function assertion(audience, purpose, statuses) {
  const request = proto.buildReadinessRequest({ audience, purpose, requirements: Object.keys(statuses).map(k => ({ concept: k.split('|')[0], ability: k.split('|')[1] })) });
  const payload = await proto.buildAssertionPayload({ request, statuses: Object.entries(statuses).map(([k, status]) => ({ concept: k.split('|')[0], ability: k.split('|')[1], status, confidence: status === 'verified' ? 'high' : status === 'uncertain' ? 'medium' : 'low' })), vaultPublicJwk: publicJwk, now, ttlMinutes: 30 });
  return proto.signToken(payload, privateJwk);
}
const parse = s => JSON.parse(s);
const ok = (cond, msg) => { console.log((cond ? 'PASS ' : 'FAIL ') + msg); if (!cond) process.exitCode = 1; };
const page = await launch(bin);
try {
  // Harness: full path, then personalised path (seed state), then after diagnostic
  await page.goto(H + '/');
  const offer = parse(await page.evaluate(tool('describe_learning_offer', {})));
  ok(offer.status === 'ok' && offer.manifest?.unit?.id === 'agent-evals-foundations', 'harness describe_learning_offer ' + offer.manifest?.unit?.title);
  const seedStatuses = { 'nema:software-testing|apply': 'verified', 'nema:agent-loop|explain': 'verified', 'nema:json-schema|apply': 'uncertain' };
  const t1 = await assertion(H, 'personalize-agent-evals-path', seedStatuses);
  const p1 = parse(await page.evaluate(tool('personalize_learning_path', { assertionToken: t1 })));
  ok(p1.status === 'personalized' && p1.fullMinutes === 68 && p1.personalMinutes === 27, `harness personalize seed state: ${p1.status} ${p1.fullMinutes} -> ${p1.personalMinutes}`);
  const t2 = await assertion(H, 'personalize-agent-evals-path', { ...seedStatuses, 'nema:json-schema|apply': 'verified' });
  const p2 = parse(await page.evaluate(tool('personalize_learning_path', { assertionToken: t2 })));
  ok(p2.status === 'personalized' && p2.personalMinutes === 21, `harness personalize after diagnostic: ${p2.personalMinutes}`);
  const wrong = await assertion(SEC, 'personalize-agent-evals-path', seedStatuses);
  const p3 = parse(await page.evaluate(tool('personalize_learning_path', { assertionToken: wrong })));
  ok(p3.status === 'rejected' && p3.reason === 'wrong-audience', 'harness rejects wrong audience: ' + p3.reason);
  const st = parse(await page.evaluate(tool('get_attempt_status', { activityId: 'eval-design-lab' })));
  ok(['not_started', 'in_progress', 'passed', 'failed'].includes(st.status), 'harness get_attempt_status ' + st.status);
  const s1 = parse(await page.evaluate(tool('start_activity', { activityId: 'json-schema-diagnostic' })));
  ok(s1.status === 'started', 'harness start_activity diagnostic');
  const r0 = parse(await page.evaluate(tool('issue_evidence_receipt', { activityId: 'json-schema-diagnostic' })));
  ok(r0.status === 'not-passed', 'harness issue before pass -> ' + r0.status);
  await page.shot('/tmp/nema-e2e-harness.png');
  ok(page.errors.length === 0, 'harness console errors: ' + JSON.stringify(page.errors));

  // Security
  await page.goto(SEC + '/');
  const offer2 = parse(await page.evaluate(tool('describe_learning_offer', {})));
  ok(offer2.manifest?.unit?.id === 'feedback-loop-attack-surface', 'security describe_learning_offer ' + offer2.manifest?.unit?.title);
  const secStatuses = { 'nema:tool-calling|explain': 'verified', 'nema:threat-modeling|apply': 'verified', 'nema:feedback-loops|explain': 'uncertain' };
  const t3 = await assertion(SEC, 'unlock-feedback-loop-labs', secStatuses);
  const c1 = parse(await page.evaluate(tool('check_prerequisites', { assertionToken: t3 })));
  ok(c1.status === 'checked' && c1.unlocked?.includes('injection-triage-advanced') && c1.recommendedFirst === 'feedback-loop-attack-surface', `security unlock: ${JSON.stringify(c1.unlocked)} first=${c1.recommendedFirst}`);
  const t4 = await assertion(SEC, 'unlock-feedback-loop-labs', { ...secStatuses, 'nema:feedback-loops|explain': 'missing' });
  const c2 = parse(await page.evaluate(tool('check_prerequisites', { assertionToken: t4 })));
  ok(c2.status === 'checked' && c2.locked?.length === 2, 'security locks both labs when feedback-loops missing: ' + JSON.stringify(c2.locked?.map(l => l.activityId)));
  await page.shot('/tmp/nema-e2e-security.png');
  ok(page.errors.length === 0, 'security console errors: ' + JSON.stringify(page.errors));
} finally { await page.close(); }
