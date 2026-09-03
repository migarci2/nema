// The extension chapter of the film: the nema side panel on the left, a page on
// the right, both recorded at once and stacked. Nothing here is a mock: it is
// the built extension in a real Chrome, on the production blog.
//
//   CHROME=<chrome with WebMCP> node scripts/video/take-film-ext.mjs [outDir]
//
// Needs packages/nema-extension/dist to be built. Output: <outDir>/ext.mp4 at
// 3840x2160 with the caption track burned in, plus captions.srt.
//
// A short cousin of scripts/video/take-extension.mjs, which records the whole
// three minute reel; this one is the six seconds the film uses.
import { spawn, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = fileURLToPath(new URL('../..', import.meta.url)).replace(/\/$/, '');
const DIST = `${REPO}/packages/nema-extension/dist`;
const CHROME = process.env.CHROME;
if (!CHROME) { console.error('set CHROME'); process.exit(2); }
const SCRATCH = '/tmp/claude-1000/-home-dark-Desktop-Projects/b5daf22a-b862-4b2b-ad5a-8aa4e872e169/scratchpad';
const out = process.argv[2] || path.join(SCRATCH, 'film/takes/ch4');
const BLOG = process.env.BLOG || 'https://maillard.migarci2.dev';
const PANEL_W = 480, SITE_W = 1440, H = 1080, FPS = 30;
const DSF = Number(process.env.DSF || 2);
const px = (n) => Math.round(n * DSF);

fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const captions = [];
let t0 = 0;
const now = () => (Date.now() - t0) / 1000;

const port = 9600 + Math.floor(Math.random() * 300);
const chrome = spawn(CHROME, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--hide-scrollbars',
  `--remote-debugging-port=${port}`, `--user-data-dir=/tmp/claude-1000/nema-film-ext-${port}`, `--window-size=${SITE_W},${H}`,
  ...(DSF !== 1 ? [`--force-device-scale-factor=${DSF}`] : []),
  `--disable-extensions-except=${DIST}`, `--load-extension=${DIST}`, 'about:blank'], { stdio: 'ignore' });
let endpoint = null;
for (let i = 0; i < 80 && !endpoint; i++) { try { endpoint = (await (await fetch(`http://127.0.0.1:${port}/json/version`)).json()).webSocketDebuggerUrl; } catch {} if (!endpoint) await sleep(250); }
const ws = new WebSocket(endpoint);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
let seq = 0; const pending = new Map(); const recorders = new Map();
ws.onmessage = (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); return; }
  if (m.method === 'Page.screencastFrame') {
    const rec = recorders.get(m.sessionId);
    if (rec) {
      const ts = m.params.metadata.timestamp;
      /* Two tabs are recorded at once and each one's clock starts on its own
       * first frame. The wall time of that frame is kept so the stack can put
       * them back on a common timeline; without it the panel plays seconds
       * ahead of the page it belongs to. */
      if (!rec.t0) { rec.t0 = ts; rec.startedAt = Date.now(); }
      const file = path.join(rec.dir, String(rec.frames.length).padStart(6, '0') + '.png');
      fs.writeFileSync(file, Buffer.from(m.params.data, 'base64'));
      rec.frames.push({ file, t: ts - rec.t0 });
    }
    send('Page.screencastFrameAck', { sessionId: m.params.sessionId }, m.sessionId);
  }
};
const send = (method, params = {}, sessionId) => new Promise((res, rej) => { const id = ++seq; pending.set(id, (m) => (m.error ? rej(new Error(method + ': ' + m.error.message)) : res(m.result))); ws.send(JSON.stringify(sessionId ? { id, method, params, sessionId } : { id, method, params })); });

const CUR = `#nema-cur{position:fixed;z-index:2147483646;width:22px;height:22px;pointer-events:none;transition:left 420ms cubic-bezier(.2,.7,.2,1),top 420ms cubic-bezier(.2,.7,.2,1);left:-40px;top:-40px}`;
const CUR_SVG = '<svg viewBox="0 0 24 24" width="22" height="22"><path d="M4 2 L20 12 L12 13.5 L9 21 Z" fill="#F2F6FF" stroke="#0B1320" stroke-width="1.5" stroke-linejoin="round"/></svg>';

