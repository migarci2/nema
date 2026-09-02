/* Rasterise shared/brand/mark.svg into the four extension icon sizes.
 *
 * Chrome extensions want PNGs, the brand ships one SVG, and this repo has no
 * npm dependencies. So the renderer is the browser itself: headless Chrome
 * draws the SVG on a canvas at each size and hands the PNG back over CDP.
 *
 * Usage: CHROME=<chrome binary> node packages/nema-extension/icons/render.mjs
 * The PNGs are committed, so this only runs when the mark changes.
 */

import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const HERE = fileURLToPath(new URL('.', import.meta.url));
const REPO = fileURLToPath(new URL('../../..', import.meta.url));
const SIZES = [16, 32, 48, 128];
const NAVY = '#0B1320';

const bin = process.env.CHROME;
if (!bin) {
  console.error('set CHROME to a Chrome binary, for example Chrome for Testing');
  process.exit(2);
}

const svg = readFileSync(REPO + 'shared/brand/mark.svg', 'utf8');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const port = 9600 + Math.floor(Math.random() * 300);
const chrome = spawn(bin, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  `--remote-debugging-port=${port}`, `--user-data-dir=/tmp/nema-icon-profile-${port}`,
  'about:blank'
], { stdio: 'ignore' });

let target = null;
for (let i = 0; i < 40 && !target; i += 1) {
  try {
    const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
    target = list.find((t) => t.type === 'page');
  } catch { /* not up yet */ }
  if (!target) await sleep(250);
}
if (!target) { chrome.kill(); throw new Error('headless Chrome did not start'); }

const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve) => { ws.onopen = resolve; });
let seq = 0;
const pending = new Map();
ws.onmessage = (event) => {
  const message = JSON.parse(event.data);
  if (message.id && pending.has(message.id)) {
    pending.get(message.id)(message);
    pending.delete(message.id);
  }
};
const send = (method, params = {}) => new Promise((resolve) => {
  const id = ++seq;
  pending.set(id, resolve);
  ws.send(JSON.stringify({ id, method, params }));
});

/* The mark on the navy tile it always sits on, so the icon reads on a light
 * toolbar as well as a dark one. */
const script = (size) => `(async () => {
  const svg = ${JSON.stringify(svg)};
  const image = new Image();
  image.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
  await image.decode();
  const canvas = document.createElement('canvas');
  canvas.width = ${size};
  canvas.height = ${size};
  const ctx = canvas.getContext('2d');
  const r = ${size} * 0.18;
  ctx.fillStyle = ${JSON.stringify(NAVY)};
  ctx.beginPath();
  ctx.roundRect(0, 0, ${size}, ${size}, r);
  ctx.fill();
  const inset = Math.round(${size} * 0.06);
  ctx.drawImage(image, inset, inset, ${size} - inset * 2, ${size} - inset * 2);
  return canvas.toDataURL('image/png');
})()`;

await send('Runtime.enable');
for (const size of SIZES) {
  const reply = await send('Runtime.evaluate', {
    expression: script(size), awaitPromise: true, returnByValue: true
  });
  const dataUrl = reply.result?.result?.value;
  if (typeof dataUrl !== 'string' || !dataUrl.startsWith('data:image/png;base64,')) {
    throw new Error(`icon ${size} did not render: ${JSON.stringify(reply).slice(0, 200)}`);
  }
  const png = Buffer.from(dataUrl.slice('data:image/png;base64,'.length), 'base64');
  writeFileSync(`${HERE}icon${size}.png`, png);
  console.log(`wrote icons/icon${size}.png (${png.length} bytes)`);
}

ws.close();
chrome.kill();
