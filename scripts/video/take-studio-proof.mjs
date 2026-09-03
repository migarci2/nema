// A twelve second proof take for the studio pipeline: the connect handshake on
// Saucier School, shot clean. No caption bar and no cursor are drawn into the
// page. Everything the compositor needs is in the event log next to the video.
//
//   CHROME=<chrome with WebMCP> node scripts/video/take-studio-proof.mjs [outDir]
//   CHROME=<chrome> node scripts/video/studio.mjs <outDir>
//
// The vault popup is a second target, the way golden-connect.mjs finds it. Only
// the course page is recorded: the popup opens over it, the learner approves in
// the vault's own origin, and the course rebuilds itself when the answer lands.
import fs from 'node:fs';
import path from 'node:path';
import { openRecorder } from './recorder.mjs';

const SCRATCH = '/tmp/claude-1000/-home-dark-Desktop-Projects/b5daf22a-b862-4b2b-ad5a-8aa4e872e169/scratchpad';
const chrome = process.env.CHROME;
if (!chrome) { console.error('set CHROME'); process.exit(2); }
const out = process.argv[2] || path.join(SCRATCH, 'studio/proof');
const V = process.env.VAULT || 'https://nema-vault.migarci2.dev';
const S1 = process.env.SAUCIER || 'https://saucier.migarci2.dev';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });

/* A page session on a target this recorder did not open, for the popup. */
async function attachTo(wsUrl) {
  const ws = new WebSocket(wsUrl);
  let id = 0; const pending = new Map();
  ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
  const send = (method, params = {}) => new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
  await new Promise((r) => (ws.onopen = r));
  await send('Runtime.enable');
  return {
    async evaluate(expression) {
      const m = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, userGesture: true });
      if (m.result?.exceptionDetails) throw new Error(m.result.exceptionDetails.exception?.description || 'evaluate failed');
      return m.result?.result?.value;
    },
    async waitFor(expression, maxMs = 10000) {
      const start = Date.now();
      while (Date.now() - start < maxMs) {
        try { if (await this.evaluate(expression)) return true; } catch { /* still navigating */ }
        await sleep(150);
      }
      return false;
    },
    close() { ws.close(); }
  };
}

const isConnect = (url) => /\/connect(\.html)?#/.test(url) && url.includes('#request=');
const listTargets = async (port) => (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).filter((t) => t.type === 'page');
async function waitForPopup(port, maxMs = 12000) {
  const start = Date.now();
  while (Date.now() - start < maxMs) {
    const found = (await listTargets(port)).find((t) => isConnect(t.url));
    if (found) return found;
    await sleep(150);
  }
  return null;
}
async function waitForGone(port, targetId, maxMs = 10000) {
  const start = Date.now();
  while (Date.now() - start < maxMs) {
    if (!(await listTargets(port)).some((t) => t.id === targetId)) return true;
    await sleep(150);
  }
  return false;
}

/* 1440x900 at deviceScaleFactor 2 by default: the raw frames are 2880x1800.
 * DSF=3 gives 4320x2700, so the 4K
 * compositor shows the page at a 1.5x downscale at rest and lands at about 1:1
 * native pixels at the 1.55 push, never upscaled. The price is frame rate: the
 * page is rastered in software at that size, which this machine sustains at
 * about 4 fps. The film's own motion, the camera, the pointer, the ripple and
 * the captions, is drawn by the compositor at 30 fps regardless; what runs at
 * the capture rate is the page's own animation. DSF=2 buys 9 fps if a take
 * leans on page motion. */
const DSF = Number(process.env.DSF || 2);
const r = await openRecorder({
  chrome, out, width: 1440, height: 900, deviceScaleFactor: DSF, fps: 30,
  captureFormat: 'png', rawCrf: 12, rawPreset: 'fast', rawPix: 'yuv444p',
  overlays: false, profile: path.join(out, 'profile')
});

