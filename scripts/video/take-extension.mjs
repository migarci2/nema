// The nema demo video, recorded from the real Chrome extension: the vault
// side panel on the left, the site on the right. No model anywhere. Two CDP
// screencasts (panel tab and site tab) are recorded in parallel and stacked
// side by side with ffmpeg.
//
//   CHROME=<chrome with WebMCP> node scripts/video/take-extension.mjs [outDir]
//
// Needs: scripts/build-extension.sh already run, the production sites up.
// Output: <outDir>/nema-video.mp4 (1920x1080, no audio) plus captions.srt.
import { spawn, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = fileURLToPath(new URL('../..', import.meta.url)).replace(/\/$/, '');
const DIST = `${REPO}/packages/nema-extension/dist`;
const CHROME = process.env.CHROME;
if (!CHROME) { console.error('set CHROME'); process.exit(2); }
const out = process.argv[2] || '/tmp/nema-video-ext';
const V = process.env.VAULT || 'https://nema-vault.migarci2.dev';
const S1 = process.env.SAUCIER || 'https://saucier.migarci2.dev';
const S2 = process.env.LINECOOK || 'https://linecook.migarci2.dev';
const BLOG = process.env.BLOG || 'https://maillard.migarci2.dev';
const HUB = process.env.HUB || 'https://nema.migarci2.dev';
const PANEL_W = 480, SITE_W = 1440, H = 1080, FPS = 25;
/* Capture density. The screencast hands back the CSS viewport unless the browser
 * itself runs at that scale, so the flag and the metrics override have to agree,
 * and maxWidth has to allow the larger frame. DSF=2 makes the stacked output
 * 3840x2160; every derived number below is computed from it, so DSF=1 is the
 * old 1920x1080 behaviour exactly. Higher costs frame rate: this machine
 * sustains about 36 fps at 1x, 9 at 2x, 4 at 3x. */
const DSF = Number(process.env.DSF || 2);
const px = (n) => Math.round(n * DSF);
const content = await import(REPO + '/apps/harness/public/content.js');
const ANSWER = content.ACTIVITIES['ratios-diagnostic'].content.answerKey;

fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const captions = []; // { t, text }
let t0 = 0;
const now = () => (Date.now() - t0) / 1000;

/* ------------------------------------------------------------ browser -- */
const port = 9600 + Math.floor(Math.random() * 300);
const chrome = spawn(CHROME, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--hide-scrollbars',
  `--remote-debugging-port=${port}`, `--user-data-dir=/tmp/claude-1000/nema-video-profile-${port}`, `--window-size=${SITE_W},${H}`,
  ...(DSF !== 1 ? [`--force-device-scale-factor=${DSF}`] : []),
  `--disable-extensions-except=${DIST}`, `--load-extension=${DIST}`, 'about:blank'], { stdio: 'ignore' });
let endpoint = null;
for (let i = 0; i < 60 && !endpoint; i++) { try { endpoint = (await (await fetch(`http://127.0.0.1:${port}/json/version`)).json()).webSocketDebuggerUrl; } catch {} if (!endpoint) await sleep(250); }
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
      if (!rec.t0) rec.t0 = ts;
      const file = path.join(rec.dir, String(rec.frames.length).padStart(6, '0') + (DSF === 1 ? '.jpg' : '.png'));
      fs.writeFileSync(file, Buffer.from(m.params.data, 'base64'));
      rec.frames.push({ file, t: ts - rec.t0 });
    }
    send('Page.screencastFrameAck', { sessionId: m.params.sessionId }, m.sessionId);
  }
};
const send = (method, params = {}, sessionId) => new Promise((res, rej) => { const id = ++seq; pending.set(id, (m) => m.error ? rej(new Error(method + ': ' + m.error.message)) : res(m.result)); ws.send(JSON.stringify(sessionId ? { id, method, params, sessionId } : { id, method, params })); });

