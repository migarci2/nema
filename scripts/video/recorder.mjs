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
import { path as ghostPath } from 'ghost-cursor';

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


/* --------------------------------------------------------- the pointer -- */

/* The page's own account of the pointer. Every mouse move we dispatch lands here
 * with the element it actually hit and the cursor that element asks for, on the
 * page's clock, so the film can swap the arrow for the hand exactly where a
 * person would see it swap. The mapping mirrors css_to_kind in cursors.py. */
const CURSOR_PROBE = `(() => {
  if (window.__nemaCursor) return true;
  const state = { log: [] };
  window.__nemaCursor = state;
  const textish = (el) => el.tagName === 'TEXTAREA' ||
    (el.tagName === 'INPUT' && !/^(button|submit|checkbox|radio|range|color|file|reset|image)$/i.test(el.type || 'text'));
  addEventListener('mousemove', (e) => {
    const el = document.elementFromPoint(e.clientX, e.clientY) || e.target;
    let css = 'auto';
    if (el && el.nodeType === 1) {
      css = getComputedStyle(el).cursor;
      if (css === 'auto' && textish(el)) css = 'text';
    }
    state.log.push([performance.timeOrigin + performance.now(), e.clientX, e.clientY, css]);
    if (state.log.length > 6000) state.log.splice(0, 3000);
  }, true);
  return true;
})()`;

/** A CSS cursor keyword as one of the three pointers we draw. */
function cursorKind(css) {
  const c = String(css || '').split(',').pop().trim().toLowerCase();
  if (c === 'pointer' || c === 'grab' || c === 'grabbing') return 'hand';
  if (c === 'text' || c === 'vertical-text') return 'text';
  return 'arrow';
}

/**
 * ghost-cursor's path, resampled onto a 20 Hz grid and scaled to the duration a
 * take asks for. Scaling is uniform, so the velocity profile it computed, slow
 * at both ends, fast in the middle, with the overshoot near the target, is kept
 * exactly; only the total length changes.
 */
function humanPath(from, to, ms, { hz = 20, moveSpeed, spread } = {}) {
  let pts;
  try {
    pts = ghostPath({ x: from.x, y: from.y }, { x: to.x, y: to.y }, {
      useTimestamps: true,
      ...(moveSpeed ? { moveSpeed } : {}),
      ...(spread != null ? { spreadOverride: spread } : {})
    });
  } catch {
    pts = null;
  }
  if (!pts || pts.length < 2) {
    pts = [{ x: from.x, y: from.y, timestamp: 0 }, { x: to.x, y: to.y, timestamp: ms }];
  }
  const t0 = pts[0].timestamp;
  const span = pts[pts.length - 1].timestamp - t0 || 1;
  const total = ms || span;
  const k = total / span;
  const n = Math.max(2, Math.round((total / 1000) * hz));
  const out = [];
  let j = 0;
  for (let i = 0; i <= n; i++) {
    const t = (i / n) * total;
    const src = t / k + t0;
    while (j < pts.length - 2 && pts[j + 1].timestamp <= src) j += 1;
    const a = pts[j], b = pts[j + 1] || pts[j];
    const d = (b.timestamp - a.timestamp) || 1;
    const f = Math.max(0, Math.min(1, (src - a.timestamp) / d));
    out.push({ t, x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f });
  }
  const end = out[out.length - 1];
  end.x = to.x; end.y = to.y;
  return out;
}

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


/* --------------------------------------------------------------- jsonl -- */