async function attach(targetId, width) {
  const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
  await send('Page.enable', {}, sessionId); await send('Runtime.enable', {}, sessionId);
  await send('Emulation.setDeviceMetricsOverride', { width, height: H, deviceScaleFactor: DSF, mobile: false }, sessionId);
  const tab = {
    sessionId, width,
    async goto(url, wait = 3000) { await send('Page.navigate', { url }, sessionId); await sleep(wait); await tab.overlay(); },
    async eval(expr) { const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true, userGesture: true }, sessionId); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || 'eval failed'); return r.result?.value; },
    async waitFor(expr, ms = 25000) { const until = Date.now() + ms; while (Date.now() < until) { try { const v = await tab.eval(expr); if (v) return v; } catch {} await sleep(250); } throw new Error('timeout: ' + expr.slice(0, 90)); },
    async overlay() { await tab.eval(`(() => { if (!document.body) return false; if (document.getElementById('nema-cur')) return true; const s = document.createElement('style'); s.textContent = ${JSON.stringify(CUR)}; document.head.appendChild(s); const k = document.createElement('div'); k.id = 'nema-cur'; k.innerHTML = ${JSON.stringify(CUR_SVG)}; document.body.appendChild(k); return true; })()`).catch(() => {}); },
    async cursor(finder, { click = false } = {}) {
      await tab.overlay();
      const ok = await tab.eval(`(() => { const el = ${finder}; if (!el) return false; el.scrollIntoView({ block: 'center' }); const b = el.getBoundingClientRect(); const k = document.getElementById('nema-cur'); k.style.left = (b.left + Math.min(16, b.width / 2)) + 'px'; k.style.top = (b.top + Math.min(14, b.height / 2)) + 'px'; return true; })()`);
      await sleep(560);
      if (click && ok) await tab.eval(`(() => { ${finder}.click(); return true; })()`);
      return ok;
    },
    async record(name) { const dir = path.join(out, name + '-frames'); fs.mkdirSync(dir, { recursive: true }); recorders.set(sessionId, { dir, frames: [], t0: 0, name }); await send('Page.startScreencast', { format: 'png', maxWidth: px(width), maxHeight: px(H), everyNthFrame: 1 }, sessionId); },
    async stop() { await send('Page.stopScreencast', {}, sessionId); await sleep(300); }
  };
  return tab;
}
async function newTab(url, width) { const { targetId } = await send('Target.createTarget', { url }); const tab = await attach(targetId, width); await tab.waitFor('Boolean(document.body)'); await sleep(1500); await tab.overlay(); return tab; }
const caption = (text) => { captions.push({ t: now(), text }); console.log(`${now().toFixed(1)}s  ${text || '(clear)'}`); };
const byText = (sel, text) => `[...document.querySelectorAll(${JSON.stringify(sel)})].find(x => x.textContent.includes(${JSON.stringify(text)}))`;

const extId = [...(await import('node:crypto')).createHash('sha256').update(DIST).digest('hex').slice(0, 32)].map((h) => String.fromCharCode(97 + parseInt(h, 16))).join('');
const panel = await newTab(`chrome-extension://${extId}/sidepanel.html`, PANEL_W);
await panel.waitFor(`Boolean(document.querySelector('[data-action="load-demo"]'))`);
await panel.eval(`document.querySelector('[data-action="load-demo"]').click(); true`);
await sleep(3500);
const site = await newTab(BLOG + '/', SITE_W);
/* The panel shows whatever tab is in front. Two tabs in one headless browser
 * need that said out loud, or the panel keeps reporting an empty window and the
 * Share button on it has nothing to share. */
await send('Page.bringToFront', {}, site.sessionId);
await site.waitFor(`Boolean(document.getElementById('nema-ext-bar'))`, 30000).catch(() => console.log('  no in page bar'));
await panel.waitFor(`/browning|Maillard|tools on this page/i.test(document.querySelector('[data-ext-page]')?.textContent || '')`, 30000)
  .catch(() => console.log('  the panel never saw the page'));
console.log('  panel page: ' + String(await panel.eval(`(document.querySelector('[data-ext-page]')?.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 160)`)));
console.log('  panel buttons: ' + String(await panel.eval(`[...document.querySelectorAll('button')].map(b => b.textContent.trim()).filter(Boolean).slice(0, 14).join(' | ')`)));
await sleep(1200);

/* ---------------------------------------------------------- recording -- */
/* The page is static once it has loaded, and its bar is already drawn, so the
 * panel keeps the front for the whole take and is the only thing that moves. */
await send('Page.bringToFront', {}, panel.sessionId);
await sleep(500);
await panel.record('panel'); await site.record('site'); t0 = Date.now();
const hold = (s) => sleep(s * 1000);

/* Only one tab can be in front of a headless browser at a time, and the panel
 * only knows about a page while that page is the front tab. So the page leads:
 * the strip fills, the bar is there to see, and the panel is brought back for
 * the disclosure, which covers the strip anyway. */
caption('Any page. Any agent.');
await hold(1.7);
/* The bar the extension puts on the page is a shadow root, so the pointer is
 * placed from the host's own box and the click goes through the root. */
await site.eval(`(() => { const h = document.getElementById('nema-ext-bar'); if (!h) return false;
  const b = h.shadowRoot.querySelector('[data-share]').getBoundingClientRect();
  const k = document.getElementById('nema-cur'); k.style.left = (b.left + 18) + 'px'; k.style.top = (b.top + 14) + 'px'; return true; })()`).catch(() => {});
