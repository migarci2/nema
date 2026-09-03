// The extension chapter: one Chrome window, the page on the left and the nema
// side panel on the right, both live.
//
//   CHROME=<chrome with WebMCP> node scripts/video/take-film-ext.mjs [outDir]
//
// Two surfaces are captured at once in the same browser. The page comes through
// the screencast, which only runs while its tab is in front, so the page keeps
// the front for the whole take. The panel is a second target and is captured
// with Page.captureScreenshot on a 100 ms cadence, which works on a background
// target; at 400x900 it is small enough to keep up. Both are stamped on one
// wall clock, and each is written out with per frame durations from its own
// stamps, so the two videos start at zero together and a panel frame is held
// until the next one arrives.
//
// The output is the window's inside, page + a one pixel hairline + panel, at
// native 2x with nothing resampled, plus an event log in the recorder's format
// whose coordinate space is that whole strip: 1841 x 900 CSS pixels. That is
// what scripts/video/studio-ffmpeg.mjs wants, so the window chrome, the
// wallpaper, the camera, the pointer and the caption pills are the same ones
// every other chapter of the film uses.
//
// The flow is the one packages/nema-extension/test/e2e.mjs drives, with its
// selectors: Share in the page's own bar, the disclosure in the panel, Approve,
// the page rebuilding itself, the diagnostic answered by hand, and the receipt
// arriving on its own so the page gets the "Kept in your vault" toast.
import { spawn, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { path as ghostPath } from 'ghost-cursor';
import { toJsonl } from './recorder.mjs';

const REPO = fileURLToPath(new URL('../..', import.meta.url)).replace(/\/$/, '');
const DIST = `${REPO}/packages/nema-extension/dist`;
const CHROME = process.env.CHROME;
if (!CHROME) { console.error('set CHROME'); process.exit(2); }
const SCRATCH = '/tmp/claude-1000/-home-dark-Desktop-Projects/b5daf22a-b862-4b2b-ad5a-8aa4e872e169/scratchpad';
const out = process.argv[2] || path.join(SCRATCH, 'film/takes/ch4');
const SAUCIER = process.env.SAUCIER || 'https://saucier.migarci2.dev';

/* The window's inside, in CSS pixels. The hairline is one pixel of it. */
const PAGE_W = 1440, PANEL_W = 400, RULE = 1, H = 900;
const STRIP_W = PAGE_W + RULE + PANEL_W;      // 1841
const DSF = 2, FPS = 30;
const px = (n) => Math.round(n * DSF);
const HAIRLINE = '0xC3C8D0';

fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ---------------------------------------------------------- browser -- */

const port = 9600 + Math.floor(Math.random() * 300);
const profile = `/tmp/claude-1000/nema-film-ext-${port}-${Date.now()}`;
const chrome = spawn(CHROME, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--hide-scrollbars', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`,
  `--window-size=${PAGE_W},${H}`, `--force-device-scale-factor=${DSF}`,
  `--disable-extensions-except=${DIST}`, `--load-extension=${DIST}`, 'about:blank'], { stdio: 'ignore' });

let endpoint = null;
for (let i = 0; i < 80 && !endpoint; i++) {
  try { endpoint = (await (await fetch(`http://127.0.0.1:${port}/json/version`)).json()).webSocketDebuggerUrl; } catch {}
  if (!endpoint) await sleep(250);
}
if (!endpoint) { chrome.kill(); throw new Error('Chrome did not start'); }
const ws = new WebSocket(endpoint);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
let seq = 0; const pending = new Map();
let siteRec = null;                       // { dir, frames: [{file, t}] }
let t0 = 0;                               // the one wall clock, ms
const now = () => (Date.now() - t0) / 1000;

ws.onmessage = (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); return; }
  if (m.method === 'Page.screencastFrame') {
    if (siteRec) {
      /* The screencast stamps every frame with seconds since the epoch, which
       * is the same clock Date.now() reads, so a page frame and a panel
       * screenshot land on one timeline with no guessing. */
      const file = path.join(siteRec.dir, String(siteRec.frames.length).padStart(6, '0') + '.png');
      fs.writeFileSync(file, Buffer.from(m.params.data, 'base64'));
      siteRec.frames.push({ file, t: m.params.metadata.timestamp - t0 / 1000 });
    }
    send('Page.screencastFrameAck', { sessionId: m.params.sessionId }, m.sessionId);
  }
};
const send = (method, params = {}, sessionId) => new Promise((res, rej) => {
  const id = ++seq;
  pending.set(id, (m) => (m.error ? rej(new Error(method + ': ' + m.error.message)) : res(m.result)));
  ws.send(JSON.stringify(sessionId ? { id, method, params, sessionId } : { id, method, params }));
});

