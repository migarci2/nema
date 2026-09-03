// The takes for the demo film, one chapter at a time.
//
//   CHROME=<chrome with WebMCP> node scripts/video/take-film.mjs <chapter> [outDir]
//
//   ch1   Saucier School: a site asks, you approve, 68 minutes become 27 and
//         the lessons you can skip strike themselves through
//   ch2   the vinaigrette check, the signed receipt, Keep in my vault, and the
//         same receipt on top of the vault ledger
//   ch3   Line Cook Lab, a site that never met the first one
//   ch4b  the AES-GCM compare page, with a question answered inside the text
//
// Every chapter records clean frames and an event log; scripts/video/studio-ffmpeg.mjs
// composites them into the macOS window. A chapter that has to wait for the
// vault popup stops recording while the popup is up, so the film never sits on
// a frozen tab: the popup itself is captured as a still and pushed in the edit.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openRecorder } from './recorder.mjs';

const REPO = fileURLToPath(new URL('../..', import.meta.url)).replace(/\/$/, '');

const SCRATCH = '/tmp/claude-1000/-home-dark-Desktop-Projects/b5daf22a-b862-4b2b-ad5a-8aa4e872e169/scratchpad';
const chrome = process.env.CHROME;
if (!chrome) { console.error('set CHROME'); process.exit(2); }
const chapter = process.argv[2];
const out = process.argv[3] || path.join(SCRATCH, 'film/takes/' + chapter);
const V = process.env.VAULT || 'https://nema-vault.migarci2.dev';
const S1 = process.env.SAUCIER || 'https://saucier.migarci2.dev';
const S2 = process.env.LINECOOK || 'https://linecook.migarci2.dev';
const ARTICLE = process.env.ARTICLE || 'https://aesgcm.migarci2.dev/compare';
const DSF = Number(process.env.DSF || 2);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });

/* ------------------------------------------------- the vault popup, as a
 * second target. Same shape as scripts/e2e/golden-connect.mjs, plus a
 * screenshot, because the film shows the consent question rather than sitting
 * on the course while it is asked. */
async function attachTo(wsUrl) {
  const ws = new WebSocket(wsUrl);
  let id = 0; const pending = new Map();
  ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
  const send = (method, params = {}) => new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
  await new Promise((r) => (ws.onopen = r));
  await send('Runtime.enable'); await send('Page.enable');
  const api = {
    send,
    async evaluate(expression) {
      const m = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, userGesture: true });
      if (m.result?.exceptionDetails) throw new Error(m.result.exceptionDetails.exception?.description || 'evaluate failed');
      return m.result?.result?.value;
    },
    async waitFor(expression, maxMs = 12000) {
      const start = Date.now();
      while (Date.now() - start < maxMs) {
        try { if (await api.evaluate(expression)) return true; } catch { /* still navigating */ }
        await sleep(150);
      }
      return false;
    },
    /* The popup opens at the size the site asked for, which crops the question
     * in half. The still the film pushes on wants the whole modal, so the
     * viewport is widened for the shot and put back before the learner
     * approves. */
    async shot(file, { width = 660, height = 1080, dsf = 2 } = {}) {
      await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: dsf, mobile: false });
      await sleep(600);
      const m = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
      fs.writeFileSync(file, Buffer.from(m.result.data, 'base64'));
      await send('Emulation.clearDeviceMetricsOverride');
      await sleep(250);
      return file;
    },
    close() { ws.close(); }
  };
  return api;
}

const isConnect = (kind) => (url) => /\/connect(\.html)?#/.test(url) && url.includes(`#${kind}=`);
const listTargets = async (port) => (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).filter((t) => t.type === 'page');
async function waitForPopup(port, match, maxMs = 14000) {
  const start = Date.now();
  while (Date.now() - start < maxMs) {
    const found = (await listTargets(port)).find((t) => match(t.url));
    if (found) return found;
    await sleep(150);
  }
  return null;
}
async function waitForGone(port, targetId, maxMs = 12000) {
  const start = Date.now();
  while (Date.now() - start < maxMs) {
    if (!(await listTargets(port)).some((t) => t.id === targetId)) return true;
    await sleep(150);
  }
  return false;
}

