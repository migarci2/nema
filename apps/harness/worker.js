/**
 * nema saucier worker: the Saucier School provider API.
 *
 * Contract section 10. Two endpoints, everything else falls through to the
 * static assets:
 *
 *   POST /api/receipt   { activityId, submission, learnerKeyId, conditions }
 *                       Re-grades the submission with the same grader the page
 *                       used, refuses to sign a failed one, and returns a
 *                       signed EvidenceReceipt.
 *   GET  /api/manifest  the LearningManifest, unsigned, for judges and curl.
 *
 * The re-grade is the point. The browser sends what the learner did, never a
 * result, so no page script and no agent can talk a receipt into existence.
 *
 * The signing key comes from the secret ISSUER_PRIVATE_JWK, a JSON string
 * shaped { kid, jwk }. In `wrangler dev` it is read from apps/harness/.dev.vars.
 */

import { ACTIVITIES, CONTENT_HASH_INPUT, MANIFEST, grade } from './public/content.js';
import { buildReceiptPayload, sha256, signToken } from '../../shared/protocol.js';

/**
 * The issuer is always the production origin, even when the worker runs on
 * localhost. A receipt is verified against `shared/issuers.json` joined with
 * the origin table, and the vault keys that registry by the provider's public
 * origin, so a receipt signed as "http://localhost:8782" would be an unknown
 * issuer everywhere except one developer's machine.
 */
const ISSUER_ORIGIN = 'https://saucier.migarci2.dev';

/** Bumped whenever a grader in content.js changes its verdict for old work. */
const GRADER_VERSION = '1';

/** sha256(CONTENT_HASH_INPUT) is stable for the lifetime of the isolate. */
let contentHashPromise = null;

function contentHash() {
  if (!contentHashPromise) contentHashPromise = sha256(CONTENT_HASH_INPUT);
  return contentHashPromise;
}

function json(body, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      ...extraHeaders
    }
  });
}

function isObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Only the three numeric conditions the contract names travel from the page. */
function readConditions(input, grader) {
  const out = {};
  if (isObject(input)) {
    for (const key of ['attempts', 'hintsUsed', 'durationSeconds']) {
      const value = input[key];
      if (typeof value === 'number' && Number.isFinite(value) && value >= 0) {
        out[key] = Math.round(value);
      }
    }
  }
  out.grader = grader;
  out.graderVersion = GRADER_VERSION;
  return out;
}

function readSigningKey(env) {
  const raw = env && env.ISSUER_PRIVATE_JWK;
  if (typeof raw !== 'string' || raw.trim() === '') {
    throw new Error('ISSUER_PRIVATE_JWK is not set on this worker');
  }
  const parsed = JSON.parse(raw);
  if (!isObject(parsed) || typeof parsed.kid !== 'string' || !isObject(parsed.jwk)) {
    throw new Error('ISSUER_PRIVATE_JWK must be JSON shaped { kid, jwk }');
  }
  return parsed;
}

async function issueReceipt(request, env) {
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ status: 'rejected', reason: 'malformed-body' }, 400);
  }
  if (!isObject(body)) {
    return json({ status: 'rejected', reason: 'malformed-body' }, 400);
  }

  const activity = ACTIVITIES[body.activityId];
  if (!activity) {
    return json(
      { status: 'rejected', reason: 'unknown-activity', activityId: String(body.activityId ?? '') },
      404
    );
  }

  const graded = grade(activity.id, body.submission);
  if (graded.result === 'failed' || graded.claims.length === 0) {
    return json(
      {
        status: 'not-passed',
        activityId: activity.id,
        result: graded.result,
        feedback: graded.feedback
      },
      422
    );
  }

  let key;
  try {
    key = readSigningKey(env);
  } catch (err) {
    return json({ status: 'error', reason: 'issuer-key-unavailable', message: err.message }, 500);
  }

  const subject =
    typeof body.learnerKeyId === 'string' && body.learnerKeyId.trim() !== ''
      ? body.learnerKeyId.trim()
      : 'anonymous';

  const payload = buildReceiptPayload({
    issuer: ISSUER_ORIGIN,
    keyId: key.kid,
    subject,
    activity: {
      id: activity.id,
      version: activity.version,
      title: activity.title,
      contentHash: await contentHash()
    },
    claims: graded.claims,
    conditions: readConditions(body.conditions, activity.grader)
  });

  const token = await signToken(payload, key.jwk);
  return json({ status: 'issued', token, payload });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === '/api/health') {
      return json({ status: 'ok', app: 'harness', issuer: ISSUER_ORIGIN });
    }

    if (url.pathname === '/api/manifest') {
      if (request.method !== 'GET' && request.method !== 'HEAD') {
        return json({ status: 'rejected', reason: 'method-not-allowed' }, 405, { allow: 'GET' });
      }
      return json(MANIFEST, 200, { 'access-control-allow-origin': '*' });
    }

    if (url.pathname === '/api/receipt') {
      if (request.method !== 'POST') {
        return json({ status: 'rejected', reason: 'method-not-allowed' }, 405, { allow: 'POST' });
      }
      try {
        return await issueReceipt(request, env);
      } catch (err) {
        return json({ status: 'error', reason: 'receipt-failed', message: String(err && err.message ? err.message : err) }, 500);
      }
    }

    if (url.pathname.startsWith('/api/')) {
      return json({ status: 'rejected', reason: 'unknown-endpoint' }, 404);
    }

    return env.ASSETS.fetch(request);
  }
};
