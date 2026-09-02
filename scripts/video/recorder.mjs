// Screencast recorder over CDP: no display needed. Frames are written as JPEG
// with timestamps and assembled by ffmpeg (concat demuxer) into an mp4.
//   const r = await openRecorder({ chrome, width: 1920, height: 1080, out: '/tmp/take' });
//   await r.goto(url); await r.eval('...'); await r.frameEval(/vault/, '...'); r.caption('text');
//   await r.close(); // writes out/take.mp4
import { spawn, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const CAPTION_CSS = `
#nema-cap { position: fixed; left: 50%; bottom: 40px; transform: translateX(-50%); z-index: 2147483647;
  font: 500 22px/1.3 "JetBrains Mono", ui-monospace, monospace; color: #00E5FF; background: rgba(11,19,32,0.92);
  padding: 12px 20px; border: 1px solid rgba(0,229,255,0.35); border-radius: 4px; letter-spacing: 0.01em; pointer-events: none;
  opacity: 0; transition: opacity 240ms ease-out; max-width: 70vw; text-align: center; }
#nema-cap.show { opacity: 1; }
#nema-cur { position: fixed; z-index: 2147483646; width: 22px; height: 22px; pointer-events: none; transition: left 420ms cubic-bezier(.2,.7,.2,1), top 420ms cubic-bezier(.2,.7,.2,1); left: -40px; top: -40px; }
`;
const CURSOR_SVG = `<svg viewBox="0 0 24 24" width="22" height="22"><path d="M4 2 L20 12 L12 13.5 L9 21 Z" fill="#F2F6FF" stroke="#0B1320" stroke-width="1.5" stroke-linejoin="round"/></svg>`;

export async function openRecorder({ chrome, width = 1920, height = 1080, out, name = 'take', fps = 25, extraArgs = [] }) {
  fs.mkdirSync(out, { recursive: true });
  const framesDir = path.join(out, name + '-frames');
  fs.rmSync(framesDir, { recursive: true, force: true });
  fs.mkdirSync(framesDir);
  const port = 9500 + Math.floor(Math.random() * 400);
  const proc = spawn(chrome, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--hide-scrollbars', `--remote-debugging-port=${port}`, `--user-data-dir=/tmp/claude-1000/cft-rec-${port}`, `--window-size=${width},${height}`, ...extraArgs, 'about:blank'], { stdio: 'ignore' });
  let target;
  for (let i = 0; i < 60; i++) { try { const l = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json(); target = l.find((t) => t.type === 'page'); if (target) break; } catch {} await sleep(250); }
  if (!target) throw new Error('no page target');
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  let id = 0; const pending = new Map();
  const frames = []; let recording = false; let t0 = 0;
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); return; }
    if (m.method === 'Page.screencastFrame') {
      const { data, sessionId, metadata } = m.params;
      if (recording) {
        const ts = metadata.timestamp;
        if (!t0) t0 = ts;
        const file = path.join(framesDir, String(frames.length).padStart(6, '0') + '.jpg');
        fs.writeFileSync(file, Buffer.from(data, 'base64'));
        frames.push({ file, t: ts - t0 });
      }
      send('Page.screencastFrameAck', { sessionId });
    }
  };
  const send = (method, params = {}) => new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
  await new Promise((r) => (ws.onopen = r));
  await send('Page.enable'); await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });

  const installOverlay = async (contextId) => {
    const expr = `(() => { if (document.getElementById('nema-cap')) return true; const s = document.createElement('style'); s.textContent = ${JSON.stringify(CAPTION_CSS)}; document.head.appendChild(s); const c = document.createElement('div'); c.id = 'nema-cap'; document.body.appendChild(c); const k = document.createElement('div'); k.id = 'nema-cur'; k.innerHTML = ${JSON.stringify(CURSOR_SVG)}; document.body.appendChild(k); return true; })()`;
    await send('Runtime.evaluate', { expression: expr, ...(contextId ? { contextId } : {}), returnByValue: true });
  };

  const rec = {
    async goto(url, waitMs = 2500) { await send('Page.navigate', { url }); await sleep(waitMs); await installOverlay(); },
    async eval(expression, contextId) {
      const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, ...(contextId ? { contextId } : {}) });
      if (r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description || r.result.exceptionDetails.text);
      return r.result?.result?.value;
    },
    async frameContext(urlPattern) {
      const tree = (await send('Page.getFrameTree')).result.frameTree;
      const frame = (tree.childFrames || []).find((f) => urlPattern.test(f.frame.url));
      if (!frame) throw new Error('frame not found: ' + urlPattern);
      const { result } = await send('Page.createIsolatedWorld', { frameId: frame.frame.id, worldName: 'nema-video' });
      return result.executionContextId;
    },
    async frameEval(urlPattern, expression) { return rec.eval(expression, await rec.frameContext(urlPattern)); },
    async caption(text, contextId) {
      await installOverlay(contextId);
      await rec.eval(`(() => { const c = document.getElementById('nema-cap'); c.textContent = ${JSON.stringify(text)}; c.classList.toggle('show', ${JSON.stringify(!!text)}); return true; })()`, contextId);
    },
    async cursorTo(selector, contextId, { click = false, offset = [10, 10] } = {}) {
      await installOverlay(contextId);
      await rec.eval(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) return false; el.scrollIntoView({ block: 'center', behavior: 'instant' }); const b = el.getBoundingClientRect(); const k = document.getElementById('nema-cur'); k.style.left = (b.left + Math.min(${offset[0]}, b.width / 2)) + 'px'; k.style.top = (b.top + Math.min(${offset[1]}, b.height / 2)) + 'px'; return true; })()`, contextId);
      await sleep(520);
      if (click) { await rec.eval(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); el.click(); return true; })()`, contextId); }
    },
    async start() { recording = true; t0 = 0; await send('Page.startScreencast', { format: 'jpeg', quality: 85, maxWidth: width, maxHeight: height, everyNthFrame: 1 }); },
    async stop() { await send('Page.stopScreencast'); recording = false; },
    sleep,
    async close() {
      if (recording) await rec.stop();
      ws.close(); proc.kill();
      if (!frames.length) return null;
      // Build a concat list with real durations, then encode at a fixed fps.
      const list = path.join(out, name + '.txt');
      let txt = '';
      for (let i = 0; i < frames.length; i++) {
        const dur = i + 1 < frames.length ? Math.max(0.02, frames[i + 1].t - frames[i].t) : 0.5;
        txt += `file '${frames[i].file}'\nduration ${dur.toFixed(3)}\n`;
      }
      txt += `file '${frames[frames.length - 1].file}'\n`;
      fs.writeFileSync(list, txt);
      const mp4 = path.join(out, name + '.mp4');
      execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', list, '-vf', `fps=${fps},scale=${width}:${height}:flags=lanczos,format=yuv420p`, '-c:v', 'libx264', '-preset', 'medium', '-crf', '20', mp4]);
      return mp4;
    },
  };
  return rec;
}
