// The studio compositor as a single ffmpeg filtergraph. Same picture as
// studio.mjs, no browser in the loop: Chrome for Testing is only needed to
// record, because native WebMCP needs it, and compositing is arithmetic.
//
//   node scripts/video/studio-ffmpeg.mjs <takeDir> [options]
//
//   --wallpaper <path>   desktop wallpaper (default: macOS Sonoma dark)
//   --out <dir>          where the files land (default <takeDir>)
//   --out-name <stem>    file stem (default out)
//   --title <text>       the text in the window title bar
//   --video <path>       source video (default: the log's own raw.mp4)
//   --speedup            compress idle spans through the polish stage first
//   --idle-speed <n>     how fast the idle spans run (default 6)
//   --zoom-scale <n>     the camera's push (default 1.55)
//   --crf <n>            x264 quality for the 4K master (default 16)
//   --keep-assets        leave the pre rendered pngs behind for inspection
//   --gif <seconds>      length of the preview gif (default 6)
//   --dry-run            print the graph and the command, render nothing
//   --no-camera          leave the camera at rest (the source already moves it)
//   --no-cursor          do not draw a pointer (the source already has one)
//   --polish-meta <p>    polish's zoom map, so a ripple drawn here follows the
//                        content the polished video has already moved
//
// Output: <out>/<stem>-4k.mp4 (3840x2160) and <out>/<stem>-1080.mp4, from one
// ffmpeg invocation with a split.
//
// The layout is the same one studio.html lays out in CSS, at u = 2:
//   frame 3840x2160, window 2880x1872 at (480, 80), 72 px title bar, radius 28,
//   the recording 1:1 at 2880x1800, captions on the wallpaper under the window.
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SCRATCH = '/tmp/claude-1000/-home-dark-Desktop-Projects/b5daf22a-b862-4b2b-ad5a-8aa4e872e169/scratchpad';
const DEFAULT_WALL = path.join(SCRATCH, 'wall/apple/sonoma-dark-169.png');

/* ------------------------------------------------------------- options -- */

const argv = process.argv.slice(2);
const positional = [];
const opt = {};
const FLAGS = new Set(['speedup', 'keep-assets', 'dry-run', 'no-camera', 'no-cursor']);
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a.startsWith('--')) {
    const key = a.slice(2);
    if (FLAGS.has(key)) opt[key] = true; else opt[key] = argv[++i];
  } else positional.push(a);
}

const takeDir = positional[0] || path.join(SCRATCH, 'studio/proof');
const log = JSON.parse(fs.readFileSync(opt.events || path.join(takeDir, 'events.json'), 'utf8'));
const outDir = opt.out || takeDir;
const stem = opt['out-name'] || 'out';
const title = opt.title || log.title || 'Saucier School';
const fps = Number(log.fps || 30);
const crf = String(opt.crf || 16);
const ZOOM = Number(opt['zoom-scale'] || 1.55);
let videoPath = path.resolve(opt.video || log.video || path.join(takeDir, 'raw.mp4'));
let wallpaper = opt.wallpaper === undefined ? DEFAULT_WALL : opt.wallpaper;
if (wallpaper && !fs.existsSync(wallpaper)) {
  console.warn('wallpaper not found, falling back to a flat navy: ' + wallpaper);
  wallpaper = null;
}
if (!fs.existsSync(videoPath)) { console.error('no video at ' + videoPath); process.exit(2); }

/* --------------------------------------------------------------- layout -- */

// Two scales. The scene is built at the recording's own pixel density, so the
// page is never resampled up: at 1440x900 recorded with deviceScaleFactor 3 the
// scene is 5760x3240 with a 4320 px wide window. The camera then crops and
// lands on a 3840x2160 output, which is a 1.5x downscale at rest (2880/4320 =
// 0.6667) and about 1:1 at the 1.55 push. Everything drawn on the frame rather
// than in the scene, which is the captions, is made at the output scale.
const probe0 = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0',
  '-show_entries', 'stream=width,height', '-of', 'json', videoPath], { encoding: 'utf8' })).streams[0];