/* The page's own account of the pointer, the same probe scripts/video/recorder.mjs
 * installs, so the film swaps the arrow for the hand where a person would see
 * it swap rather than where we guess. */
const CURSOR_PROBE = `(() => {
  if (window.__nemaCursor) return true;
  const state = { log: [] };
  window.__nemaCursor = state;
  addEventListener('mousemove', (e) => {
    const el = document.elementFromPoint(e.clientX, e.clientY) || e.target;
    let css = 'auto';
    if (el && el.nodeType === 1) css = getComputedStyle(el).cursor;
    state.log.push([performance.timeOrigin + performance.now(), e.clientX, e.clientY, css]);
    if (state.log.length > 4000) state.log.splice(0, 2000);
  }, true);
  return true;
})()`;
const cursorKind = (css) => {
  const c = String(css || '').split(',').pop().trim().toLowerCase();
  if (c === 'pointer' || c === 'grab' || c === 'grabbing') return 'hand';
  if (c === 'text' || c === 'vertical-text') return 'text';
  return 'arrow';
};

async function attach(targetId, { width, height }) {
  const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
  await send('Page.enable', {}, sessionId);
  await send('Runtime.enable', {}, sessionId);
  await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: DSF, mobile: false }, sessionId);
  const tab = {
    sessionId, width, height,
    async evaluate(expression) {
      const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, userGesture: true }, sessionId);
      if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || 'evaluate failed');
      return r.result?.value;
    },
    async waitFor(expression, { timeoutMs = 25000, label = expression } = {}) {
      const until = Date.now() + timeoutMs;
      let last;
      while (Date.now() < until) {
        try { last = await tab.evaluate(expression); if (last) return last; } catch (e) { last = e.message; }
        await sleep(200);
      }
      throw new Error('timed out waiting for ' + label + ' (last: ' + JSON.stringify(last).slice(0, 120) + ')');
    },
    async probe() { await tab.evaluate(CURSOR_PROBE).catch(() => {}); },
    /* jpeg, not png: a 800x1800 png costs about a third of a second to encode
     * and the panel would arrive at three frames a second. The panel is text on
     * a flat navy ground, where quality 92 is indistinguishable, and the strip
     * is re-encoded after this anyway. */
    async shot() {
      const r = await send('Page.captureScreenshot', { format: 'jpeg', quality: 92, fromSurface: true }, sessionId);
      return Buffer.from(r.data, 'base64');
    },
    async mouse(type, x, y, buttons = 0) {
      await send('Input.dispatchMouseEvent', { type, x, y, button: type === 'mouseMoved' ? 'none' : 'left', buttons, clickCount: type === 'mouseMoved' ? 0 : 1 }, sessionId);
    }
  };
  return tab;
}

/* ------------------------------------------------------- the log -- */

/* Everything is logged in the strip's coordinate space, so the panel's own x is
 * offset past the page and the hairline. That is the space studio-ffmpeg maps
 * to the window, which is what makes a push at the disclosure frame the panel. */
const events = [];
const OFFSET = { site: 0, panel: PAGE_W + RULE };
let cursor = null;                       // strip coordinates
let lastKind = 'arrow';
const log = (type, data) => events.push({ t: Number(now().toFixed(3)), type, ...data });
const caption = (text) => { log('caption', { text: String(text || '') }); console.log(`${now().toFixed(1)}s  ${text || '(clear)'}`); };

/** ghost-cursor's shape, dispatched as real mouse moves at 60 Hz. */
function humanPath(from, to, ms) {
  let pts;
  try { pts = ghostPath({ x: from.x, y: from.y }, { x: to.x, y: to.y }, { useTimestamps: true }); } catch { pts = null; }
  if (!pts || pts.length < 2) pts = [{ x: from.x, y: from.y, timestamp: 0 }, { x: to.x, y: to.y, timestamp: ms }];
  const t0p = pts[0].timestamp;
  const span = pts[pts.length - 1].timestamp - t0p || 1;
  const n = Math.max(2, Math.round((ms / 1000) * 20));
  const outp = [];
  let j = 0;
  for (let i = 0; i <= n; i++) {
    const t = (i / n) * ms;
    const src = (t / (ms / span)) + t0p;
    while (j < pts.length - 2 && pts[j + 1].timestamp <= src) j += 1;
    const a = pts[j], b = pts[j + 1] || pts[j];
    const d = (b.timestamp - a.timestamp) || 1;
    const f = Math.max(0, Math.min(1, (src - a.timestamp) / d));
    outp.push({ t, x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f });
  }
  outp[outp.length - 1] = { t: ms, x: to.x, y: to.y };
  return outp;
}