await hold(0.7);
await panel.cursor(byText('button', 'Share'), { click: true });
const asked = await panel.waitFor(`!document.getElementById('consent-modal').hidden`, 20000).catch(() => false);
if (!asked) console.log('  the panel never asked');
await hold(1.4);
if (asked) await panel.cursor(`document.querySelector('[data-consent-approve]')`, { click: true });
await hold(2.6);
caption('');
await hold(0.6);

await panel.stop(); await site.stop();
const total = now();
ws.close(); chrome.kill();

function encode(rec, width) {
  const list = path.join(out, rec.name + '.txt');
  let txt = '';
  for (let i = 0; i < rec.frames.length; i++) { const dur = i + 1 < rec.frames.length ? Math.max(0.02, rec.frames[i + 1].t - rec.frames[i].t) : Math.max(0.4, total - rec.frames[i].t); txt += `file '${rec.frames[i].file}'\nduration ${dur.toFixed(3)}\n`; }
  txt += `file '${rec.frames[rec.frames.length - 1].file}'\n`;
  fs.writeFileSync(list, txt);
  const mp4 = path.join(out, rec.name + '.mp4');
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', list,
    '-vf', `fps=${FPS},scale=${px(width)}:${px(H)}:flags=lanczos,format=yuv444p`,
    '-c:v', 'libx264', '-preset', 'fast', '-crf', '12', '-t', total.toFixed(2), mp4]);
  return mp4;
}
const recs = [...recorders.values()];
const panelMp4 = encode(recs.find((r) => r.name === 'panel'), PANEL_W);
const siteMp4 = encode(recs.find((r) => r.name === 'site'), SITE_W);
/* The caption is the studio's own pill, drawn by scripts/video/pill.py, so this
 * chapter speaks in the same voice as the ones shot in the macOS window. */
const OW = px(PANEL_W + SITE_W), OH = px(H);
const shown = captions.filter((c) => c.text);
const pills = shown.map((c, i) => {
  const file = path.join(out, `pill-${i}.png`);
  const meta = JSON.parse(execFileSync('python3', [path.join(REPO, 'scripts/video/pill.py'), c.text, String(DSF), String(OW - 200 * DSF), file], { encoding: 'utf8' }));
  const end = captions[captions.indexOf(c) + 1] ? captions[captions.indexOf(c) + 1].t : total;
  return { ...meta, t: c.t, span: Math.max(0.4, end - c.t) };
});
const delta = (rec) => Math.max(0, ((rec.startedAt || t0) - t0) / 1000);
const inputs = ['-itsoffset', delta(recs.find((r) => r.name === 'panel')).toFixed(3), '-i', panelMp4,
  '-itsoffset', delta(recs.find((r) => r.name === 'site')).toFixed(3), '-i', siteMp4];
/* The side panel lays its card out in a column of its own and leaves the rest
 * of the strip empty, which reads as dead space next to the page. The column is
 * cropped out and centred in the same 480 wide slot, so nothing is resampled
 * and the panel sits in the middle of its own ground. */
const PANEL_INK = 340;   // device pixels of panel that actually carry ink
const fc = [
  `[0:v]crop=${PANEL_INK}:${px(H)}:0:0,pad=${px(PANEL_W)}:${px(H)}:(ow-iw)/2:0:color=0x0B1320[pn]`,
  '[pn][1:v]hstack=inputs=2[base0]'
];
let node = 'base0';
pills.forEach((p, i) => {
  inputs.push('-loop', '1', '-framerate', String(FPS), '-t', String(p.span), '-i', p.path);
  const x = Math.round((OW - p.w) / 2);
  /* Higher than the studio's own margin: the extension's bar lives in the
   * bottom right of the page and the pill would sit on top of it. */
  const y = Math.round(OH - 172 * DSF - p.pillBottom);
  fc.push(`[${2 + i}:v]format=rgba,fade=t=in:st=0:d=0.24:alpha=1,fade=t=out:st=${Math.max(0, p.span - 0.24).toFixed(3)}:d=0.24:alpha=1,tpad=start_duration=${p.t.toFixed(3)}:start_mode=add:color=0x00000000[p${i}]`);
  fc.push(`[${node}][p${i}]overlay=${x}:${y}:eof_action=pass:repeatlast=0:format=auto[cc${i}]`);
  node = `cc${i}`;
});
fc.push(`[${node}]format=yuv420p[v]`);
const final = path.join(out, 'ext.mp4');
execFileSync('ffmpeg', ['-y', '-loglevel', 'error', ...inputs, '-filter_complex', fc.join(';'), '-map', '[v]',
  '-c:v', 'libx264', '-preset', 'slow', '-crf', '16', '-profile:v', 'high', '-level', '5.1', '-pix_fmt', 'yuv420p', '-t', total.toFixed(2), final]);
console.log('video:', final, 'duration', total.toFixed(1), 's at', `${px(PANEL_W + SITE_W)}x${px(H)}`);
