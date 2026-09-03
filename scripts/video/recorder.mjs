// Screencast recorder over CDP: no display needed. Frames are written as JPEG
// with timestamps and assembled by ffmpeg (concat demuxer) into an mp4.
//   const r = await openRecorder({ chrome, width: 1920, height: 1080, out: '/tmp/take' });
//   await r.goto(url); await r.eval('...'); await r.frameEval(/vault/, '...'); r.caption('text');
//   await r.close(); // writes out/take.mp4
//
// A take also writes an event log next to the video: every cursor move, click,
// caption change and explicit zoom, stamped on the same clock as the frames and
// measured in page CSS pixels. scripts/video/studio.mjs replays that log to
// composite a Screen Studio style shot; nothing else depends on it, so the log
// is written whether or not anyone reads it.
//
//   const r = await openRecorder({ chrome, width: 1440, height: 900, out,
//                                  deviceScaleFactor: 2, fps: 30, overlays: false });
//   await r.take('raw', async () => {
//     r.caption('Nothing is checked yet.');
//     await r.click('[data-connect-vault]');
//     await r.settle(1200);
//     await r.zoom('[data-req-line]', { scale: 1.6, holdMs: 2200 });
//   });
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


/* --------------------------------------------------------------- jsonl -- */

// The event log in the shape scripts/video/polish/polish.py reads: a header, then
// 60 Hz cursor samples and down/up pairs. Two rules its loader depends on, both
// of which cost a run of zero zoom-ins when they are broken: `t` is seconds since
// the header epoch, never an absolute epoch time, and x/y are display points, the
// same units as `display`, which the loader scales to video pixels itself.
const easeCursorJs = (() => {
  // cubic-bezier(.42, 0, .22, 1), the same curve the compositor eases a move with
  const x1 = 0.42, y1 = 0, x2 = 0.22, y2 = 1;
  const cx = 3 * x1, bx = 3 * (x2 - x1) - cx, ax = 1 - cx - bx;
  const cy = 3 * y1, by = 3 * (y2 - y1) - cy, ay = 1 - cy - by;
  const fx = (t) => ((ax * t + bx) * t + cx) * t;
  return (x) => {
    if (x <= 0) return 0;
    if (x >= 1) return 1;
    let lo = 0, hi = 1, t = x;
    for (let i = 0; i < 30; i++) { t = (lo + hi) / 2; if (fx(t) < x) lo = t; else hi = t; }
    return ((ay * t + by) * t + cy) * t;
  };
})();


/** Pixel size of a png or jpeg buffer, read from the header. */
function frameSize(buf) {
  if (buf.length > 24 && buf[0] === 0x89 && buf[1] === 0x50) {
    return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
  }
  for (let i = 2; i + 9 < buf.length;) {
    if (buf[i] !== 0xff) { i++; continue; }
    const marker = buf[i + 1];
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      return { h: buf.readUInt16BE(i + 5), w: buf.readUInt16BE(i + 7) };
    }
    i += 2 + buf.readUInt16BE(i + 2);
  }
  return null;
}

export function toJsonl(log, { hz = 60, pressMs = 60 } = {}) {
  const lines = [JSON.stringify({ type: 'header', epoch: log.epoch || 0, display: { w: log.width, h: log.height } })];
  const r3 = (v) => Number(v.toFixed(3));
  const push = (o) => lines.push(JSON.stringify(o));
  const tap = (t, x, y, bbox) => {
    push({ t: r3(t), type: 'down', x: r3(x), y: r3(y), button: 'left', ...(bbox ? { bbox } : {}) });
    push({ t: r3(t + pressMs / 1000), type: 'up', x: r3(x), y: r3(y), button: 'left' });
  };
  for (const e of log.events) {
    if (e.type === 'move') {
      const dur = Math.max(1 / hz, e.ms / 1000);
      const n = Math.max(2, Math.round(dur * hz));
      for (let i = 0; i <= n; i++) {
        const u = i / n; const k = easeCursorJs(u);
        push({ t: r3(e.t + u * dur), type: 'move', x: r3(e.from.x + (e.to.x - e.from.x) * k), y: r3(e.from.y + (e.to.y - e.from.y) * k) });
      }
    } else if (e.type === 'click') {
      tap(e.t, e.x, e.y, e.bbox);
    } else if (e.type === 'zoom') {
      // An explicit zoom is a place the film should look at, which is exactly
      // what a click means to the polish stage.
      tap(e.t, e.x, e.y, e.bbox);
    }
  }
  return lines.join('\n') + '\n';
}