const r = await openRecorder({
  chrome, out, width: 1440, height: 900, deviceScaleFactor: DSF, fps: 30,
  captureFormat: 'png', rawCrf: 12, rawPreset: 'fast', rawPix: 'yuv444p',
  overlays: false, profile: path.join(out, 'profile')
});
const takes = [];
const take = async (name, fn) => { console.log('  take ' + name); const mp4 = await r.take(name, fn); takes.push({ name, mp4 }); return mp4; };

/** The demo learner, loaded in the vault's own origin in this profile. */
async function seedVault() {
  console.log('  seeding the vault');
  await r.goto(`${V}/`, 3000);
  await r.eval('localStorage.clear(); true');
  await r.goto(`${V}/`, 3000);
  for (let i = 0; i < 40; i++) { if (await r.eval(`Boolean(document.querySelector('[data-action="load-demo"]'))`)) break; await sleep(250); }
  await r.eval(`document.querySelector('[data-action="load-demo"]').click(); true`);
  await sleep(3500);
}

/** Open a course cold, with the vault it should ask. */
async function coldOpen(origin) {
  const url = `${origin}/?vault=${encodeURIComponent(V)}`;
  await r.goto(url, 2500);
  await r.eval('localStorage.clear(); true');
  await r.goto(url, 3500);
  for (let i = 0; i < 40; i++) { if (await r.eval(`Boolean(document.querySelector('[data-connect-vault]'))`)) break; await sleep(250); }
}

/** Click Connect, approve in the popup, come back. Recorded or not, as asked. */
async function approveHandshake({ shotTo = null, holdMs = 900 } = {}) {
  const popup = await waitForPopup(r.port, isConnect('request'));
  if (!popup) throw new Error('the vault window never opened');
  const vault = await attachTo(popup.webSocketDebuggerUrl);
  if (!(await vault.waitFor(`!document.getElementById('consent-modal').hidden`))) throw new Error('the vault never asked');
  await sleep(holdMs);
  if (shotTo) { await vault.shot(shotTo); console.log('  consent still ' + shotTo); }
  return {
    async approve() {
      await vault.evaluate(`document.querySelector('[data-consent-approve]').click(); true`);
      await waitForGone(r.port, popup.id);
      vault.close();
    },
    read: (expr) => vault.evaluate(expr)
  };
}

/**
 * Where an element is, in page CSS pixels, found by an expression rather than a
 * selector. Scrolls it into view first and hands back the box, so the pointer
 * lands on a real button and a zoom frames the element and not a point.
 */
async function boxOf(expr, { center = true } = {}) {
  const got = await r.eval(`(() => { const el = ${expr}; if (!el) return null;
    el.scrollIntoView({ block: ${center ? "'center'" : "'nearest'"}, behavior: 'instant' });
    const b = el.getBoundingClientRect();
    return { x: b.left + Math.min(b.width / 2, 200), y: b.top + b.height / 2,
             bbox: [b.left, b.top, b.width, b.height] }; })()`);
  if (!got) throw new Error('no element for ' + expr.slice(0, 70));
  await sleep(320);
  return got;
}
const byText = (sel, re) => `[...document.querySelectorAll(${JSON.stringify(sel)})].find(x => ${re}.test(x.textContent))`;

/** A scroll the film can see: the page moves, the camera does not. */
const smoothTo = (expr) => r.eval(`(() => { const el = ${expr}; if (!el) return false; window.scrollTo({ top: Math.max(0, el.getBoundingClientRect().top + window.scrollY - 90), behavior: 'smooth' }); return true; })()`);

