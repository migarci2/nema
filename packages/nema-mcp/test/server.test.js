import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { ElicitRequestSchema } from '@modelcontextprotocol/sdk/types.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '../../..');
const BIN = path.join(HERE, '..', 'bin.mjs');
const proto = await import(path.join(REPO, 'shared/protocol.js'));
const HARNESS = 'https://saucier.migarci2.dev';
const NINE = ['create_readiness_assertion', 'get_disclosure_ledger', 'get_evidence_ledger', 'get_learner_state', 'get_learning_needs', 'get_vault_summary', 'record_agent_assessment', 'set_learning_goal', 'stage_evidence_receipt'];

function tmpFile() {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'nema-mcp-')), 'vault.json');
}

async function connect(file, { elicit } = {}) {
  const client = new Client({ name: 'nema-mcp-test', version: '0.0.0' }, { capabilities: elicit ? { elicitation: {} } : {} });
  if (elicit) client.setRequestHandler(ElicitRequestSchema, async (req) => elicit(req.params));
  const transport = new StdioClientTransport({ command: process.execPath, args: [BIN, 'serve'], env: { ...process.env, NEMA_VAULT_FILE: file }, stderr: 'pipe' });
  await client.connect(transport);
  return client;
}

const parse = (res) => JSON.parse(res.content[0].text);

test('lists exactly the nine vault tools with JSON schemas', async () => {
  const client = await connect(tmpFile());
  try {
    const { tools } = await client.listTools();
    assert.deepEqual(tools.map((t) => t.name).sort(), NINE);
    for (const t of tools) assert.equal(t.inputSchema.type, 'object');
  } finally { await client.close(); }
});

test('fresh vault, then the demo seed, then bands for the story concepts', async () => {
  const file = tmpFile();
  let client = await connect(file);
  try {
    const empty = parse(await client.callTool({ name: 'get_vault_summary', arguments: {} }));
    assert.equal(empty.receipts, 0);
  } finally { await client.close(); }
  const { execFileSync } = await import('node:child_process');
  execFileSync(process.execPath, [BIN, 'seed'], { env: { ...process.env, NEMA_VAULT_FILE: file } });
  client = await connect(file);
  try {
    const sum = parse(await client.callTool({ name: 'get_vault_summary', arguments: {} }));
    assert.ok(sum.receipts >= 40, 'seed receipts loaded');
    assert.equal(sum.fragile, 7);
    const st = parse(await client.callTool({ name: 'get_learner_state', arguments: { concepts: ['nema:ratios', 'nema:pan-sauces'] } }));
    const band = (c) => st.state.find((x) => x.concept === c).bands;
    assert.equal(band('nema:ratios').apply, 'uncertain');
    assert.equal(band('nema:pan-sauces').apply, 'unknown');
    assert.ok(!JSON.stringify(st).includes('receiptId'), 'no evidence history in state');
  } finally { await client.close(); }
});

test('consent: denied without elicitation or policy, approved through elicitation, audience bound', async () => {
  const file = tmpFile();
  const args = { audience: HARNESS, purpose: 'personalize-pan-sauces-path', requirements: [{ concept: 'nema:knife-skills', ability: 'apply' }] };
  let client = await connect(file);
  try {
    const denied = parse(await client.callTool({ name: 'create_readiness_assertion', arguments: args }));
    assert.equal(denied.status, 'denied');
    assert.match(denied.hint, /nema-mcp approve/);
  } finally { await client.close(); }
  let seen = null;
  client = await connect(file, { elicit: async (params) => { seen = params; return { action: 'accept', content: { approve: true, autoApprove: false } }; } });
  try {
    const approved = parse(await client.callTool({ name: 'create_readiness_assertion', arguments: args }));
    assert.equal(approved.status, 'approved');
    assert.match(seen.message, /asks to know 1 status band/);
    assert.match(seen.message, /Not shared: attempt history/);
    const v = await proto.verifyAssertion(approved.token, { audience: HARNESS, now: new Date().toISOString() });
    assert.equal(v.ok, true);
    assert.equal(v.payload.assertions.length, 1);
    const wrong = await proto.verifyAssertion(approved.token, { audience: 'https://linecook.migarci2.dev', now: new Date().toISOString() });
    assert.equal(wrong.reason, 'wrong-audience');
    const declined = parse(await client.callTool({ name: 'create_readiness_assertion', arguments: { ...args, purpose: 'again' } }));
    assert.equal(declined.status, 'approved');
  } finally { await client.close(); }
  client = await connect(file, { elicit: async () => ({ action: 'decline' }) });
  try {
    const declined = parse(await client.callTool({ name: 'create_readiness_assertion', arguments: { ...args, purpose: 'third' } }));
    assert.equal(declined.status, 'denied');
    const ledger = parse(await client.callTool({ name: 'get_disclosure_ledger', arguments: {} }));
    assert.equal(ledger.disclosures.length, 2);
  } finally { await client.close(); }
});