async function attach(targetId, width) {
  const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
  await send('Page.enable', {}, sessionId); await send('Runtime.enable', {}, sessionId);
  await send('Emulation.setDeviceMetricsOverride', { width, height: H, deviceScaleFactor: DSF, mobile: false }, sessionId);
  const tab = {
    sessionId, width,
    async goto(url, wait = 3000) { await send('Page.navigate', { url }, sessionId); await sleep(wait); await tab.overlay(); },
    async eval(expr) { const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }, sessionId); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || 'eval failed'); return r.result?.value; },
    async waitFor(expr, ms = 20000) { const until = Date.now() + ms; while (Date.now() < until) { try { const v = await tab.eval(expr); if (v) return v; } catch {} await sleep(250); } let dbg = ''; try { dbg = await tab.eval(`(document.querySelector('[data-ext-page]')?.innerText || '').slice(0, 300)`); } catch {} throw new Error('timeout: ' + expr.slice(0, 80) + ' | strip: ' + dbg); },
    async overlay() {
      await tab.eval(`(() => { if (!document.body) return false; if (document.getElementById('nema-cur')) return true; const s = document.createElement('style'); s.textContent = '#nema-cur{position:fixed;z-index:2147483646;width:22px;height:22px;pointer-events:none;transition:left 420ms cubic-bezier(.2,.7,.2,1),top 420ms cubic-bezier(.2,.7,.2,1);left:-40px;top:-40px}'; document.head.appendChild(s); const k = document.createElement('div'); k.id = 'nema-cur'; k.innerHTML = '<svg viewBox="0 0 24 24" width="22" height="22"><path d="M4 2 L20 12 L12 13.5 L9 21 Z" fill="#F2F6FF" stroke="#0B1320" stroke-width="1.5" stroke-linejoin="round"/></svg>'; document.body.appendChild(k); return true; })()`);
    },
    async cursor(selectorOrExpr, { click = false, byText = null } = {}) {
      await tab.overlay();
      const finder = byText ? `[...document.querySelectorAll(${JSON.stringify(selectorOrExpr)})].find(x => x.textContent.includes(${JSON.stringify(byText)}))` : `document.querySelector(${JSON.stringify(selectorOrExpr)})`;
      const ok = await tab.eval(`(() => { const el = ${finder}; if (!el) return false; el.scrollIntoView({ block: 'center' }); const b = el.getBoundingClientRect(); const k = document.getElementById('nema-cur'); k.style.left = (b.left + Math.min(14, b.width / 2)) + 'px'; k.style.top = (b.top + Math.min(12, b.height / 2)) + 'px'; return true; })()`);
      await sleep(560);
      if (click && ok) await tab.eval(`(() => { const el = ${finder}; el.click(); return true; })()`);
      return ok;
    },
    async record(name) { const dir = path.join(out, name + '-frames'); fs.mkdirSync(dir, { recursive: true }); recorders.set(sessionId, { dir, frames: [], t0: 0, name }); await send('Page.startScreencast', { format: DSF === 1 ? 'jpeg' : 'png', ...(DSF === 1 ? { quality: 85 } : {}), maxWidth: px(width), maxHeight: px(H), everyNthFrame: 1 }, sessionId); },
    async stop() { await send('Page.stopScreencast', {}, sessionId); await sleep(300); },
  };
  return tab;
}
async function newTab(url, width) { const { targetId } = await send('Target.createTarget', { url }); const tab = await attach(targetId, width); await tab.waitFor('Boolean(document.body)'); await sleep(1500); await tab.overlay(); return tab; }
const caption = (text) => { captions.push({ t: now(), text }); console.log(`${now().toFixed(1)}s  ${text || '(clear)'}`); };

/* ------------------------------------------------------------- setup -- */
const targets = (await send('Target.getTargets')).targetInfos;
const extId = [...(await import('node:crypto')).createHash('sha256').update(DIST).digest('hex').slice(0, 32)].map((h) => String.fromCharCode(97 + parseInt(h, 16))).join('');
const PANEL = `chrome-extension://${extId}/sidepanel.html`;
const panel = await newTab(PANEL, PANEL_W);
await panel.waitFor(`Boolean(document.querySelector('[data-action="load-demo"]'))`);
const site = await newTab(S1 + '/', SITE_W);
await site.waitFor(`Boolean(document.querySelector('[data-path-list] .n-path__row'))`);
await panel.waitFor(`Boolean(document.querySelector('[data-action="load-demo"]'))`);

/* ---------------------------------------------------------- recording -- */
await panel.record('panel'); await site.record('site'); t0 = Date.now();
const hold = (s) => sleep(s * 1000);

// 0:00 cold open: the vault in the browser
await panel.cursor('[data-action="load-demo"]', { click: true });
caption('Your learning state belongs to you, not to the websites you visit.');
await hold(3);
await panel.eval(`(() => { const g = [...document.querySelectorAll('.n-graph__group')].find(x => /^Emulsions/.test(x.querySelector('title')?.textContent || '')); if (g) { g.scrollIntoView({ block: 'center' }); g.focus(); } return true; })()`);
await hold(5);

// 0:14 the problem: the site starts from zero
caption('Every site teaches you from zero.');
await site.cursor('.n-path__row', { byText: '' });
await hold(6);

// 0:26 the offer: the page works with nema, the panel sees its tools
caption('Six tools on this page. describe_learning_offer');
await panel.waitFor(`/Works with nema/.test(document.querySelector('[data-ext-state]')?.textContent || '')`, 30000);
await panel.cursor('[data-ext-page]');
await hold(5);

// 0:42 the disclosure, hold it
caption('The human decides. Every time.');
await panel.cursor('button', { byText: 'Share bands', click: true });
await panel.waitFor(`!document.getElementById('consent-modal').hidden`);
await hold(5);
await panel.cursor('[data-consent-approve]', { click: true });
await hold(2);

// 1:04 sixty eight becomes twenty seven
caption('68 minutes to 27. present_assertion');
await site.waitFor(`/27 of 68|27 minutes/.test(document.body.innerText)`);
await site.cursor('.n-path__row--skipped');
await hold(6);