try {
  if (chapter === 'ch1') {
    await seedVault();
    await coldOpen(S1);
    console.log('  latency ' + JSON.stringify(await r.measureLatency()));

    await take('ask', async () => {
      await r.caption('A site asks');
      await r.settle(2100);
      await r.click('[data-connect-vault]', { ms: 900 });
      await r.settle(500);
      await r.caption('');
      await r.settle(250);
    });

    const hand = await approveHandshake({ shotTo: path.join(out, 'consent.png'), holdMs: 1100 });
    await r.send('Page.bringToFront');
    await sleep(400);

    /* The counter first, then the path. The course rebuilds itself on the
     * answer and puts the reader back at the top, so a scroll set before the
     * answer is thrown away; the rows that left the path are struck through for
     * as long as they are on screen, and the film goes to them afterwards. */
    await take('became', async () => {
      await r.settle(400);
      await hand.approve();
      await r.send('Page.bringToFront');
      await r.settle(2000);
      await r.caption('68 minutes become 27');
      await r.zoom('[data-req-line]', { scale: 1.5, holdMs: 1600 });
      await r.settle(2500);
      await r.eval(`(() => { const el = document.querySelector('.lab-path'); if (!el) return false;
        window.scrollTo({ top: el.getBoundingClientRect().top + window.scrollY - 70, behavior: 'smooth' }); return true; })()`);
      await r.settle(2400);
      await r.caption('');
      await r.settle(300);
    });
    console.log('  line: ' + await r.eval(`document.querySelector('[data-req-line]').textContent.replace(/\\s+/g,' ').trim()`));
  }

  if (chapter === 'ch2') {
    const content = await import(REPO + '/apps/harness/public/content.js');
    const DIAG = content.ACTIVITIES['ratios-diagnostic'];
    const ANSWER = DIAG.content.answerKey;
    await seedVault();
    await coldOpen(S1);
    /* The handshake again, off camera: this chapter starts from a course that
     * already knows the learner. */
    await r.eval(`document.querySelector('[data-connect-vault]').click(); true`);
    await (await approveHandshake({ holdMs: 300 })).approve();
    await r.send('Page.bringToFront');
    await sleep(900);
    console.log('  latency ' + JSON.stringify(await r.measureLatency()));

    await take('check', async () => {
      await r.caption('You do the work');
      await r.click(await boxOf(`document.querySelector('.lab-path__row[aria-label^=${JSON.stringify(DIAG.title)}]')`), { ms: 780 });
      await r.settle(1300);
      await r.caption('');
      await r.click(await boxOf(`document.querySelector('input[name="diagnostic-option"][value=${JSON.stringify(ANSWER)}]')?.closest('label')`), { ms: 720 });
      await r.settle(800);
      await r.click(await boxOf(byText('.stage__actions button', /Submit answer/)), { ms: 720 });
      await r.settle(2000);
      await r.caption('Saucier School signed what you did');
      await r.click(await boxOf(byText('.stage__actions button', /Issue evidence receipt/)), { ms: 760 });
      await r.settle(2000);
      await r.zoom('[data-receipt]', { scale: 1.4, holdMs: 2000 });
      await r.settle(2900);
      await r.caption('');
      await r.settle(300);
    });

    await take('keep', async () => {
      await r.caption('It counts next time');
      await r.click(await boxOf(`document.querySelector('[data-keep-vault]')`), { ms: 800 });
      await r.settle(800);
    });
    const keep = await waitForPopup(r.port, isConnect('receipt'), 9000);
    if (keep) await waitForGone(r.port, keep.id);
    await r.send('Page.bringToFront');
    await sleep(800);
    console.log('  kept: ' + await r.eval(`document.querySelector('[data-keep-status]')?.textContent || '(none)'`));

    await r.goto(`${V}/`, 4500);
    for (let i = 0; i < 40; i++) { if (await r.eval(`Boolean(document.querySelector('[data-evidence-ledger]'))`)) break; await sleep(250); }
    await r.eval(`(() => { const el = document.querySelector('[data-evidence-ledger]'); if (el) el.scrollIntoView({ block: 'center', behavior: 'instant' }); return true; })()`);
    await sleep(700);
    await take('ledger', async () => {
      await r.caption('It counts next time');
      await r.settle(1000);
      await r.zoom('[data-evidence-ledger]', { scale: 1.35, holdMs: 2200 });
      await r.settle(3000);
      await r.caption('');
      await r.settle(300);
    });
    console.log('  ledger head: ' + (await r.eval(`document.querySelector('[data-evidence-ledger]').textContent.replace(/\\s+/g,' ').trim().slice(0, 140)`)));
  }

  if (chapter === 'ch3') {
    await seedVault();
    await coldOpen(S2);
    console.log('  before: ' + await r.eval(`(document.querySelector('[data-prereq-body]')?.textContent || '').replace(/\\s+/g,' ').trim().slice(0, 160)`));
    console.log('  latency ' + JSON.stringify(await r.measureLatency()));

    await take('lc-ask', async () => {
      await r.caption('A different site. It already knows.');
      await r.settle(2000);
      await r.click('[data-connect-vault]', { ms: 900 });
      await r.settle(500);
    });

    const hand = await approveHandshake({ shotTo: path.join(out, 'consent.png'), holdMs: 900 });
    await r.eval(`(() => { const el = document.querySelector('[data-prereq-body]'); if (el) el.scrollIntoView({ block: 'center', behavior: 'instant' }); return true; })()`);
    await r.send('Page.bringToFront');
    await sleep(400);

    await take('lc-open', async () => {
      await r.settle(400);
      await hand.approve();
      await r.send('Page.bringToFront');
      await r.settle(2600);
      await r.zoom('[data-prereq-body]', { scale: 1.4, holdMs: 2000 });
      await r.settle(2800);
      await r.caption('');
      await r.settle(300);
    });
    console.log('  after: ' + await r.eval(`(document.querySelector('[data-prereq-body]')?.textContent || '').replace(/\\s+/g,' ').trim().slice(0, 200)`));
    console.log('  status: ' + await r.eval(`document.querySelector('[data-connect-status]')?.textContent || ''`));
  }

  if (chapter === 'ch4b') {
    await r.goto(ARTICLE, 6000);
    await sleep(2500);
    /* The two panes are iframes on the same origin: the question lives in the
     * right one, so the scroll that shows it happens in that document, and the
     * left one is moved by the same amount so the pair still reads as a diff. */
    const found = await r.eval(`(() => { const f = document.getElementById('right'); if (!f || !f.contentDocument) return 'no frame';
      const q = f.contentDocument.querySelector('[data-nema-quiz]');
      return q ? q.getBoundingClientRect().top + f.contentWindow.scrollY : 'no quiz'; })()`);
    console.log('  quiz at ' + found);
    await r.eval(`(() => { const el = document.querySelector('.panes'); if (el) el.scrollIntoView({ block: 'start', behavior: 'instant' }); window.scrollBy(0, -40); return true; })()`);
    await sleep(800);
    console.log('  latency ' + JSON.stringify(await r.measureLatency()));
    await take('article', async () => {
      await r.caption('Any page. Any agent.');
      await r.settle(1300);
      await r.eval(`(() => { const top = ${typeof found === 'number' ? found : 0} - 120;
        for (const id of ['right', 'left']) { const f = document.getElementById(id);
          if (f && f.contentWindow) f.contentWindow.scrollTo({ top: Math.max(0, top), behavior: 'smooth' }); }
        return true; })()`);
      await r.settle(2600);
      await r.zoom({ x: 1080, y: 470 }, { scale: 1.35, holdMs: 1600 });
      await r.settle(2300);
      await r.caption('');
      await r.settle(400);
    });
    console.log('  right pane shows: ' + await r.eval(`(() => { const f = document.getElementById('right');
      const q = f.contentDocument.querySelector('[data-nema-quiz]');
      return q ? q.textContent.replace(/\\s+/g, ' ').trim().slice(0, 140) : '(none)'; })()`));
  }

  fs.writeFileSync(path.join(out, 'takes.json'), JSON.stringify(takes, null, 2));
  console.log('takes: ' + takes.map((t) => t.name).join(', '));
} finally {
  await r.close();
}