try {
  /* The demo learner, loaded in the vault's own origin in this same profile, so
   * the popup has bands to share when the course asks. Not recorded. */
  console.log('seeding the vault');
  await r.goto(`${V}/`, 3000);
  await r.eval('localStorage.clear(); true');
  await r.goto(`${V}/`, 3000);
  for (let i = 0; i < 40; i++) { if (await r.eval(`Boolean(document.querySelector('[data-action="load-demo"]'))`)) break; await sleep(250); }
  await r.eval(`document.querySelector('[data-action="load-demo"]').click(); true`);
  await sleep(3500);
  const seeded = await r.eval(`document.body.innerText.length`);
  console.log('vault seeded, page text', seeded);

  /* The course, cold. */
  const courseUrl = `${S1}/?vault=${encodeURIComponent(V)}`;
  await r.goto(courseUrl, 2500);
  await r.eval('localStorage.clear(); true');
  await r.goto(courseUrl, 3500);
  for (let i = 0; i < 40; i++) { if (await r.eval(`Boolean(document.querySelector('[data-connect-vault]'))`)) break; await sleep(250); }
  console.log('course line:', await r.eval(`document.querySelector('[data-req-line]').textContent.replace(/\\s+/g,' ').trim()`));

  /* How far the screencast runs behind the page, on this page at this scale.
   * Every event time in the log is shifted by it, so the ripple lands on the
   * frame that shows the button pressed. */
  const lat = await r.measureLatency();
  console.log(`latency     ${(lat.latency * 1000).toFixed(0)} ms (samples ${lat.samples.map((v) => (v * 1000).toFixed(0)).join(', ')} ms)`);

  const mp4 = await r.take('raw', async () => {
    await r.caption('Nothing is checked yet. 68 minutes.');
    await r.settle(2600);

    /* The move ends on the button, so the page swaps the pointer to the hand
     * and lifts the button before the press, the way it does under a hand. */
    await r.click('[data-connect-vault]', { ms: 900 });
    await r.caption('Approve in your vault');

    const popup = await waitForPopup(r.port);
    if (!popup) throw new Error('the vault window never opened');
    const vault = await attachTo(popup.webSocketDebuggerUrl);
    const asked = await vault.waitFor(`!document.getElementById('consent-modal').hidden`, 12000);
    if (!asked) throw new Error('the vault never asked');
    await sleep(1200);
    await vault.evaluate(`document.querySelector('[data-consent-approve]').click(); true`);
    await waitForGone(r.port, popup.id);
    vault.close();
    /* The popup took the front; the course has to have it back or the
     * screencast sits on a stale frame. */
    await r.send('Page.bringToFront');
    /* Just long enough for the answer to land and the page to rebuild: the
     * caption has to change with the page, not a second after it. */
    await r.settle(700);

    await r.caption('68 minutes became 27');
    await r.settle(900);
    await r.zoom('[data-req-line]', { scale: 1.55, holdMs: 2400 });
    await r.settle(2600);
    /* The hand comes off the line the camera framed, the way a hand does when
     * it has finished reading, and the page tells us the pointer is an arrow
     * again now that it is over plain text. */
    await r.drift(38, 30);
    await r.settle(900);

    await r.caption('');
    await r.settle(700);
  });

  const line = await r.eval(`document.querySelector('[data-req-line]').textContent.replace(/\\s+/g,' ').trim()`);
  console.log('after the handshake:', line);
  if (!/68 minutes became 27/.test(line)) console.warn('warning: the course did not personalise itself');
  console.log('raw video   ' + mp4);
  const meta = JSON.parse(fs.readFileSync(path.join(out, 'events.json'), 'utf8'));
  const shot = meta.capture ? `${meta.capture.w}x${meta.capture.h}` : 'unknown';
  console.log(`capture     ${shot} at deviceScaleFactor ${DSF}`);
  const kinds = meta.events.filter((e) => e.type === 'move').flatMap((e) => (e.samples || []).map((sm) => sm[3]));
  console.log(`pointer     ${[...new Set(kinds)].join(', ') || 'none'} over ${kinds.length} samples; click on ` +
    (meta.events.find((e) => e.type === 'click') || {}).cursor);
  console.log('event log   ' + path.join(out, 'events.json'));
  console.log('composite with: CHROME=$CHROME node scripts/video/studio.mjs ' + out);
} finally {
  await r.close();
}