export async function openRecorder({
  chrome,
  width = 1920,
  height = 1080,
  out,
  fps = 25,
  extraArgs = [],
  profile = null,
  deviceScaleFactor = 1,
  // The screencast delivers the CSS viewport, not device pixels, unless the
  // browser itself is started at that scale: --force-device-scale-factor is what
  // makes a 1440x900 page arrive as 4320x2700, and maxWidth has to allow it.
  // It costs frame rate, because every frame is rastered at that size in
  // software: 36 fps at 1x, 9 at 2x, 4 at 3x on this machine.
  captureFormat = 'jpeg',
  captureQuality = 90,
  rawCrf = 18,
  rawPreset = 'medium',
  rawPix = 'yuv420p',
  // The in page caption bar and synthetic cursor. A studio take draws both in
  // the compositor instead, from the event log, so it records a clean page.
  overlays = true
}) {
  fs.mkdirSync(out, { recursive: true });
  let framesDir = null; let takeName = null;
  const port = 9500 + Math.floor(Math.random() * 400);
  const proc = spawn(chrome, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--hide-scrollbars', ...(deviceScaleFactor !== 1 ? [`--force-device-scale-factor=${deviceScaleFactor}`] : []), `--remote-debugging-port=${port}`, `--user-data-dir=${profile || '/tmp/claude-1000/cft-rec-' + port}`, `--window-size=${width},${height}`, ...extraArgs, 'about:blank'], { stdio: 'ignore' });
  let target;
  for (let i = 0; i < 60; i++) { try { const l = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json(); target = l.find((t) => t.type === 'page'); if (target) break; } catch {} await sleep(250); }
  if (!target) throw new Error('no page target');
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  let id = 0; const pending = new Map();
  const frames = []; let recording = false; let t0 = 0; let wallStart = 0; let wallEnd = 0;
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); return; }
    if (m.method === 'Page.screencastFrame') {
      const { data, sessionId, metadata } = m.params;
      if (recording) {
        const ts = metadata.timestamp;
        if (!t0) t0 = ts;
        const file = path.join(framesDir, String(frames.length).padStart(6, '0') + (captureFormat === 'png' ? '.png' : '.jpg'));
        fs.writeFileSync(file, Buffer.from(data, 'base64'));
        frames.push({ file, t: ts - t0 });
        if (!captureSize) captureSize = frameSize(Buffer.from(data, 'base64'));
      }
      send('Page.screencastFrameAck', { sessionId });
    }
  };
  const send = (method, params = {}) => new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
  await new Promise((r) => (ws.onopen = r));
  await send('Page.enable'); await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor, mobile: false });

  /* ------------------------------------------------------------ events -- */

  // One clock for frames and events alike: the screencast metadata timestamp is
  // seconds since the epoch, so an event stamped from Date.now() lands on the
  // same timeline as the frame that was on screen when it happened.
  let events = [];
  const clockNow = () => (t0 ? Math.max(0, Date.now() / 1000 - t0) : 0);
  const logEvent = (type, data = {}) => {
    const e = { t: Number(clockNow().toFixed(3)), type, ...data };
    if (recording) events.push(e);
    return e;
  };
  let captureSize = null; // what the screencast actually delivered, in pixels
  let cursor = null; // last known cursor point, page CSS pixels
  let lastBox = null; // box of the element the cursor last moved to

  const installOverlay = async (contextId) => {
    if (!overlays) return;
    const expr = `(() => { if (document.getElementById('nema-cap')) return true; const s = document.createElement('style'); s.textContent = ${JSON.stringify(CAPTION_CSS)}; document.head.appendChild(s); const c = document.createElement('div'); c.id = 'nema-cap'; document.body.appendChild(c); const k = document.createElement('div'); k.id = 'nema-cur'; k.innerHTML = ${JSON.stringify(CURSOR_SVG)}; document.body.appendChild(k); return true; })()`;
    await send('Runtime.evaluate', { expression: expr, ...(contextId ? { contextId } : {}), returnByValue: true });
  };

  const rec = {
    port,
    targetId: target.id,
    send,
    get events() { return events; },
    async goto(url, waitMs = 2500) { await send('Page.navigate', { url }); await sleep(waitMs); await installOverlay(); },
    async eval(expression, contextId) {
      const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, userGesture: true, ...(contextId ? { contextId } : {}) });
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
      logEvent('caption', { text: String(text || '') });
      if (!overlays) return;
      await installOverlay(contextId);
      await rec.eval(`(() => { const c = document.getElementById('nema-cap'); c.textContent = ${JSON.stringify(text)}; c.classList.toggle('show', ${JSON.stringify(!!text)}); return true; })()`, contextId);
    },
    async cursorTo(selector, contextId, { click = false, offset = [10, 10] } = {}) {
      await installOverlay(contextId);
      await rec.eval(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) return false; el.scrollIntoView({ block: 'center', behavior: 'instant' }); const b = el.getBoundingClientRect(); const k = document.getElementById('nema-cur'); k.style.left = (b.left + Math.min(${offset[0]}, b.width / 2)) + 'px'; k.style.top = (b.top + Math.min(${offset[1]}, b.height / 2)) + 'px'; return true; })()`, contextId);
      await sleep(520);
      if (click) { await rec.eval(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); el.click(); return true; })()`, contextId); }
    },

    /* --------------------------------------------------------- studio -- */

    /**
     * Where a target sits, in page CSS pixels. Scrolls it into view first and
     * carries the element's box, which is what makes a downstream zoom frame the
     * element rather than an offset from the cursor.
     */
    async point(target, { contextId = null, offset = null } = {}) {
      if (target && typeof target === 'object' && typeof target.x === 'number') return { x: target.x, y: target.y, bbox: target.bbox || null };
      const sel = String(target);
      const got = await rec.eval(`(() => { const el = document.querySelector(${JSON.stringify(sel)}); if (!el) return null; el.scrollIntoView({ block: 'center', behavior: 'instant' }); const b = el.getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2, w: b.width, h: b.height, left: b.left, top: b.top }; })()`, contextId);
      if (!got) throw new Error('no element for ' + sel);
      // Wide elements read better with the cursor a little left of centre, the
      // way a hand lands on a button rather than dead centre of a banner.
      const x = offset ? got.x - got.w / 2 + offset[0] : Math.min(got.x, got.x - got.w / 2 + 220);
      const y = offset ? got.y - got.h / 2 + offset[1] : got.y;
      const r1 = (v) => Math.round(v * 10) / 10;
      return { x: r1(x), y: r1(y), bbox: [r1(got.left), r1(got.top), r1(got.w), r1(got.h)] };
    },

    /** Eased cursor move. Records the endpoints; the compositor draws the path. */
    async moveTo(target, ms = 620, opts = {}) {
      const to = await rec.point(target, opts);
      const from = cursor || { x: Math.max(24, to.x - 260), y: Math.min(height - 24, to.y + 190) };
      lastBox = to.bbox || null;
      logEvent('move', { from: { x: from.x, y: from.y }, to: { x: to.x, y: to.y }, ms });
      if (overlays) {
        await installOverlay(opts.contextId);
        await rec.eval(`(() => { const k = document.getElementById('nema-cur'); k.style.transitionDuration = '${ms}ms'; k.style.left = '${to.x}px'; k.style.top = '${to.y}px'; return true; })()`, opts.contextId);
      }
      cursor = { x: to.x, y: to.y };
      await sleep(ms + 60);
      return to;
    },

    /** Move, then a real input event so the page reacts the way a click does. */
    async click(target, { ms = 620, settleMs = 380, ...opts } = {}) {
      const p = await rec.moveTo(target, ms, opts);
      await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: p.x, y: p.y, buttons: 0 });
      await sleep(70);
      logEvent('click', { x: p.x, y: p.y, bbox: p.bbox || lastBox || null });
      await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: p.x, y: p.y, button: 'left', buttons: 1, clickCount: 1 });
      await sleep(60);
      await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: p.x, y: p.y, button: 'left', buttons: 0, clickCount: 1 });
      await sleep(settleMs);
      return p;
    },

    /** Hold still for a beat. The only thing a take needs between moments. */
    async settle(ms = 800) { await sleep(ms); },

    /**
     * Ask the camera for a push, either at a point or at an element.
     *   r.zoom(720, 300, 1.6, 2000)
     *   r.zoom('[data-req-line]', { scale: 1.5, holdMs: 2400 })
     */
    async zoom(a, b, c, d) {
      let p; let scale = 1.6; let holdMs = 1800;
      if (typeof a === 'number' && typeof b === 'number') {
        p = { x: a, y: b };
        if (typeof c === 'number') scale = c;
        if (typeof d === 'number') holdMs = d;
      } else {
        const opts = (typeof b === 'object' && b) || {};
        p = await rec.point(a, opts);
        if (typeof opts.scale === 'number') scale = opts.scale;
        if (typeof opts.holdMs === 'number') holdMs = opts.holdMs;
      }
      logEvent('zoom', { x: p.x, y: p.y, scale, holdMs, bbox: p.bbox || null });
      return p;
    },

    async start(name) {
      takeName = name; framesDir = path.join(out, name + '-frames');
      fs.rmSync(framesDir, { recursive: true, force: true }); fs.mkdirSync(framesDir);
      frames.length = 0; events = []; cursor = null; lastBox = null; captureSize = null; t0 = 0; recording = true; wallStart = Date.now();
      await send('Page.startScreencast', {
        format: captureFormat, ...(captureFormat === 'jpeg' ? { quality: captureQuality } : {}),
        maxWidth: Math.round(width * deviceScaleFactor), maxHeight: Math.round(height * deviceScaleFactor),
        everyNthFrame: 1
      });
    },
    async stop() { wallEnd = Date.now(); await send('Page.stopScreencast'); recording = false; await sleep(300); return rec.encode(); },
    async take(name, fn) { await rec.start(name); try { await fn(); } finally { return await rec.stop(); } },
    sleep,
    async close() { if (recording) await rec.stop(); ws.close(); proc.kill(); },
    encode() {
      const name = takeName;
      if (!frames.length) return null;
      // Build a concat list with real durations, then encode at a fixed fps:
      // ffmpeg duplicates or drops frames so the output clock is constant, which
      // is what the compositor seeks against.
      const list = path.join(out, name + '.txt');
      const total = (wallEnd - wallStart) / 1000;
      let txt = '';
      for (let i = 0; i < frames.length; i++) {
        const dur = i + 1 < frames.length ? Math.max(1 / (fps * 2), frames[i + 1].t - frames[i].t) : Math.max(0.5, total - frames[i].t);
        txt += `file '${frames[i].file}'\nduration ${dur.toFixed(3)}\n`;
      }
      txt += `file '${frames[frames.length - 1].file}'\n`;
      fs.writeFileSync(list, txt);
      const rw = Math.round(width * deviceScaleFactor); const rh = Math.round(height * deviceScaleFactor);
      const mp4 = path.join(out, name + '.mp4');
      execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', list,
        '-vf', `fps=${fps},scale=${rw}:${rh}:flags=lanczos,format=${rawPix}`,
        // A short keyframe interval: the compositor seeks to every single frame.
        '-g', String(Math.round(fps / 2)), '-keyint_min', '1', '-sc_threshold', '0',
        '-c:v', 'libx264', '-preset', rawPreset, '-crf', String(rawCrf), '-r', String(fps), mp4]);

      const log = {
        take: name,
        capture: captureSize,
        width, height, deviceScaleFactor, fps,
        epoch: Number(t0.toFixed(3)),
        duration: Number(Math.max(total, frames[frames.length - 1].t + 0.5).toFixed(3)),
        video: mp4,
        events: events.slice().sort((a, b) => a.t - b.t)
      };
      fs.writeFileSync(path.join(out, name + '.events.json'), JSON.stringify(log, null, 2));
      fs.writeFileSync(path.join(out, 'events.json'), JSON.stringify(log, null, 2));
      const jsonl = toJsonl(log);
      fs.writeFileSync(path.join(out, name + '.events.jsonl'), jsonl);
      fs.writeFileSync(path.join(out, 'events.jsonl'), jsonl);
      return mp4;
    },
  };
  return rec;
}