/** Where an element is, in that tab's own CSS pixels. `find` returns the node. */
async function boxIn(tab, find) {
  const got = await tab.evaluate(`(() => { const el = ${find}; if (!el) return null;
    if (el.scrollIntoView) el.scrollIntoView({ block: 'center', behavior: 'instant' });
    const b = el.getBoundingClientRect();
    return { x: b.left + b.width / 2, y: b.top + b.height / 2, left: b.left, top: b.top, w: b.width, h: b.height }; })()`);
  if (!got) throw new Error('no element: ' + find.slice(0, 70));
  return got;
}

/** A human move to a point in one tab, logged in strip coordinates. */
async function moveTo(tab, which, target, ms = 640) {
  const to = { x: target.x + OFFSET[which], y: target.y };
  const from = cursor || { x: Math.max(30, to.x - 280), y: Math.min(H - 30, to.y + 200) };
  await tab.probe();
  await tab.evaluate('window.__nemaCursor.log.length = 0; true').catch(() => {});
  const samples = humanPath({ x: from.x - OFFSET[which], y: from.y }, target, ms);
  const startWall = Date.now();
  const dispatched = [];
  const inFlight = [];
  for (const s of samples) {
    const wait = startWall + s.t - Date.now();
    if (wait > 1) await sleep(wait);
    dispatched.push({ w: Date.now(), x: s.x, y: s.y });
    inFlight.push(tab.mouse('mouseMoved', s.x, s.y));
  }
  await Promise.all(inFlight);
  let seen = [];
  try { seen = JSON.parse(await tab.evaluate('JSON.stringify(window.__nemaCursor.log)') || '[]'); } catch {}
  let kind = lastKind;
  const byIndex = seen.length === dispatched.length;
  const outSamples = dispatched.map((d, i) => {
    const hit = byIndex ? seen[i] : null;
    if (hit) kind = cursorKind(hit[3]);
    const when = hit ? hit[0] : d.w;
    return [Number(((when - t0) / 1000).toFixed(3)), Math.round((d.x + OFFSET[which]) * 10) / 10, Math.round(d.y * 10) / 10, kind];
  });
  lastKind = kind;
  events.push({ t: outSamples[0] ? outSamples[0][0] : Number(now().toFixed(3)), type: 'move',
    from, to, ms, cursor: kind, samples: outSamples });
  cursor = to;
  return to;
}

/** Move, then a real press and release, logged where the film should look. */
async function clickIn(tab, which, find, { ms = 640, holdMs = 120 } = {}) {
  const box = await boxIn(tab, find);
  await sleep(200);
  const aim = { x: box.left + Math.min(box.w / 2, 90), y: box.top + box.h / 2 };
  const p = await moveTo(tab, which, aim, ms);
  await sleep(90);
  await tab.mouse('mousePressed', aim.x, aim.y, 1);
  log('click', { x: p.x, y: p.y, cursor: lastKind,
    bbox: [Math.round((box.left + OFFSET[which]) * 10) / 10, Math.round(box.top * 10) / 10, Math.round(box.w * 10) / 10, Math.round(box.h * 10) / 10] });
  await sleep(holdMs);
  await tab.mouse('mouseReleased', aim.x, aim.y, 0);
  return p;
}

/** Ask the camera to push, in strip coordinates. */
const zoomAt = (which, box, { scale = 1.6, holdMs = 1800 } = {}) => log('zoom', {
  x: box.x + OFFSET[which], y: box.y, scale, holdMs,
  bbox: [box.left + OFFSET[which], box.top, box.w, box.h]
});

/* ------------------------------------------------------- the setup -- */

let extensionId = null;
for (let i = 0; i < 60 && !extensionId; i++) {
  const targets = (await send('Target.getTargets')).targetInfos;
  const worker = targets.find((t) => t.type === 'service_worker' && /^chrome-extension:\/\/[a-p]+\/sw\.js$/.test(t.url));
  if (worker) extensionId = new URL(worker.url).host;
  else await sleep(250);
}
if (!extensionId) { chrome.kill(); throw new Error('the extension did not load'); }
console.log('  extension ' + extensionId);