const SRC_W = log.width || 1440, SRC_H = log.height || 900;
const OUT_U = 2;                                        // 3840x2160
const OW = 1920 * OUT_U, OH = 1080 * OUT_U;
const U = Math.max(OUT_U, Math.round((probe0.width / SRC_W) * 2) / 2);   // scene scale
const FW = 1920 * U, FH = 1080 * U;
const PAGE_W = Math.round(SRC_W * U), PAGE_H = Math.round(SRC_H * U);
const BAR = Math.round(36 * U);
const WIN = { x: Math.round((FW - PAGE_W) / 2), y: Math.round(40 * U), w: PAGE_W, h: PAGE_H + BAR, bar: BAR, radius: Math.round(14 * U) };
const IN_MS = 0.6, OUT_MS = 0.7, HOLD_MS = 1.8;
const RIPPLE_S = 0.4, FADE = 0.24;

const toScene = (p) => ({ x: WIN.x + p.x * U, y: WIN.y + BAR + p.y * U });

/* ---------------------------------------------------------------- easing -- */

function bezier(x1, y1, x2, y2) {
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
}
const easeCamera = bezier(0.2, 0.7, 0.2, 1);
const easeCursor = bezier(0.42, 0, 0.22, 1);
const lerp = (a, b, u) => a + (b - a) * u;

/**
 * A ramp, sampled. ffmpeg has no bezier, so each eased span becomes a handful of
 * linear pieces cut on the curve: at 60 ms a piece the joins are invisible and
 * the motion is the compositor's, not a cosine stand in.
 */
function ramp(out, t0, t1, from, to, ease, steps = 10) {
  for (let i = 1; i <= steps; i++) {
    const u = i / steps;
    out.push([t0 + (t1 - t0) * u, from.map((v, k) => lerp(v, to[k], ease(u)))]);
  }
}

/** Nested if() over linear pieces: the ffmpeg form of a keyframed track. */
function expr(kfs, dim, T = 't') {
  const v = (k) => k[1][dim].toFixed(4);
  let out = v(kfs[kfs.length - 1]);
  for (let i = kfs.length - 1; i > 0; i--) {
    const [ta, a] = kfs[i - 1], [tb, b] = kfs[i];
    const piece = Math.abs(b[dim] - a[dim]) < 1e-6 || tb - ta < 1e-6
      ? v(kfs[i])
      : `(${a[dim].toFixed(4)}+(${(b[dim] - a[dim]).toFixed(4)})*(${T}-${ta.toFixed(4)})/${(tb - ta).toFixed(4)})`;
    out = `if(lt(${T},${tb.toFixed(4)}),${piece},${out})`;
  }
  return `if(lt(${T},${kfs[0][0].toFixed(4)}),${v(kfs[0])},${out})`;
}

/* The polish stage's own camera, when this composite is built on its output.
 * Mirrors zoom_filter: the crop's top left is clamped the way zoompan clamps it. */
let polishZoom = null;
if (opt['polish-meta']) {
  const m = JSON.parse(fs.readFileSync(opt['polish-meta'], 'utf8'));
  if (m.zoom) polishZoom = { ...m.zoom, w: m.video.w, h: m.video.h };
}
function polishPiece(kfs, t) {
  if (t < kfs[0][0]) return kfs[0][1];
  for (let i = 1; i < kfs.length; i++) {
    const [t0, v0] = kfs[i - 1], [t1, v1] = kfs[i];
    if (t < t1) {
      if (Math.abs(v1 - v0) < 1e-6 || t1 <= t0) return v1;
      return v0 + (v1 - v0) * (0.5 - 0.5 * Math.cos(Math.PI * (t - t0) / (t1 - t0)));
    }
  }
  return kfs[kfs.length - 1][1];
}
/** A page point, in scene pixels, as the polished video shows it at time t. */
function polishPoint(p, t) {
  const sc = toScene(p);
  if (!polishZoom) return sc;
  const z = polishPiece(polishZoom.z, t);
  const cx = polishPiece(polishZoom.x, t), cy = polishPiece(polishZoom.y, t);
  const X = Math.max(0, Math.min(polishZoom.w - polishZoom.w / z, cx - polishZoom.w / (2 * z)));
  const Y = Math.max(0, Math.min(polishZoom.h - polishZoom.h / z, cy - polishZoom.h / (2 * z)));
  const vx = (p.x * (polishZoom.w / SRC_W) - X) * z, vy = (p.y * (polishZoom.h / SRC_H) - Y) * z;
  return { x: WIN.x + (vx / polishZoom.w) * PAGE_W, y: WIN.y + BAR + (vy / polishZoom.h) * PAGE_H };
}

/* ------------------------------------------------------------- speedup -- */

/* Optional first pass through the polish stage: idle spans run fast and the
 * event log moves onto the retimed clock, so captions and clicks stay on the
 * moments they belong to. */