test('pre-approval policy from the CLI approves without elicitation', async () => {
  const file = tmpFile();
  const { execFileSync } = await import('node:child_process');
  execFileSync(process.execPath, [BIN, 'approve', HARNESS, '--hours', '1'], { env: { ...process.env, NEMA_VAULT_FILE: file } });
  const client = await connect(file);
  try {
    const r = parse(await client.callTool({ name: 'create_readiness_assertion', arguments: { audience: HARNESS, purpose: 'p', requirements: [{ concept: 'nema:heat-control', ability: 'explain' }] } }));
    assert.equal(r.status, 'approved');
  } finally { await client.close(); }
});

test('stages a receipt signed by the harness key, rejects a replay', { skip: !fs.existsSync(path.join(REPO, 'secrets/issuer-private-keys.json')) && 'no issuer secrets on this machine' }, async () => {
  const keys = JSON.parse(fs.readFileSync(path.join(REPO, 'secrets/issuer-private-keys.json'), 'utf8'));
  const payload = proto.buildReceiptPayload({
    issuer: HARNESS, keyId: keys.harness.kid, subject: 'lk_test',
    activity: { id: 'ratios-diagnostic', version: '1.0.0', title: 'Which ratio holds', contentHash: 'sha256:0' },
    claims: [{ concept: 'nema:ratios', ability: 'apply', evidenceType: 'application', result: 'passed', difficulty: 'intermediate' }],
    conditions: { attempts: 1, hintsUsed: 0, durationSeconds: 60, grader: 'deterministic', graderVersion: '1' },
    now: new Date()
  });
  const token = await proto.signToken(payload, keys.harness.jwk);
  const client = await connect(tmpFile());
  try {
    const r = parse(await client.callTool({ name: 'stage_evidence_receipt', arguments: { token } }));
    assert.equal(r.status, 'accepted');
    assert.ok(r.changes.some((c) => c.concept === 'nema:ratios' && c.ability === 'apply'));
    const again = parse(await client.callTool({ name: 'stage_evidence_receipt', arguments: { token } }));
    assert.equal(again.reason, 'duplicate');
  } finally { await client.close(); }
});

test('merge is a union by receipt id and idempotent', async () => {
  const a = tmpFile();
  const { execFileSync } = await import('node:child_process');
  const env = { ...process.env, NEMA_VAULT_FILE: a };
  execFileSync(process.execPath, [BIN, 'seed'], { env });
  const exp = path.join(path.dirname(a), 'export.json');
  execFileSync(process.execPath, [BIN, 'export', exp], { env });
  const b = tmpFile();
  const out1 = execFileSync(process.execPath, [BIN, 'merge', exp], { env: { ...process.env, NEMA_VAULT_FILE: b } }).toString();
  const out2 = execFileSync(process.execPath, [BIN, 'merge', exp], { env: { ...process.env, NEMA_VAULT_FILE: b } }).toString();
  assert.match(out1, /0 -> 46 receipts/);
  assert.match(out2, /46 -> 46 receipts/);
});