const panelTarget = await send('Target.createTarget', { url: `chrome-extension://${extensionId}/sidepanel.html` });
const panel = await attach(panelTarget.targetId, { width: PANEL_W, height: H });
await panel.waitFor(`Boolean(document.querySelector('[data-ext-onboard-demo]'))`, { label: 'the onboarding card' });
await panel.evaluate(`document.querySelector('[data-ext-onboard-demo]').click(), true`);
const seeded = await panel.waitFor(
  `(() => { const d = JSON.parse(localStorage.getItem('nema.vault.v1') || '{}'); return d.receipts && d.receipts.length > 20 ? d.receipts.length : 0; })()`,
  { label: 'the demo learner' });
console.log('  vault seeded, ' + seeded + ' receipts');

const siteTarget = await send('Target.createTarget', { url: SAUCIER + '/' });
const site = await attach(siteTarget.targetId, { width: PAGE_W, height: H });
/* The page keeps the front for the whole take: a screencast only runs on the
 * tab in front, and the panel does not need the front to be screenshotted. */
await send('Page.bringToFront', {}, site.sessionId);
await site.waitFor(`Boolean(document.querySelector('[data-path-list] .n-path__row'))`, { label: 'Saucier School' });
const strip = await panel.waitFor(
  `(() => { const t = document.querySelector('[data-ext-state]').textContent;
     const tools = document.querySelector('[data-ext-tools]').textContent;
     return t.includes('Works with nema') && tools.includes('issue_evidence_receipt') ? t : ''; })()`,
  { timeoutMs: 30000, label: 'the strip to see the page' });
console.log('  strip: ' + strip.replace(/\s+/g, ' ').trim().slice(0, 90));
await site.waitFor(
  `(() => { const host = document.getElementById('nema-ext-bar');
     return host && host.shadowRoot && host.shadowRoot.querySelector('[data-share]') ? 1 : 0; })()`,
  { timeoutMs: 30000, label: 'the in page bar' });
await site.probe(); await panel.probe();
await sleep(800);

/* --------------------------------------------------------- record -- */

const siteDir = path.join(out, 'page-frames');
const panelDir = path.join(out, 'panel-frames');
fs.mkdirSync(siteDir, { recursive: true }); fs.mkdirSync(panelDir, { recursive: true });
const panelFrames = [];
let polling = true;
t0 = Date.now();
siteRec = { dir: siteDir, frames: [] };
await send('Page.startScreencast', { format: 'png', maxWidth: px(PAGE_W), maxHeight: px(H), everyNthFrame: 1 }, site.sessionId);

/* The panel is a background target, so it is captured rather than screencast.
 * Every shot is stamped when it came back, and the compositor holds it until
 * the next one, which is what a 10 Hz panel next to a 30 fps page needs. */
const poll = (async () => {
  while (polling) {
    const at = Date.now();
    try {
      const png = await panel.shot();
      const file = path.join(panelDir, String(panelFrames.length).padStart(6, '0') + '.jpg');
      fs.writeFileSync(file, png);
      panelFrames.push({ file, t: (at - t0) / 1000 });
    } catch { /* the panel is rebuilding, try again */ }
    const spent = Date.now() - at;
    if (spent < 100) await sleep(100 - spent);
  }
})();

const hold = (s) => sleep(s * 1000);

/* One take serves two chapters: chapter one is the ask, the disclosure and the
 * counter; chapter four is the same window while the receipt comes home. Both
 * sets of captions are logged here and each cut takes the window it wants. */
caption('A site asks');
await hold(5.0);

/* Share, from the page's own bar. The bar is a shadow root, so the pointer is
 * aimed with the host's own geometry and the press goes to the real button. */
const barShare = `document.getElementById('nema-ext-bar').shadowRoot.querySelector('[data-share]')`;
const shareBox = await site.evaluate(`(() => { const b = ${barShare}.getBoundingClientRect();
  return { x: b.left + b.width / 2, y: b.top + b.height / 2, left: b.left, top: b.top, w: b.width, h: b.height }; })()`);
await moveTo(site, 'site', { x: shareBox.left + shareBox.w / 2, y: shareBox.top + shareBox.h / 2 }, 720);
await sleep(120);
await site.mouse('mousePressed', shareBox.left + shareBox.w / 2, shareBox.top + shareBox.h / 2, 1);
log('click', { x: cursor.x, y: cursor.y, cursor: 'hand',
  bbox: [shareBox.left, shareBox.top, shareBox.w, shareBox.h] });
