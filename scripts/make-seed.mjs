#!/usr/bin/env node
// nema: sign the demo learner's evidence into apps/vault/public/seed.json.
//
// The vault's "Load demo learner" button imports that file. Every receipt in it
// is a real signed nema token, issued by the offline "seed" key, so the vault
// verifies it through exactly the same code path as a receipt handed over by a
// provider. Nothing in the demo is fabricated at read time.
//
// Usage:
//   node scripts/make-seed.mjs [inputPath] [--example] [--out <outputPath>]
//
// Defaults: input shared/seed-evidence.json, output apps/vault/public/seed.json.
// A missing default input is an error, never a silent fallback: a rename or a
// typo must not ship an illustration in place of the real demo ledger. Pass
// --example to sign shared/seed-evidence.example.json on purpose, or name any
// other input path directly. Delete the example file once seed-evidence.json is
// the only ledger anyone runs.
//
// Output is deterministic apart from the ECDSA signatures, which are randomized
// by design. Receipt ids and timestamps are derived from the input, so rerunning
// the script never renumbers the ledger.

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildReceiptPayload, signToken, SEED_ORIGIN } from '../shared/protocol.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');

const DEFAULT_INPUT = path.join(ROOT, 'shared', 'seed-evidence.json');
const EXAMPLE_INPUT = path.join(ROOT, 'shared', 'seed-evidence.example.json');
const DEFAULT_OUTPUT = path.join(ROOT, 'apps', 'vault', 'public', 'seed.json');
const SECRETS = path.join(ROOT, 'secrets', 'issuer-private-keys.json');

const SUBJECT = 'lk_demo';
const DAY_MS = 24 * 60 * 60 * 1000;

function parseArgs(argv) {
  let input = null;
  let output = null;
  let example = false;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--out' || arg === '-o') {
      output = argv[i + 1];
      i += 1;
    } else if (arg.startsWith('--out=')) {
      output = arg.slice('--out='.length);
    } else if (arg === '--example') {
      example = true;
    } else if (arg === '--help' || arg === '-h') {
      return { help: true };
    } else if (!input) {
      input = arg;
    }
  }
  return { input, output, example, help: false };
}

function display(file) {
  const relative = path.relative(ROOT, file);
  return relative.startsWith('..') ? file : relative;
}

function usage() {
  return [
    'Usage: node scripts/make-seed.mjs [inputPath] [--example] [--out <outputPath>]',
    '',
    `  inputPath    default ${display(DEFAULT_INPUT)}`,
    `  --example    sign ${display(EXAMPLE_INPUT)} instead`,
    `  --out        default ${display(DEFAULT_OUTPUT)}`
  ].join('\n');
}

async function readJson(file) {
  return JSON.parse(await readFile(file, 'utf8'));
}

function requireField(value, what) {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`seed evidence: ${what} must be a non-empty string`);
  }
  return value;
}

function isoSecondsAt(baseMs, daysAgo) {
  const days = Number(daysAgo);
  if (!Number.isFinite(days) || days < 0) {
    throw new Error(`seed evidence: daysAgo must be a number of days, got ${daysAgo}`);
  }
  return new Date(baseMs - days * DAY_MS).toISOString().replace(/\.\d{3}Z$/, 'Z');
}

function receiptIdFor(index) {
  return `rcpt_seed_${String(index + 1).padStart(3, '0')}`;
}

function normalizeGoals(goals, generatedAt) {
  if (!Array.isArray(goals)) return [];
  return goals.map((goal, index) => ({
    goalId: goal.goalId || `goal_seed_${String(index + 1).padStart(2, '0')}`,
    title: requireField(goal.title, `goals[${index}].title`),
    concepts: Array.isArray(goal.concepts) ? goal.concepts.slice() : [],
    createdAt: goal.createdAt || generatedAt
  }));
}

function normalizeMisconceptions(misconceptions, generatedAt) {
  if (!Array.isArray(misconceptions)) return [];
  return misconceptions.map((entry, index) => ({
    concept: requireField(entry.concept, `misconceptions[${index}].concept`),
    id: requireField(entry.id, `misconceptions[${index}].id`),
    text: requireField(entry.text, `misconceptions[${index}].text`),
    recordedAt: entry.recordedAt || generatedAt
  }));
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    process.stdout.write(`${usage()}\n`);
    return;
  }

  if (args.input && args.example) {
    throw new Error('pass either an input path or --example, not both');
  }

  let inputPath = DEFAULT_INPUT;
  if (args.input) inputPath = path.resolve(process.cwd(), args.input);
  else if (args.example) inputPath = EXAMPLE_INPUT;

  if (!existsSync(inputPath)) {
    if (inputPath === DEFAULT_INPUT) {
      throw new Error(
        `${display(DEFAULT_INPUT)} not found. Write it, or pass --example to sign ` +
          `${display(EXAMPLE_INPUT)} on purpose.`
      );
    }
    throw new Error(`seed evidence not found: ${display(inputPath)}`);
  }
  if (inputPath === EXAMPLE_INPUT) {
    process.stdout.write(`note: signing the illustration at ${display(EXAMPLE_INPUT)}\n`);
  }
  const outputPath = args.output ? path.resolve(process.cwd(), args.output) : DEFAULT_OUTPUT;

  if (!existsSync(SECRETS)) {
    throw new Error(
      `missing ${display(SECRETS)}. It is gitignored: generate the issuer keys first.`
    );
  }

  const [evidence, secrets] = await Promise.all([readJson(inputPath), readJson(SECRETS)]);

  const seedKey = secrets.seed;
  if (!seedKey || !seedKey.kid || !seedKey.jwk || !seedKey.jwk.d) {
    throw new Error('secrets/issuer-private-keys.json has no usable "seed" private key');
  }

  const generatedAt = requireField(evidence.baseDate, 'baseDate');
  const baseMs = new Date(generatedAt).getTime();
  if (!Number.isFinite(baseMs)) {
    throw new Error(`seed evidence: baseDate is not a date: ${generatedAt}`);
  }

  const sourceReceipts = Array.isArray(evidence.receipts) ? evidence.receipts : [];
  if (sourceReceipts.length === 0) {
    throw new Error('seed evidence: receipts must be a non-empty array');
  }

  const tokens = [];
  for (let index = 0; index < sourceReceipts.length; index += 1) {
    const source = sourceReceipts[index];
    const payload = buildReceiptPayload({
      issuer: SEED_ORIGIN,
      keyId: seedKey.kid,
      subject: source.subject || SUBJECT,
      activity: source.activity,
      claims: source.claims,
      conditions: source.conditions,
      now: isoSecondsAt(baseMs, source.daysAgo),
      receiptId: source.receiptId || receiptIdFor(index)
    });
    tokens.push(await signToken(payload, seedKey.jwk));
  }

  const seed = {
    generatedAt,
    goals: normalizeGoals(evidence.goals, generatedAt),
    misconceptions: normalizeMisconceptions(evidence.misconceptions, generatedAt),
    receipts: tokens
  };

  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(seed, null, 2)}\n`, 'utf8');

  const longest = tokens.reduce((max, token) => Math.max(max, token.length), 0);
  process.stdout.write(
    `wrote ${display(outputPath)}: ${tokens.length} signed receipts, ` +
      `${seed.goals.length} goals, ${seed.misconceptions.length} misconceptions, ` +
      `longest token ${longest} chars\n`
  );
}

main().catch((error) => {
  process.stderr.write(`make-seed failed: ${error.message}\n`);
  process.exitCode = 1;
});
