/**
 * The connect handshake, pure half (contract section 25).
 *
 * `shared/vault-link.js` is what a site imports to talk to a vault: it builds
 * the URL the popup opens, and it reads the one message that comes back. Both
 * halves are pure, and both are the security boundary of the site side, so
 * they are tested here rather than only in the browser.
 *
 * The browser half (window.open, the closed poll) is exercised end to end by
 * `scripts/e2e/golden-connect.mjs` against real Chrome.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import {
  ASSERTION_MESSAGE,
  RECEIPT_MESSAGE,
  CONNECT_PATH,
  DEFAULT_VAULT,
  POPUP_BLOCKED_MESSAGE,
  connectUrl,
  decodeRequest,
  describeChanges,
  describeFailure,
  encodeRequest,
  isOrigin,
  isPending,
  readVaultMessage,
  receiptUrl,
  trimOrigin,
  vaultLinkError
} from '../shared/vault-link.js';

import { parseManifest, readinessRequestFor } from '../shared/provider-embed.js';
import { buildReadinessRequest } from '../shared/protocol.js';

const VAULT = 'http://localhost:8781';
const SITE = 'http://localhost:8782';
const BLOG = 'http://localhost:8785';

const REQUEST = {
  protocol: 'nema/0.1',
  audience: SITE,
  purpose: 'personalize-pan-sauces-path',
  requirements: [
    { concept: 'nema:knife-skills', ability: 'apply' },
    { concept: 'nema:heat-control', ability: 'explain' }
  ]
};

/** The hash the vault's connect page reads, parsed the way that page parses it. */
function hashParams(url) {
  return new URLSearchParams(new URL(url).hash.replace(/^#/, ''));
}

// ---------------------------------------------------------------------------
// encoding
// ---------------------------------------------------------------------------

test('a request survives the trip through the address bar unchanged', () => {
  const encoded = encodeRequest(REQUEST);
  assert.match(encoded, /^[A-Za-z0-9_-]+$/, 'the encoding must be b64url, with nothing to escape');
  assert.deepEqual(decodeRequest(encoded), REQUEST);
});

test('the encoding is UTF-8, so a purpose in any language arrives intact', () => {
  const request = { ...REQUEST, purpose: 'personalizar-salsas-crème-brûlée-café' };
  assert.equal(decodeRequest(encodeRequest(request)).purpose, request.purpose);
});

test('a request the protocol built encodes and decodes to the same object', () => {
  const built = buildReadinessRequest({
    audience: SITE,
    purpose: 'personalize-pan-sauces-path',
    requirements: [{ concept: 'nema:ratios', ability: 'apply' }]
  });
  assert.deepEqual(decodeRequest(encodeRequest(built)), built);
});

test('anything that is not a b64url JSON object is refused, not guessed at', () => {
  assert.throws(() => decodeRequest('not base64 at all !!'));
  assert.throws(() => decodeRequest(encodeRequest([1, 2, 3])), /JSON object/);
  assert.throws(() => decodeRequest(encodeRequest('a string')), /JSON object/);
  assert.throws(() => decodeRequest(''));
});

// ---------------------------------------------------------------------------
// the URLs the popup opens
// ---------------------------------------------------------------------------

test('the connect URL carries the request and the return origin in the hash', () => {
  const url = connectUrl({ vault: VAULT, request: REQUEST, returnOrigin: SITE });
  assert.equal(url.split('#')[0], `${VAULT}${CONNECT_PATH}`);
  const params = hashParams(url);
  assert.deepEqual(decodeRequest(params.get('request')), REQUEST);
  assert.equal(params.get('return'), SITE);
  assert.equal(params.get('receipt'), null);
});

test('the receipt URL carries the token and the return origin in the hash', () => {
  const token = 'nema1.eyJ0eXBlIjoiZXZpZGVuY2UtcmVjZWlwdCJ9.c2ln';
  const url = receiptUrl({ vault: VAULT, token, returnOrigin: SITE });
  const params = hashParams(url);
  assert.equal(params.get('receipt'), token);
  assert.equal(params.get('return'), SITE);
  assert.equal(params.get('request'), null);
});

test('a vault origin with a trailing slash builds the same URL as one without', () => {
  assert.equal(
    connectUrl({ vault: `${VAULT}/`, request: REQUEST, returnOrigin: `${SITE}/` }),
    connectUrl({ vault: VAULT, request: REQUEST, returnOrigin: SITE })
  );
});

test('a site that names no vault gets the nema vault', () => {
  assert.ok(connectUrl({ request: REQUEST, returnOrigin: SITE }).startsWith(`${DEFAULT_VAULT}${CONNECT_PATH}`));
  assert.equal(DEFAULT_VAULT, 'https://nema-vault.migarci2.dev');
});

test('the audience and the return origin are the same string, which is what the vault checks', () => {
  const url = connectUrl({ vault: VAULT, request: REQUEST, returnOrigin: SITE });
  const params = hashParams(url);
  assert.equal(decodeRequest(params.get('request')).audience, params.get('return'));
});

// ---------------------------------------------------------------------------
// origins
// ---------------------------------------------------------------------------

test('an origin is a scheme and a host and nothing else', () => {
  assert.equal(isOrigin('https://nema-vault.migarci2.dev'), true);
  assert.equal(isOrigin('http://localhost:8781'), true);
  assert.equal(isOrigin('http://localhost:8781/'), true, 'a trailing slash is trimmed first');
  assert.equal(isOrigin('http://localhost:8781/connect.html'), false);
  assert.equal(isOrigin('javascript:alert(1)'), false);
  assert.equal(isOrigin('file:///etc/passwd'), false);
  assert.equal(isOrigin('nema-vault.migarci2.dev'), false);
  assert.equal(isOrigin(''), false);
  assert.equal(isOrigin(null), false);
});

test('trimOrigin produces exactly what event.origin looks like', () => {
  assert.equal(trimOrigin('https://example.com/'), 'https://example.com');
  assert.equal(trimOrigin('  https://example.com//  '), 'https://example.com');
  assert.equal(trimOrigin(undefined), '');
});

// ---------------------------------------------------------------------------
// the message that comes back
// ---------------------------------------------------------------------------

const approved = { type: ASSERTION_MESSAGE, status: 'approved', token: 'nema1.abc.def' };

test('the vault answer is read when the origin and the type both match', () => {
  const event = { origin: VAULT, data: approved };
  assert.deepEqual(readVaultMessage(event, { vault: VAULT, type: ASSERTION_MESSAGE }), approved);
  assert.deepEqual(readVaultMessage(event, { vault: `${VAULT}/`, type: ASSERTION_MESSAGE }), approved);
});

test('a message from any other origin is not the vault, whatever it says about itself', () => {
  const impostor = { origin: 'https://evil.example', data: approved };
  assert.equal(readVaultMessage(impostor, { vault: VAULT, type: ASSERTION_MESSAGE }), null);
});

test('a receipt answer never satisfies a caller waiting for an assertion', () => {
  const event = { origin: VAULT, data: { type: RECEIPT_MESSAGE, status: 'accepted' } };
  assert.equal(readVaultMessage(event, { vault: VAULT, type: ASSERTION_MESSAGE }), null);
  assert.deepEqual(readVaultMessage(event, { vault: VAULT, type: RECEIPT_MESSAGE }), event.data);
});

test('noise on the message channel is ignored rather than parsed', () => {
  for (const data of [null, undefined, 'nema:assertion', 42, ['nema:assertion'], { status: 'approved' }]) {
    assert.equal(readVaultMessage({ origin: VAULT, data }, { vault: VAULT, type: ASSERTION_MESSAGE }), null);
  }
  assert.equal(readVaultMessage(null, { vault: VAULT, type: ASSERTION_MESSAGE }), null);
});

// ---------------------------------------------------------------------------
// what a site tells the reader when it does not work
// ---------------------------------------------------------------------------

test('a blocked popup says how to fix it, in one sentence', () => {
  const { status, message } = describeFailure(vaultLinkError('blocked', POPUP_BLOCKED_MESSAGE));
  assert.equal(status, 'blocked');
  assert.equal(message, POPUP_BLOCKED_MESSAGE);
  assert.match(message, /Allow popups/);
  assert.match(message, /paste box/);
});

test('a window closed without an answer is reported as sharing nothing', () => {
  const { status, message } = describeFailure(vaultLinkError('closed', 'x'));
  assert.equal(status, 'closed');
  assert.match(message, /Nothing was shared/);
});

test('a second request while one is open is refused, not queued', () => {
  assert.equal(isPending(), false);
  assert.equal(describeFailure(vaultLinkError('busy', 'x')).status, 'busy');
});

test('an error from anywhere else still produces a line a reader can read', () => {
  assert.deepEqual(describeFailure(new Error('boom')), { status: 'error', message: 'boom' });
  assert.equal(describeFailure(undefined).status, 'error');
});

// ---------------------------------------------------------------------------
// what the vault moved, in words
// ---------------------------------------------------------------------------

test('the bands a receipt moved are said the way the contract says them', () => {
  assert.equal(
    describeChanges([{ concept: 'nema:ratios', ability: 'apply', from: 'uncertain', to: 'usable' }]),
    'ratios, now usable'
  );
  assert.equal(
    describeChanges([
      { concept: 'nema:pan-sauces', ability: 'explain', to: 'fragile' },
      { concept: 'browning-science', ability: 'recognize', to: 'usable' }
    ]),
    'pan sauces, now fragile; browning science, now usable'
  );
  assert.equal(describeChanges([]), '');
  assert.equal(describeChanges(undefined), '');
});

test('one claim that lifted four rungs is one piece of news, named by the furthest', () => {
  /* A receipt claiming nema:ratios.apply also lifts recognize, retrieve and
     explain. The learner is told what they can now do, once. */
  const changes = [
    { concept: 'nema:ratios', ability: 'recognize', to: 'durable' },
    { concept: 'nema:ratios', ability: 'retrieve', to: 'durable' },
    { concept: 'nema:ratios', ability: 'explain', to: 'durable' },
    { concept: 'nema:ratios', ability: 'apply', to: 'usable' }
  ];
  assert.equal(describeChanges(changes), 'ratios, now usable');
  assert.equal(describeChanges(changes.slice().reverse()), 'ratios, now usable');
});

test('a side ability is reported only when it is the only thing that moved', () => {
  assert.equal(
    describeChanges([{ concept: 'nema:caramelization', ability: 'discriminate', to: 'fragile' }]),
    'caramelization, now fragile'
  );
  assert.equal(
    describeChanges([
      { concept: 'nema:caramelization', ability: 'discriminate', to: 'durable' },
      { concept: 'nema:caramelization', ability: 'explain', to: 'fragile' }
    ]),
    'caramelization, now fragile'
  );
});

// ---------------------------------------------------------------------------
// what a page asks for
// ---------------------------------------------------------------------------

/** The blog's manifest, read from the page itself so the two cannot drift. */
function blogManifest() {
  const path = fileURLToPath(new URL('../apps/blog/public/index.html', import.meta.url));
  const html = readFileSync(path, 'utf8');
  const opening = html.indexOf('<script type="application/nema+json">');
  const start = html.indexOf('>', opening) + 1;
  return parseManifest(html.slice(start, html.indexOf('</script>', start)), { origin: BLOG });
}

test('an embedded page asks for its requirements and every pair a skipIf reads', () => {
  const { manifest } = blogManifest();
  const request = readinessRequestFor(manifest, BLOG);

  assert.equal(request.audience, BLOG);
  assert.equal(request.purpose, 'personalize-maillard-explained');

  const pairs = request.requirements.map((entry) => `${entry.concept}.${entry.ability}`);
  assert.ok(pairs.includes('nema:heat-control.explain'), 'the declared requirement');
  assert.ok(
    pairs.includes('browning-science.recognize'),
    'the skipIf pair, or the "You can skip" note could never appear after one approval'
  );
  assert.equal(new Set(pairs).size, pairs.length, 'no pair is asked for twice');
});

test('the request an embedded page builds is a request the protocol accepts', () => {
  const { manifest } = blogManifest();
  const request = readinessRequestFor(manifest, BLOG);
  const built = buildReadinessRequest(request);
  assert.equal(built.audience, BLOG);
  assert.deepEqual(built.requirements, request.requirements);
  assert.deepEqual(decodeRequest(encodeRequest(built)), built);
});

test('a site asks its own origin and nobody else, so the vault can check it', () => {
  const { manifest } = blogManifest();
  assert.equal(readinessRequestFor(manifest, BLOG).audience, BLOG);
  assert.notEqual(readinessRequestFor(manifest, BLOG).audience, VAULT);
});
