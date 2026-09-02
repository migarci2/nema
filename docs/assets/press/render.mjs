// Render the Devpost story cards to PNG.
//
//   node docs/assets/press/render.mjs [name ...]
//
// Each card-*.html in this folder is served over http (tokens.css and the
// self hosted fonts come from the site dev server on 8780, so run
// `bash scripts/dev-restart.sh site` first), opened in headless Chrome for
// Testing, measured, and captured at its real size with deviceScaleFactor 1.
// Output goes to apps/site/public/press/<name>.png.

import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '../../..');
const OUT = path.join(REPO, 'apps/site/public/press');
const SCRATCH = '/tmp/claude-1000/-home-dark-Desktop-Projects/b5daf22a-b862-4b2b-ad5a-8aa4e872e169/scratchpad';

const CHROME =
  process.env.CHROME ||
  fs.readdirSync(SCRATCH + '/cft/chrome')
    .map((d) => `${SCRATCH}/cft/chrome/${d}/chrome-linux64/chrome`)
    .find(fs.existsSync);

const wanted = process.argv.slice(2);
const cards = fs.readdirSync(HERE)
  .filter((f) => /^card-.*\.html$/.test(f))
  .filter((f) => wanted.length === 0 || wanted.some((w) => f.includes(w)))
  .sort();

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// A file server for this folder, so @import of the dev server's tokens.css and
// relative card.css both resolve.
const port = 8795 + Math.floor(Math.random() * 40);
const types = { '.html': 'text/html', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png' };
const server = (await import('node:http')).createServer((req, res) => {
  const file = path.join(HERE, decodeURIComponent(req.url.split('?')[0]));
  if (!file.startsWith(HERE) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404); res.end(); return;
  }
  res.writeHead(200, { 'content-type': types[path.extname(file)] || 'application/octet-stream' });
  res.end(fs.readFileSync(file));
});
await new Promise((r) => server.listen(port, '127.0.0.1', r));

const dport = 9740 + Math.floor(Math.random() * 200);
const chrome = spawn(CHROME, [
  '--headless=new', '--disable-gpu', '--hide-scrollbars', '--force-device-scale-factor=1',
  `--remote-debugging-port=${dport}`,
  `--user-data-dir=/tmp/claude-1000/press-profile-${dport}`,
  '--window-size=1600,1200', 'about:blank'
], { stdio: 'ignore' });

let target;
for (let i = 0; i < 60; i += 1) {
  try {
    const list = await (await fetch(`http://127.0.0.1:${dport}/json/list`)).json();
    target = list.find((t) => t.type === 'page');
    if (target) break;
  } catch { /* still coming up */ }
  await sleep(250);
}

const ws = new WebSocket(target.webSocketDebuggerUrl);
let id = 0;
const pending = new Map();
ws.onmessage = (event) => {
  const m = JSON.parse(event.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
};
const send = (method, params = {}) => new Promise((res) => {
  const next = ++id; pending.set(next, res);
  ws.send(JSON.stringify({ id: next, method, params }));
});
await new Promise((r) => { ws.onopen = r; });
await send('Page.enable');
await send('Runtime.enable');

fs.mkdirSync(OUT, { recursive: true });

for (const file of cards) {
  const name = file.replace(/\.html$/, '');
  await send('Emulation.setDeviceMetricsOverride', { width: 1600, height: 1000, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url: `http://127.0.0.1:${port}/${file}` });
  await sleep(1400);
  await send('Runtime.evaluate', { expression: 'document.fonts.ready', awaitPromise: true });
  await sleep(400);
  const box = await send('Runtime.evaluate', {
    expression: `(() => { const r = document.querySelector('.card').getBoundingClientRect();
      return JSON.stringify({ w: Math.round(r.width), h: Math.ceil(r.height) }); })()`,
    returnByValue: true
  });
  const { w, h } = JSON.parse(box.result.result.value);
  await send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: false });
  await sleep(350);
  const shot = await send('Page.captureScreenshot', {
    format: 'png', captureBeyondViewport: true, clip: { x: 0, y: 0, width: w, height: h, scale: 1 }
  });
  fs.writeFileSync(path.join(OUT, `${name}.png`), Buffer.from(shot.result.data, 'base64'));
  console.log(`${name}.png  ${w} x ${h}`);
}

ws.close(); chrome.kill(); server.close();