await sleep(120);
await site.mouse('mouseReleased', shareBox.left + shareBox.w / 2, shareBox.top + shareBox.h / 2, 0);

await panel.waitFor(`document.querySelector('#consent-modal').hidden === false`, { timeoutMs: 30000, label: 'the disclosure' });
/* Long enough that the push onto the disclosure is its own moment. The camera
 * drops any anchor that lands within 1.8 s of the one before it, so a zoom
 * asked for right after the click on Share is thrown away and the film stays
 * framed on the button instead of the question. */
await sleep(1500);
caption('You say yes');
await sleep(400);
const modalBox = await boxIn(panel, `document.querySelector('#consent-modal .n-modal, #consent-modal > *') || document.querySelector('#consent-modal')`);
zoomAt('panel', modalBox, { scale: 1.7, holdMs: 2400 });
await hold(2.8);
await clickIn(panel, 'panel', `document.querySelector('[data-consent-approve]')`, { ms: 620 });

const pathNote = await site.waitFor(
  `(() => { const t = document.querySelector('[data-path-note]').textContent; return t.includes('27') ? t : ''; })()`,
  { label: 'Saucier School to personalise' });
console.log('  page rebuilt: ' + pathNote.replace(/\s+/g, ' ').trim().slice(0, 80));
await hold(0.9);
caption('68 minutes become 27');
const noteBox = await boxIn(site, `document.querySelector('[data-path-note]')`);
zoomAt('site', noteBox, { scale: 1.5, holdMs: 3400 });
await hold(8.6);
console.log('  panel result: ' + String(await panel.evaluate(`(document.querySelector('[data-ext-result]')?.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 90)`)));

/* The learner answers, in the page, by hand. */
caption('Any page. Any agent.');
await clickIn(site, 'site', `[...document.querySelectorAll('[data-path-list] .n-path__row')].find((r) => r.textContent.toLowerCase().includes('vinaigrette'))`, { ms: 700 });
await site.waitFor(`Boolean(document.querySelector('input[name="diagnostic-option"][value="ratio-b"]'))`, { label: 'the diagnostic' });
await hold(0.5);
const OPTION = `document.querySelector('input[name="diagnostic-option"][value="ratio-b"]')`;
await clickIn(site, 'site', `${OPTION}.closest('label') || ${OPTION}`, { ms: 640 });
await hold(0.4);
/* A press that lands a pixel off a radio, or lands before the stage has
 * settled, leaves the answer unchosen and the whole receipt beat never
 * happens. The pointer did the work; this only makes sure it took. */
if (!(await site.evaluate(`${OPTION}.checked`))) {
  console.log('  the press missed the option, choosing it directly');
  await site.evaluate(`${OPTION}.click(), true`);
  await sleep(400);
}
await clickIn(site, 'site', `[...document.querySelectorAll('[data-stage] button')].find((b) => b.textContent.trim() === 'Submit answer')`, { ms: 640 });
await sleep(900);
if (!(await site.evaluate(`(() => { const s = JSON.parse(localStorage.getItem('nema.harness.v1') || '{}');
  return s.attempts && s.attempts['ratios-diagnostic'] && s.attempts['ratios-diagnostic'].status === 'passed'; })()`))) {
  console.log('  the submit did not land, pressing it directly');
  await site.evaluate(`(() => { const b = [...document.querySelectorAll('[data-stage] button')].find((x) => x.textContent.trim() === 'Submit answer'); if (b) b.click(); return true; })()`);
}
const passed = await site.waitFor(
  `(() => { const s = JSON.parse(localStorage.getItem('nema.harness.v1') || '{}');
     return s.attempts && s.attempts['ratios-diagnostic'] ? s.attempts['ratios-diagnostic'].status : ''; })()`,
  { label: 'the diagnostic to grade' });
console.log('  diagnostic: ' + passed);

/* Nobody clicks anything: the extension collects the receipt and the page is
 * told what was kept. */
const toast = await site.waitFor(
  `(() => { const root = document.getElementById('nema-ext-bar').shadowRoot;
     const el = root.querySelector('[data-toast]');
     return el && !el.hidden ? el.textContent.replace(/\\s+/g, ' ').trim() : ''; })()`,
  { timeoutMs: 45000, label: 'the toast in the page' });