// 1:24 the human does the work
caption('No tool submits an answer.');
await site.cursor('.n-path__row', { byText: 'Which vinaigrette', click: true });
await hold(2.5);
await site.cursor(`[data-option="${ANSWER}"]`);
await site.eval(`(() => { document.querySelector('[data-option="${ANSWER}"] input').click(); return true; })()`);
await hold(1.5);
await site.cursor('button', { byText: 'Submit answer', click: true });
await hold(4);

// 1:46 the receipt comes home
caption('Signature verified. uncertain to usable.');
await panel.cursor('button', { byText: 'Take the receipt', click: true });
await panel.waitFor(`/accepted|already in your vault/.test(document.querySelector('[data-ext-page]')?.textContent || '')`, 30000);
await hold(6);

// 2:04 a second site asks the same vault
caption('Different site. Different learner id.');
await site.goto(S2 + '/', 4000);
await panel.waitFor(`/6 tools/.test(document.querySelector('[data-ext-page]')?.textContent || '') && /Line Cook/.test(document.querySelector('[data-ext-page]')?.textContent || '')`, 20000);
await panel.cursor('button', { byText: 'Share bands', click: true });
await panel.waitFor(`!document.getElementById('consent-modal').hidden`);
await hold(3);
await panel.cursor('[data-consent-approve]', { click: true });
await site.waitFor(`/recognised|Recognised|verified/.test(document.body.innerText)`, 20000);
await hold(6);

// 2:24 one tag on a blog
caption('One article, one tag. Works with nema.');
await site.goto(BLOG + '/', 4000);
await site.eval(`(() => { const el = document.querySelector('nema-activities') || document.querySelector('main'); el.scrollIntoView({ block: 'center' }); return true; })()`);
await panel.waitFor(`/tools/.test(document.querySelector('[data-ext-page]')?.textContent || '') && /Maillard|browning/i.test(document.querySelector('[data-ext-page]')?.textContent || '')`, 20000);
await site.cursor('button', { byText: 'Mark as read', click: true });
await hold(2);
await panel.cursor('button', { byText: 'Take the receipt', click: true });
await panel.waitFor(`/accepted|self/.test(document.querySelector('[data-ext-page]')?.textContent || '')`, 30000);
await hold(6);

// 2:40 the close
await site.goto(HUB + '/', 3000);
for (const line of ['3 independent websites', '1 learner-owned vault', '0 shared accounts', 'nema.migarci2.dev']) { caption(line); await hold(2.6); }
caption('');
await hold(1);

/* ------------------------------------------------------------ encode -- */
await panel.stop(); await site.stop();
const total = now();
ws.close(); chrome.kill();
function encode(rec, width) {
  const list = path.join(out, rec.name + '.txt');
  let txt = '';
  for (let i = 0; i < rec.frames.length; i++) { const dur = i + 1 < rec.frames.length ? Math.max(0.02, rec.frames[i + 1].t - rec.frames[i].t) : Math.max(0.5, total - rec.frames[i].t); txt += `file '${rec.frames[i].file}'\nduration ${dur.toFixed(3)}\n`; }
  txt += `file '${rec.frames[rec.frames.length - 1].file}'\n`;
  fs.writeFileSync(list, txt);
  const mp4 = path.join(out, rec.name + '.mp4');
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', list, '-vf', `fps=${FPS},scale=${px(width)}:${px(H)}:flags=lanczos,format=${DSF === 1 ? 'yuv420p' : 'yuv444p'}`, '-c:v', 'libx264', '-preset', DSF === 1 ? 'medium' : 'fast', '-crf', DSF === 1 ? '20' : '12', '-t', total.toFixed(2), mp4]);
  return mp4;
}
const recs = [...recorders.values()];
const panelMp4 = encode(recs.find((r) => r.name === 'panel'), PANEL_W);
const siteMp4 = encode(recs.find((r) => r.name === 'site'), SITE_W);
// captions as srt (burned in later, or kept as subtitles)
const srt = captions.map((c, i) => { const end = captions[i + 1] ? captions[i + 1].t : total; if (!c.text) return ''; const f = (s) => new Date(s * 1000).toISOString().slice(11, 23).replace('.', ','); return `${i + 1}\n${f(c.t)} --> ${f(end)}\n${c.text}\n`; }).filter(Boolean).join('\n');
fs.writeFileSync(path.join(out, 'captions.srt'), srt);
const final = path.join(out, 'nema-video.mp4');
execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', panelMp4, '-i', siteMp4, '-filter_complex', `[0:v][1:v]hstack=inputs=2,subtitles=${path.join(out, 'captions.srt')}:force_style='FontName=JetBrains Mono,FontSize=${px(22)},PrimaryColour=&H00FFE500,OutlineColour=&H80201309,BorderStyle=4,BackColour=&HB0201309,Alignment=2,MarginV=${px(40)}'`, '-c:v', 'libx264', '-preset', DSF === 1 ? 'medium' : 'slow', '-crf', DSF === 1 ? '19' : '16', ...(DSF === 1 ? [] : ['-profile:v', 'high', '-level', '5.1']), '-pix_fmt', 'yuv420p', final]);
console.log('video:', final, 'duration', total.toFixed(1), 's', `at ${px(PANEL_W + SITE_W)}x${px(H)}`);
