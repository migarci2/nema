/**
 * nema provider worker: Agent Security.
 *
 * Two endpoints in front of the static assets (contract section 10):
 *
 *   POST /api/receipt   re-grades the submission with the same grade() the page
 *                       used, refuses to sign a failed attempt, then builds and
 *                       signs an EvidenceReceipt with ISSUER_PRIVATE_JWK.
 *   GET  /api/manifest  returns the LearningManifest, handy for judges and curl.
 *   GET  /api/health    liveness probe used by the deploy pipeline.
 *
 * Everything else falls through to the assets binding.
 *
 * The re-grade is the point. The browser can send any submission it likes, but
 * the claims inside a receipt are produced here, from the answer key, on the
 * origin whose key signs the token. A page that lies about passing gets a 422.
 * The grader name and version are taken from the content module, never from the
 * request, so a caller cannot dress a self report up as deterministic grading.
 */

import { ACTIVITIES, CONTENT_HASH_INPUT, GRADER_VERSION, MANIFEST, grade } from './public/content.js';
import { buildReceiptPayload, signToken, sha256 } from '../../shared/protocol.js';
import { originFor } from '../../shared/origins.js';

const APP = 'security';

const JSON_HEADERS = { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' };

function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

/* The two origins this worker is ever allowed to sign as: the deployed custom
 * domain and the local dev server. Nothing a caller sends can select between
 * them any more. The issuer comes from the deployment: the `ISSUER_ORIGIN`
 * binding when one is configured, then the origin this worker was actually
 * reached on, and ALLOWED_ISSUERS stays as the guard so a misconfigured binding
 * falls back to the production identity instead of signing for a stranger. */
const PROD_ISSUER = originFor(APP, 'prod');
const DEV_ISSUER = originFor(APP, 'dev');
const ALLOWED_ISSUERS = [PROD_ISSUER, DEV_ISSUER];

function issuerOrigin(request, env) {
  const bound = env && typeof env.ISSUER_ORIGIN === 'string' ? env.ISSUER_ORIGIN : '';
  if (ALLOWED_ISSUERS.includes(bound)) return bound;

  const url = new URL(request.url);
  if (ALLOWED_ISSUERS.includes(url.origin)) return url.origin;

  /* `wrangler dev --local` rewrites the request URL to the routed hostname but
   * keeps the plain http scheme it really served on, while the deployed worker
   * only ever answers over TLS. With the request body and the Origin header out
   * of the decision, the scheme is the one signal left that comes from the
   * deployment rather than from whoever is calling. */
  if (url.protocol === 'http:') return DEV_ISSUER;
  return PROD_ISSUER;
}

function readSecret(env) {
  if (!env || typeof env.ISSUER_PRIVATE_JWK !== 'string' || env.ISSUER_PRIVATE_JWK === '') {
    throw new Error('ISSUER_PRIVATE_JWK is not configured for this worker');
  }
  const parsed = JSON.parse(env.ISSUER_PRIVATE_JWK);
  if (!parsed || typeof parsed.kid !== 'string' || !parsed.jwk) {
    throw new Error('ISSUER_PRIVATE_JWK must be {"kid":"...","jwk":{...}}');
  }
  return parsed;
}

/** Learner reported counters. Clamped, never trusted for anything but display. */
function counter(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) return 0;
  return Math.min(Math.round(number), 100000);
}

async function issueReceipt(request, env) {
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ status: 'rejected', reason: 'malformed-json' }, 400);
  }

  const activityId = body && typeof body.activityId === 'string' ? body.activityId : '';
  const activity = ACTIVITIES[activityId];
  if (!activity) {
    return json({ status: 'rejected', reason: 'unknown-activity', activityId }, 400);
  }

  const subject = body && typeof body.learnerKeyId === 'string' ? body.learnerKeyId.trim() : '';
  if (!subject) {
    return json({ status: 'rejected', reason: 'missing-learner-key' }, 400);
  }

  const result = grade(activityId, body ? body.submission : null);
  if (result.result === 'failed' || result.claims.length === 0) {
    return json({ status: 'not-passed', activityId, result: result.result, feedback: result.feedback }, 422);
  }

  let secret;
  try {
    secret = readSecret(env);
  } catch (error) {
    return json({ status: 'error', reason: 'issuer-key-unavailable', message: error.message }, 500);
  }

  const conditions = body && body.conditions && typeof body.conditions === 'object' ? body.conditions : {};

  let payload;
  try {
    payload = buildReceiptPayload({
      issuer: issuerOrigin(request, env),
      keyId: secret.kid,
      subject,
      activity: {
        id: activity.id,
        version: activity.version,
        title: activity.title,
        contentHash: await sha256(CONTENT_HASH_INPUT)
      },
      claims: result.claims,
      conditions: {
        attempts: counter(conditions.attempts) || 1,
        hintsUsed: counter(conditions.hintsUsed),
        durationSeconds: counter(conditions.durationSeconds),
        grader: activity.grader,
        graderVersion: GRADER_VERSION
      }
    });
  } catch (error) {
    return json({ status: 'error', reason: 'receipt-build-failed', message: error.message }, 500);
  }

  const token = await signToken(payload, secret.jwk);
  return json({ status: 'issued', token, payload });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === '/api/receipt') {
      if (request.method !== 'POST') {
        return json({ status: 'rejected', reason: 'method-not-allowed' }, 405);
      }
      return issueReceipt(request, env);
    }

    if (url.pathname === '/api/manifest') {
      if (request.method !== 'GET' && request.method !== 'HEAD') {
        return json({ status: 'rejected', reason: 'method-not-allowed' }, 405);
      }
      return json(MANIFEST);
    }

    if (request.method === 'GET' && url.pathname === '/api/health') {
      return json({ status: 'ok', app: APP, issuer: issuerOrigin(request, env), issuers: ALLOWED_ISSUERS });
    }

    return env.ASSETS.fetch(request);
  }
};