let remap = (t) => t;
if (opt.speedup) {
  const jsonl = path.join(takeDir, 'events.jsonl');
  const fast = path.join(outDir, stem + '-speedup.mp4');
  const metaPath = path.join(outDir, stem + '-speedup-meta.json');
  const args = [path.join(HERE, 'polish', 'polish.py'), videoPath, '--out', fast, '--speedup',
    '--idle-speed', String(opt['idle-speed'] || 6), '--emit-meta', metaPath];
  if (fs.existsSync(jsonl)) args.push('--events', jsonl);
  console.log(execFileSync('python3', args, { encoding: 'utf8' }).trim());
  videoPath = fast;
  const segs = JSON.parse(fs.readFileSync(metaPath, 'utf8')).segments;
  if (segs && segs.length) {
    const table = []; let acc = 0;
    for (const [t0, t1, sp] of segs) { table.push([t0, t1, sp, acc]); acc += (t1 - t0) / sp; }
    remap = (t) => {
      for (let i = 0; i < table.length; i++) {
        const [t0, t1, sp, o] = table[i];
        if (t <= t1 || i === table.length - 1) return o + Math.max(0, Math.min(t, t1) - t0) / sp;
      }
      return acc;
    };
  }
}

/* -------------------------------------------------------------- timeline -- */

const events = (log.events || []).slice().sort((a, b) => a.t - b.t)
  .map((e) => (opt.speedup ? { ...e, t: remap(e.t), ...(e.type === 'move' ? { ms: (remap(e.t + e.ms / 1000) - remap(e.t)) * 1000 } : {}) } : e));
const clicks = events.filter((e) => e.type === 'click');
const zooms = events.filter((e) => e.type === 'zoom');
const moves = events.filter((e) => e.type === 'move');
const captions = events.filter((e) => e.type === 'caption');

/* camera: the same clamp as the browser compositor. Both the window box and the
 * wider frame box are linear in (scale, translate), so easing between two
 * clamped states can never open a gap at the edge. */
function cameraFor(focus, s) {
  const axis = (c, f, w0, wlen, frame) => {
    const t = c - f * s;
    const lo = frame - (w0 + wlen) * s, hi = -w0 * s;
    if (lo <= hi) return Math.min(Math.max(t, lo), hi);
    return Math.min(Math.max(t, frame - frame * s), 0);
  };
  return [s, axis(FW / 2, focus.x, WIN.x, WIN.w, FW), axis(FH / 2, focus.y, WIN.y, WIN.h, FH)];
}

const anchors = [];
for (const z of zooms) anchors.push({ t: z.t, p: toScene(z), scale: z.scale || ZOOM, hold: (z.holdMs == null ? 1800 : z.holdMs) / 1000 });
for (const c of clicks) {
  if (zooms.some((z) => Math.abs(z.t - c.t) < 0.45)) continue;
  anchors.push({ t: c.t, p: toScene(c), scale: ZOOM, hold: HOLD_MS });
}
anchors.sort((a, b) => a.t - b.t);

const HOME = [1, 0, 0];
const cam = [[0, HOME]];
let state = HOME;
for (const a of (opt['no-camera'] ? [] : anchors)) {
  const target = cameraFor(a.p, a.scale);
  cam.push([a.t, state]);
  ramp(cam, a.t, a.t + IN_MS, state, target, easeCamera);
  const holdEnd = a.t + IN_MS + a.hold;
  cam.push([holdEnd, target]);
  ramp(cam, holdEnd, holdEnd + OUT_MS, target, HOME, easeCamera);
  state = HOME;
}
// zoompan works in output frame numbers, and its x/y are the top left of the
// crop in input pixels: the camera maps scene q to q*s + t, so the crop starts
// at -t/s and is 1/s of the frame.
const T = `(on/${fps})`;
const camZ = expr(cam, 0, T);
const camX = `(0-(${expr(cam, 1, T)}))/(${camZ})`;
const camY = `(0-(${expr(cam, 2, T)}))/(${camZ})`;

/* cursor: eased between the logged endpoints, held in between */
const cursorKfs = [];
for (const m of (opt['no-cursor'] ? [] : moves)) {
  const from = toScene(m.from), to = toScene(m.to);
  const dur = Math.max(1 / 60, m.ms / 1000);
  if (!cursorKfs.length) cursorKfs.push([0, [from.x, from.y]]);
  cursorKfs.push([m.t, [from.x, from.y]]);
  ramp(cursorKfs, m.t, m.t + dur, [from.x, from.y], [to.x, to.y], easeCursor);
}

