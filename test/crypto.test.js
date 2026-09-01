// Tests for shared/crypto.js. Run with: node --test test/crypto.test.js

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  b64url,
  sha256,
  sha256Bytes,
  generateKeyPair,
  importPublicKey,
  importPrivateKey,
  sign,
  verify,
  randomId,
  nowIso
} from '../shared/crypto.js';

test('b64url roundtrips strings, including multi-byte UTF-8', () => {
  const samples = [
    '',
    'a',
    'ab',
    'abc',
    'nema/0.1',
    '{"a":1}',
    // Two and three byte sequences, written as escapes to keep this file ASCII.
    'accents: \u00e9 \u00fc \u00f1',
    'kanji: \u5b66\u7fd2'
  ];
  for (const sample of samples) {
    const encoded = b64url.encode(sample);
    assert.match(encoded, /^[A-Za-z0-9_-]*$/, `not base64url: ${encoded}`);
    assert.equal(b64url.decodeToString(encoded), sample);
  }
});

test('b64url roundtrips bytes and rejects non base64url input', () => {
  const bytes = new Uint8Array([0, 1, 127, 128, 254, 255]);
  const encoded = b64url.encode(bytes);
  assert.deepEqual(Array.from(b64url.decode(encoded)), Array.from(bytes));
  assert.throws(() => b64url.decode('not base64url!'), /not base64url/);
});

test('sha256 returns a prefixed hex digest and matches the raw bytes', async () => {
  const digest = await sha256('nema');
  assert.match(digest, /^sha256:[0-9a-f]{64}$/);

  const bytes = await sha256Bytes('nema');
  assert.equal(bytes.length, 32);
  const hex = Array.from(bytes)
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
  assert.equal(digest, `sha256:${hex}`);

  // Known vector, so a change of algorithm or encoding is caught.
  assert.equal(
    await sha256('abc'),
    'sha256:ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'
  );
});

test('generateKeyPair produces an exportable P-256 pair', async () => {
  const { publicJwk, privateJwk } = await generateKeyPair();
  assert.equal(publicJwk.kty, 'EC');
  assert.equal(publicJwk.crv, 'P-256');
  assert.equal(typeof publicJwk.x, 'string');
  assert.equal(typeof publicJwk.y, 'string');
  assert.equal(publicJwk.d, undefined);
  assert.equal(typeof privateJwk.d, 'string');

  await importPublicKey(publicJwk);
  await importPrivateKey(privateJwk);
  await assert.rejects(() => importPrivateKey(publicJwk), /private JWK/);
});

test('sign and verify roundtrip', async () => {
  const { publicJwk, privateJwk } = await generateKeyPair();
  const payload = JSON.stringify({ type: 'readiness-assertion', protocol: 'nema/0.1' });

  const signature = await sign(privateJwk, payload);
  assert.match(signature, /^[A-Za-z0-9_-]+$/);
  // Raw r||s for P-256 is 64 bytes.
  assert.equal(b64url.decode(signature).length, 64);

  assert.equal(await verify(publicJwk, payload, signature), true);
});

test('a tampered payload fails verification', async () => {
  const { publicJwk, privateJwk } = await generateKeyPair();
  const payload = JSON.stringify({ status: 'verified' });
  const signature = await sign(privateJwk, payload);

  const tampered = JSON.stringify({ status: 'durable' });
  assert.equal(await verify(publicJwk, tampered, signature), false);
  // A single trailing space is enough.
  assert.equal(await verify(publicJwk, `${payload} `, signature), false);
});

test('a tampered signature or a foreign key fails verification', async () => {
  const alice = await generateKeyPair();
  const mallory = await generateKeyPair();
  const payload = 'evidence';
  const signature = await sign(alice.privateJwk, payload);

  assert.equal(await verify(mallory.publicJwk, payload, signature), false);

  const bytes = b64url.decode(signature);
  bytes[0] ^= 0xff;
  assert.equal(await verify(alice.publicJwk, payload, b64url.encode(bytes)), false);

  // Never throws, whatever it is handed.
  assert.equal(await verify(alice.publicJwk, payload, 'not a signature!'), false);
  assert.equal(await verify(null, payload, signature), false);
});

test('randomId is prefixed, sized and unique', () => {
  const id = randomId('rcpt', 12);
  assert.match(id, /^rcpt_[A-Za-z0-9_-]{12}$/);
  assert.equal(randomId('lk', 6).length, 'lk_'.length + 6);

  const seen = new Set();
  for (let i = 0; i < 200; i += 1) seen.add(randomId('need'));
  assert.equal(seen.size, 200);
});

test('nowIso returns an ISO 8601 UTC timestamp', () => {
  const value = nowIso();
  assert.match(value, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  assert.ok(Math.abs(Date.now() - new Date(value).getTime()) < 5000);
});