console.log('  toast: ' + toast);
caption('Kept in your vault');
/* The toast stands for twelve seconds, so there is room to let it land before
 * the camera goes to it. The wait is also what keeps this push more than the
 * camera's 1.8 s spacing away from the press that caused it, which is the only
 * reason the push would be dropped. */
await hold(1.5);
const toastBox = await site.evaluate(`(() => { const b = document.getElementById('nema-ext-bar').shadowRoot.querySelector('[data-toast]').getBoundingClientRect();
  return { x: b.left + b.width / 2, y: b.top + b.height / 2, left: b.left, top: b.top, w: b.width, h: b.height }; })()`);
zoomAt('site', toastBox, { scale: 1.55, holdMs: 1900 });
await hold(3.2);
caption('');
await hold(0.6);

polling = false;
await poll;
await send('Page.stopScreencast', {}, site.sessionId);
await sleep(300);
const total = now();
ws.close(); chrome.kill();

/* -------------------------------------------------------- encode -- */

/* Each surface is written with its own stamps and a held first frame, so both
 * videos start at zero and the hstack needs no offset. */
function encode(frames, w, h, name) {
  if (!frames.length) throw new Error('no frames for ' + name);
  const list = path.join(out, name + '.txt');
  let txt = '';
  if (frames[0].t > 0.001) txt += `file '${frames[0].file}'\nduration ${frames[0].t.toFixed(3)}\n`;
  for (let i = 0; i < frames.length; i++) {
    const dur = i + 1 < frames.length ? Math.max(1 / (FPS * 2), frames[i + 1].t - frames[i].t) : Math.max(0.3, total - frames[i].t);
    txt += `file '${frames[i].file}'\nduration ${dur.toFixed(3)}\n`;
  }
  txt += `file '${frames[frames.length - 1].file}'\n`;
  fs.writeFileSync(list, txt);
  const mp4 = path.join(out, name + '.mp4');
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', list,
    '-vf', `fps=${FPS},scale=${w}:${h}:flags=lanczos,format=yuv444p`,
    '-g', String(Math.round(FPS / 2)), '-keyint_min', '1', '-sc_threshold', '0',
    '-c:v', 'libx264', '-preset', 'fast', '-crf', '12', '-t', total.toFixed(2), mp4]);
  return mp4;
}
const pageMp4 = encode(siteRec.frames, px(PAGE_W), px(H), 'page');
const panelMp4 = encode(panelFrames, px(PANEL_W), px(H), 'panel');

/* One strip: the page, a one pixel hairline, the panel. Nothing is resampled. */
const ext = path.join(out, 'ext.mp4');
execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', pageMp4, '-i', panelMp4,
  '-filter_complex',
  `color=c=${HAIRLINE}:s=${px(RULE)}x${px(H)}:r=${FPS}:d=${total.toFixed(2)}[rule];` +
  `[0:v][rule][1:v]hstack=inputs=3,format=yuv420p[v]`,
  '-map', '[v]', '-c:v', 'libx264', '-preset', 'slow', '-crf', '14',
  '-profile:v', 'high', '-level', '5.1', '-pix_fmt', 'yuv420p', '-t', total.toFixed(2), ext]);

/* The log studio-ffmpeg reads, in the strip's own coordinate space. */
const meta = {
  take: 'ext',
  capture: { w: px(STRIP_W), h: px(H) },
  width: STRIP_W, height: H, deviceScaleFactor: DSF, fps: FPS,
  epoch: t0 / 1000, latency: 0,
  duration: Number(total.toFixed(3)),
  video: ext,
  title: 'Saucier School',
  events: events.slice().sort((a, b) => a.t - b.t)
};
fs.writeFileSync(path.join(out, 'ext.events.json'), JSON.stringify(meta, null, 2));
fs.writeFileSync(path.join(out, 'events.json'), JSON.stringify(meta, null, 2));
const jsonl = toJsonl(meta);
fs.writeFileSync(path.join(out, 'ext.events.jsonl'), jsonl);
fs.writeFileSync(path.join(out, 'events.jsonl'), jsonl);

console.log(`page   ${siteRec.frames.length} frames, panel ${panelFrames.length} frames, ${total.toFixed(1)}s`);
console.log(`strip  ${ext} at ${px(STRIP_W)}x${px(H)}`);
console.log('events ' + path.join(out, 'ext.events.json'));
/* Last, and never fatal: Chrome may still be flushing its profile. */
try { fs.rmSync(profile, { recursive: true, force: true }); } catch { /* it can wait for /tmp */ }