/* ------------------------------------------------------- pre rendered art -- */

const assetDir = path.join(outDir, '.studio-assets');
const spec = {
  dir: assetDir, u: U, capU: OUT_U, frame: [FW, FH], out: [OW, OH], win: WIN, title,
  rippleFrames: Math.round(RIPPLE_S * fps),
  captions: captions.filter((c) => c.text).map((c) => c.text)
};
const py = spawnSync('python3', [path.join(HERE, 'studio-assets.py')], { input: JSON.stringify(spec), encoding: 'utf8' });
if (py.status !== 0) { console.error(py.stderr); process.exit(1); }
const art = JSON.parse(py.stdout);

/* ------------------------------------------------------------ the graph -- */

const duration = Number(log.duration || 0) || null;
const inputs = [];
const addInput = (args) => { inputs.push(args); return inputs.length - 1; };
// Every still has to arrive at the video's own frame rate. A -loop 1 image
// input defaults to 25 fps, and vstack then pairs frames by index, which quietly
// plays the whole composite 1.2x fast.
const still = (file, t) => addInput(['-loop', '1', '-framerate', String(fps), ...(t ? ['-t', String(t)] : []), '-i', file]);

const iVideo = addInput(['-i', videoPath]);
const probeFull = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0',
  '-show_entries', 'stream=width,height', '-show_entries', 'format=duration', '-of', 'json', videoPath], { encoding: 'utf8' }));
const DUR = Number(probeFull.format.duration);
const iWall = wallpaper ? still(wallpaper, DUR) : null;
const iBar = still(art.titlebar, DUR);
const iMask = still(art.mask, DUR);
const iShadow = still(art.shadow.path, DUR);
const iCursor = still(art.cursor.path, DUR);

const fc = [];
fc.push(iWall === null
  ? `color=c=0x0B1320:s=${FW}x${FH}:r=${fps}:d=${DUR.toFixed(3)},format=rgba[bg]`
  : `[${iWall}:v]scale=${FW}:${FH}:force_original_aspect_ratio=increase,crop=${FW}:${FH},setsar=1,format=rgba,fps=${fps}[bg]`);

// window: title bar on top of the recording, then rounded off with the mask
fc.push(`[${iBar}:v]format=rgba,fps=${fps}[tb]`);
fc.push(`[${iVideo}:v]format=rgba,setsar=1,fps=${fps}` +
  (probe0.width === PAGE_W && probe0.height === PAGE_H ? '' : `,scale=${PAGE_W}:${PAGE_H}:flags=lanczos`) + `[rv]`);
fc.push(`[tb][rv]vstack=inputs=2[win0]`);
fc.push(`[${iMask}:v]format=gray[wm]`);
fc.push(`[win0][wm]alphamerge[win]`);

fc.push(`[bg][${iShadow}:v]overlay=${art.shadow.x}:${art.shadow.y}:format=auto[bg1]`);
fc.push(`[bg1][win]overlay=${WIN.x}:${WIN.y}:format=auto[sc0]`);

let node = 'sc0';
if (cursorKfs.length) {
  const cx = expr(cursorKfs, 0), cy = expr(cursorKfs, 1);
  fc.push(`[${node}][${iCursor}:v]overlay=x='(${cx})-${art.cursor.hx}':y='(${cy})-${art.cursor.hy}'` +
    `:eval=frame:enable='gte(t,${cursorKfs[0][0].toFixed(3)})':format=auto[cur]`);
  node = 'cur';
}

clicks.forEach((c, i) => {
  const idx = addInput(['-framerate', String(fps), '-i', art.ripple.pattern]);
  fc.push(`[${idx}:v]format=rgba,tpad=start_duration=${c.t.toFixed(3)}:start_mode=add:color=0x00000000[rip${i}]`);
  let pos;
  if (polishZoom) {
    // the content moves under the overlay, so the ripple is keyframed too
    const kfs = [];
    for (let k = 0; k <= 12; k++) {
      const t = c.t + (RIPPLE_S * k) / 12;
      const q = polishPoint(c, t);
      kfs.push([t, [q.x - art.ripple.size / 2, q.y - art.ripple.size / 2]]);
    }
    pos = `x='${expr(kfs, 0)}':y='${expr(kfs, 1)}':eval=frame`;
  } else {
    const p = toScene(c);
    pos = `${Math.round(p.x - art.ripple.size / 2)}:${Math.round(p.y - art.ripple.size / 2)}`;
  }
  fc.push(`[${node}][rip${i}]overlay=${pos}:eof_action=pass:repeatlast=0:format=auto[rp${i}]`);
  node = `rp${i}`;
});