// The event log in the shape scripts/video/polish/polish.py reads: a header, then
// 60 Hz cursor samples and down/up pairs. Two rules its loader depends on, both
// of which cost a run of zero zoom-ins when they are broken: `t` is seconds since
// the header epoch, never an absolute epoch time, and x/y are display points, the
// same units as `display`, which the loader scales to video pixels itself.
export function toJsonl(log, { pressMs = 100 } = {}) {
  const lines = [JSON.stringify({ type: 'header', epoch: log.epoch || 0, display: { w: log.width, h: log.height } })];
  const r3 = (v) => Number(v.toFixed(3));
  const push = (o) => lines.push(JSON.stringify(o));
  const tap = (t, x, y, bbox, cursor) => {
    push({ t: r3(t), type: 'down', x: r3(x), y: r3(y), button: 'left', ...(cursor ? { cursor } : {}), ...(bbox ? { bbox } : {}) });
    push({ t: r3(t + pressMs / 1000), type: 'up', x: r3(x), y: r3(y), button: 'left' });
  };
  for (const e of log.events) {
    if (e.type === 'move') {
      // the samples that were really dispatched, with the pointer the page
      // asked for at each one
      for (const [t, x, y, kind] of e.samples || []) push({ t: r3(t), type: 'move', x, y, cursor: kind });
    } else if (e.type === 'click') {
      tap(e.t, e.x, e.y, e.bbox, e.cursor);
    } else if (e.type === 'zoom') {
      // An explicit zoom is a place the film should look at, which is exactly
      // what a click means to the polish stage.
      tap(e.t, e.x, e.y, e.bbox, null);
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
  const probe = []; let probing = false; let latency = 0;
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); return; }
    if (m.method === 'Page.screencastFrame') {
      const { data, sessionId, metadata } = m.params;
      // A byte size is enough to find a frame that went black, which is how the
      // screencast's own delay gets measured. No decoding, no dependency.
      if (probing) probe.push({ ts: metadata.timestamp, size: data.length });
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
  // One clock for everything: the screencast stamps each frame with seconds
  // since the epoch, the page reports performance.timeOrigin + performance.now()
  // in the same units, and Node's Date.now() is the same clock again. Events are
  // logged raw here and shifted by the measured screencast delay when the log is
  // written, so an overlay lands on the frame that actually shows the effect.
  const clockAt = (wallMs) => (t0 ? Math.max(0, wallMs / 1000 - t0) : 0);
  const logEventAt = (wallMs, type, data = {}) => {
    const e = { t: Number(clockAt(wallMs).toFixed(3)), type, ...data };
    if (recording) events.push(e);
    return e;
  };
  const logEvent = (type, data = {}) => logEventAt(Date.now(), type, data);
  let captureSize = null; // what the screencast actually delivered, in pixels
  let cursor = null; // last known cursor point, page CSS pixels
  let lastBox = null; // box of the element the cursor last moved to
  let lastKind = 'arrow'; // the pointer the page last asked for
  // A take may not stop while the camera is still pushed in. Every click and
  // every zoom sets the wall clock time before which stop() must not return:
  // the compositor needs 600 ms to ease in, the hold, and 700 ms to ease out.
  let restBy = 0;
  const CAMERA_TAIL = 1500;

  /* The renderer has drained its input queue and painted when two animation
   * frames have gone by. Every place the take needs the page to have caught up,
   * a scroll, the end of a move, the press, waits on this rather than a guess,
   * and it returns the page's own clock so the moment can be logged. */
  const settled = async (contextId) => {
    const v = await rec.eval(`new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(() => done(performance.timeOrigin + performance.now()))))`, contextId)
      .catch(() => null);
    return Number(v) || Date.now();
  };

  const installProbe = async (contextId) => {
    await send('Runtime.evaluate', { expression: CURSOR_PROBE, ...(contextId ? { contextId } : {}), returnByValue: true });
  };

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
    async goto(url, waitMs = 2500) { await send('Page.navigate', { url }); await sleep(waitMs); await installOverlay(); await installProbe(); },
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
      const got = await rec.eval(`(() => { const el = document.querySelector(${JSON.stringify(sel)}); if (!el) return null; const was = window.scrollY; el.scrollIntoView({ block: 'center', behavior: 'instant' }); const b = el.getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2, w: b.width, h: b.height, left: b.left, top: b.top, scrolled: Math.abs(window.scrollY - was) > 1 }; })()`, contextId);
      if (!got) throw new Error('no element for ' + sel);
      if (got.scrolled) await settled(contextId);   // a scroll repaints everything
      // Wide elements read better with the cursor a little left of centre, the
      // way a hand lands on a button rather than dead centre of a banner.
      const x = offset ? got.x - got.w / 2 + offset[0] : Math.min(got.x, got.x - got.w / 2 + 220);
      const y = offset ? got.y - got.h / 2 + offset[1] : got.y;
      const r1 = (v) => Math.round(v * 10) / 10;
      return { x: r1(x), y: r1(y), bbox: [r1(got.left), r1(got.top), r1(got.w), r1(got.h)] };
    },

    /**
     * A human move. ghost-cursor builds the shape, a Bezier with Fitts's law
     * timing and a little overshoot, and every point on it is dispatched as a
     * real CDP mouse move at 60 Hz, so the page runs its own hover styles, its
     * button lift and its cursor changes exactly as it would under a hand. The
     * samples that come back, with the pointer the page asked for at each one,
     * are what the compositors replay.
     */
    async moveTo(target, ms = 620, opts = {}) {
      const to = await rec.point(target, opts);
      const from = cursor || { x: Math.max(24, to.x - 260), y: Math.min(height - 24, to.y + 190) };
      lastBox = to.bbox || null;
      await installProbe(opts.contextId);
      await rec.eval('window.__nemaCursor.log.length = 0; true', opts.contextId);

      /* Sent on the clock, not on the ack. Awaiting each dispatch costs about
       * 88 ms a move on this machine, which stretches a 900 ms move to five
       * seconds; sending them paced and awaiting the batch at the end delivers
       * the same 54 events in 885 ms, all of them processed. */
      const samples = humanPath(from, to, ms, opts);
      const startWall = Date.now();
      const dispatched = [];
      const inFlight = [];
      for (const s of samples) {
        const wait = startWall + s.t - Date.now();
        if (wait > 1) await sleep(wait);
        dispatched.push({ w: Date.now(), x: s.x, y: s.y });
        inFlight.push(send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: s.x, y: s.y, buttons: 0 }));
      }
      await Promise.all(inFlight);
      await settled(opts.contextId);   // the hover the last sample asked for is on screen
      cursor = { x: to.x, y: to.y };

      /* What the page saw, matched back to what we sent on the shared clock. */
      let seen = [];
      try { seen = JSON.parse(await rec.eval('JSON.stringify(window.__nemaCursor.log)', opts.contextId) || '[]'); } catch { seen = []; }
      /* Matched by order, not by clock. Each dispatch produces exactly one
       * mousemove and they arrive in order, while the page may run a couple of
       * hundred milliseconds behind on its own event loop; matching on
       * timestamps therefore reads the pointer from a point the cursor has
       * already left, and the hand appears late. */
      /* Each sample is stamped with the moment the page handled it, not the
       * moment it was sent. Under a software raster at this size the renderer
       * runs a few hundred milliseconds behind a burst of mouse moves, and a
       * pointer drawn on the send times arrives on a button whose hover has not
       * painted yet, which is exactly the lag the film showed. On the page's own
       * times the drawn pointer and the page's reaction are the same event. */
      let kind = lastKind;
      const byIndex = seen.length === dispatched.length;
      const out = dispatched.map((d, i) => {
        let hit = null;
        if (byIndex) hit = seen[i];
        else {
          let bestGap = Infinity;
          for (const e of seen) {
            const gap = Math.abs(e[1] - d.x) + Math.abs(e[2] - d.y);
            if (gap < bestGap) { bestGap = gap; hit = e; }
          }
          if (bestGap > 6) hit = null;
        }
        if (hit) kind = cursorKind(hit[3]);
        const when = hit ? hit[0] : d.w;
        return [Number(clockAt(when).toFixed(3)), Math.round(d.x * 10) / 10, Math.round(d.y * 10) / 10, kind];
      });
      lastKind = kind;
      const first = dispatched[0] ? dispatched[0].w : startWall;
      const last = dispatched[dispatched.length - 1] ? dispatched[dispatched.length - 1].w : startWall;
      logEventAt(first, 'move', {
        from: { x: from.x, y: from.y }, to: { x: to.x, y: to.y },
        ms: Math.round(last - first), cursor: kind, samples: out
      });
      return to;
    },

    /**
     * Move, settle, then a real press. The pause before the press and the press
     * itself are long enough to land in frames: a click that is dispatched and
     * released inside one frame is invisible, however correct it is.
     */
    async click(target, { ms = 620, settleMs = 380, pressMs = 100, preSettleMs = 80, ...opts } = {}) {
      const p = await rec.moveTo(target, ms, opts);
      await sleep(preSettleMs);
      await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: p.x, y: p.y, button: 'left', buttons: 1, clickCount: 1 });
      /* The click is stamped when the press is on screen, not when it was sent.
       * Two animation frames after the dispatch the renderer has committed the
       * frame carrying the pressed state, and the page's own clock at that
       * moment is the frame the ripple belongs on. Measured on this page it is
       * about 30 ms, one frame, after the dispatch; the screencast itself adds
       * nothing measurable on top. */
      const shown = await settled(opts.contextId);
      logEventAt(shown, 'click', { x: p.x, y: p.y, bbox: p.bbox || lastBox || null, cursor: lastKind });
      restBy = Math.max(restBy, Date.now() + 1800 + CAMERA_TAIL);
      await sleep(pressMs);
      await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: p.x, y: p.y, button: 'left', buttons: 0, clickCount: 1 });
      await sleep(settleMs);
      await rec.nudge(opts.contextId).catch(() => {});
      return p;
    },

    /**
     * One mouse move that goes nowhere. The page re-runs its hit test at the
     * point the pointer is already on, so a rebuild that put plain text under a
     * pointer that was over a button gets the pointer it deserves. Cheap enough
     * to do after every click and after every long pause.
     */
    async nudge(contextId = null) {
      if (!cursor) return lastKind;
      await installProbe(contextId);
      await rec.eval('window.__nemaCursor.log.length = 0; true', contextId).catch(() => {});
      await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: cursor.x, y: cursor.y, buttons: 0 });
      const when = await settled(contextId);
      let seen = [];
      try { seen = JSON.parse(await rec.eval('JSON.stringify(window.__nemaCursor.log)', contextId) || '[]'); } catch { seen = []; }
      const kind = seen.length ? cursorKind(seen[seen.length - 1][3]) : lastKind;
      if (kind !== lastKind) {
        lastKind = kind;
        logEventAt(when, 'move', {
          from: { x: cursor.x, y: cursor.y }, to: { x: cursor.x, y: cursor.y }, ms: 0, cursor: kind,
          samples: [[Number(clockAt(when).toFixed(3)), cursor.x, cursor.y, kind]]
        });
      }
      return kind;
    },

    /**
     * A small idle move, the way a hand comes off what it was reading. Keeps the
     * pointer from sitting on top of the text the camera just framed.
     */
    async drift(dx = 30, dy = 22, ms = 420) {
      if (!cursor) return null;
      const to = {
        x: Math.max(6, Math.min(width - 6, cursor.x + dx)),
        y: Math.max(6, Math.min(height - 6, cursor.y + dy))
      };
      return rec.moveTo(to, ms, { moveSpeed: 2 });
    },

    /** Hold still for a beat. The only thing a take needs between moments. */
    async settle(ms = 800) {
      await sleep(ms);
      // A long pause is where a page rebuilds itself under a resting pointer.
      if (ms >= 600) await rec.nudge().catch(() => {});
    },

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
      restBy = Math.max(restBy, Date.now() + holdMs + CAMERA_TAIL);
      return p;
    },

    /**
     * How long the screencast runs behind the page, measured rather than
     * assumed: flash the page to solid black, note the page's own clock at that
     * moment, and find the first frame whose bytes collapse. The gap is added to
     * every event time when the log is written, so a ripple drawn at the click
     * lands on the frame that shows the button pressed instead of two frames
     * early. Run it once, on the page and at the scale about to be recorded.
     */
    async measureLatency({ tries = 3 } = {}) {
      const got = [];
      for (let i = 0; i < tries; i++) {
        probe.length = 0; probing = true;
        await send('Page.startScreencast', {
          format: captureFormat, ...(captureFormat === 'jpeg' ? { quality: captureQuality } : {}),
          maxWidth: Math.round(width * deviceScaleFactor), maxHeight: Math.round(height * deviceScaleFactor),
          everyNthFrame: 1
        });
        await sleep(500);
        const baseline = probe.length ? probe.map((f) => f.size).sort((a, b) => a - b)[probe.length >> 1] : 0;
        const marked = probe.length;
        /* The clock is read after two animation frames, which is when the
         * renderer has committed the frame carrying the change. Reading it at
         * the DOM write instead would fold the page's own paint cost into the
         * number, and a full screen repaint at this size costs far more than the
         * small repaints a real take makes: it measured 142 ms that way against
         * 29 ms for an actual button press. */
        const at = await rec.eval(`new Promise((done) => { const d = document.createElement('div'); d.id = 'nema-flash'; d.style.cssText = 'position:fixed;inset:0;background:#000;z-index:2147483647'; document.body.appendChild(d); requestAnimationFrame(() => requestAnimationFrame(() => done(performance.timeOrigin + performance.now()))); })`);
        await sleep(700);
        await send('Page.stopScreencast'); probing = false;
        await rec.eval(`(() => { const d = document.getElementById('nema-flash'); if (d) d.remove(); return true; })()`);
        const hit = probe.slice(marked).find((f) => baseline && f.size < baseline * 0.5);
        if (hit && at) got.push(hit.ts - at / 1000);
        await sleep(250);
      }
      got.sort((a, b) => a - b);
      latency = got.length ? Math.max(0, Number(got[got.length >> 1].toFixed(3))) : 0;
      return { latency, samples: got.map((v) => Number(v.toFixed(3))) };
    },
    get latency() { return latency; },

    async start(name) {
      takeName = name; framesDir = path.join(out, name + '-frames');
      fs.rmSync(framesDir, { recursive: true, force: true }); fs.mkdirSync(framesDir);
      // cursor and lastKind survive a take boundary on purpose: the pointer is
      // where the last shot left it, and it should not teleport between takes.
      frames.length = 0; events = []; lastBox = null; captureSize = null; restBy = 0; t0 = 0; recording = true; wallStart = Date.now();
      await send('Page.startScreencast', {
        format: captureFormat, ...(captureFormat === 'jpeg' ? { quality: captureQuality } : {}),
        maxWidth: Math.round(width * deviceScaleFactor), maxHeight: Math.round(height * deviceScaleFactor),
        everyNthFrame: 1
      });
    },
    async stop() {
      /* No take ends mid push. The last click or zoom set the moment the camera
       * can be home again; the recording runs until then whatever the take
       * asked for, so the compositor always has room to ease out. */
      const owed = restBy - Date.now();
      if (owed > 0) { console.log(`  holding ${Math.round(owed)} ms so the camera can come to rest`); await sleep(owed); }
      wallEnd = Date.now(); await send('Page.stopScreencast'); recording = false; await sleep(300); return rec.encode();
    },
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

      const shift = (e) => {
        const moved = { ...e, t: Number((e.t + latency).toFixed(3)) };
        if (e.samples) moved.samples = e.samples.map(([t, x, y, k]) => [Number((t + latency).toFixed(3)), x, y, k]);
        return moved;
      };
      const log = {
        take: name,
        capture: captureSize,
        width, height, deviceScaleFactor, fps,
        epoch: Number(t0.toFixed(3)),
        latency,
        duration: Number(Math.max(total, frames[frames.length - 1].t + 0.5).toFixed(3)),
        video: mp4,
        events: events.slice().sort((a, b) => a.t - b.t).map(shift)
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