// the camera, then everything that lives on the frame rather than in the scene
fc.push(`[${node}]zoompan=z='${camZ}':x='${camX}':y='${camY}':d=1:s=${OW}x${OH}:fps=${fps}[cam]`);
node = 'cam';

let capIndex = 0;
captions.forEach((c, i) => {
  if (!c.text) return;
  const art_c = art.captions[capIndex++];
  const next = captions[i + 1] ? captions[i + 1].t : DUR;
  const span = Math.max(0.3, next - c.t);
  const idx = still(art_c.path, span);
  const x = Math.round((OW - art_c.w) / 2);
  const y = Math.round(OH - 22 * OUT_U - art_c.pillBottom);
  fc.push(`[${idx}:v]format=rgba,fade=t=in:st=0:d=${FADE}:alpha=1,` +
    `fade=t=out:st=${Math.max(0, span - FADE).toFixed(3)}:d=${FADE}:alpha=1,` +
    `tpad=start_duration=${c.t.toFixed(3)}:start_mode=add:color=0x00000000[cp${i}]`);
  fc.push(`[${node}][cp${i}]overlay=${x}:${y}:eof_action=pass:repeatlast=0:format=auto[cc${i}]`);
  node = `cc${i}`;
});

fc.push(`[${node}]format=yuv420p,split=2[v4k][v1080pre]`);
fc.push(`[v1080pre]scale=1920:1080:flags=lanczos[v1080]`);

const out4k = path.join(outDir, stem + '-4k.mp4');
const out1080 = path.join(outDir, stem + '-1080.mp4');
const cmd = [
  '-y', '-loglevel', 'error', '-nostats',
  ...inputs.flat(),
  '-filter_complex', fc.join(';'),
  '-map', '[v4k]', '-c:v', 'libx264', '-preset', 'slow', '-crf', crf,
  '-profile:v', 'high', '-level', '5.1',
  '-pix_fmt', 'yuv420p', '-r', String(fps), '-movflags', '+faststart', '-t', DUR.toFixed(3), out4k,
  '-map', '[v1080]', '-c:v', 'libx264', '-preset', 'medium', '-crf', '18',
  '-pix_fmt', 'yuv420p', '-r', String(fps), '-movflags', '+faststart', '-t', DUR.toFixed(3), out1080
];

if (opt['dry-run']) {
  console.log(fc.join(';\n'));
  console.log('\nffmpeg ' + cmd.map((a) => (/[ '"]/.test(a) ? JSON.stringify(a) : a)).join(' '));
  process.exit(0);
}

console.log(`compositing ${DUR.toFixed(2)}s: source ${probe0.width}x${probe0.height}, scene ${FW}x${FH}, ` +
  `window ${WIN.w}x${WIN.h}, out ${OW}x${OH} (window shows the page at ${(PAGE_W * (OW / FW) / probe0.width).toFixed(4)} of native), ` +
  `${inputs.length} inputs, ${fc.length} filters`);
const t0 = Date.now();
const r = spawnSync('ffmpeg', cmd, { stdio: ['ignore', 'inherit', 'inherit'] });
if (r.status !== 0) process.exit(r.status || 1);
const took = (Date.now() - t0) / 1000;

// A six second preview, from the 1080 file so the palette pass is cheap.
const gif = path.join(outDir, stem + '.gif');
const palette = path.join(outDir, stem + '-palette.png');
const gifVf = 'fps=12,scale=640:-1:flags=lanczos';
const gifSeconds = String(opt.gif || 6);
execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-t', gifSeconds, '-i', out1080,
  '-vf', `${gifVf},palettegen=stats_mode=diff`, palette]);
execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-t', gifSeconds, '-i', out1080, '-i', palette,
  '-lavfi', `${gifVf}[x];[x][1:v]paletteuse=dither=bayer:bayer_scale=3`, gif]);
fs.rmSync(palette, { force: true });

if (!opt['keep-assets']) fs.rmSync(assetDir, { recursive: true, force: true });

const frames = Math.round(DUR * fps);
console.log(`\n4k          ${out4k}`);
console.log(`1080        ${out1080}`);
console.log(`gif         ${gif}`);
console.log(`render      ${took.toFixed(1)}s for ${frames} frames (${(frames / took).toFixed(1)} fps, ` +
  `${(DUR / took).toFixed(2)}x realtime)`);
