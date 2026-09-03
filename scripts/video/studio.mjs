// The studio compositor: a raw CDP screencast plus its event log, rendered into
// a Screen Studio style shot by a second headless Chrome. No display, no screen
// capture, no GUI: the page in studio.html is stepped one frame at a time and
// each frame is taken with Page.captureScreenshot, so the render is
// deterministic and repeatable.
//
//   CHROME=<chrome> node scripts/video/studio.mjs <takeDir> [options]
//
//   --events <path>      event log (default <takeDir>/events.json)
//   --video <path>       raw screencast (default: the log's own video)
//   --wallpaper <path>   desktop wallpaper png (default: macOS Sonoma dark)
//   --out <dir>          where out.mp4 and preview.gif land (default <takeDir>)
//   --title <text>       the text in the window title bar
//   --fps <n>            output frame rate (default 30)
//   --gif <seconds>      length of the preview gif (default 6)
//   --seconds <n>        render only the first n seconds (a quick look)
//   --source raw|polished   raw.mp4, or polished.mp4 from the polish stage with
//                        its own zoom and cursor already in the picture
//   --frame 4k|1080p     output size (default 4k: 3840x2160, the page 1:1)
//   --out-name <stem>    stem for the files (default out)
//
// Output: <out>/<stem>.mp4 (4K), <out>/<stem>-1080p.mp4, <out>/<stem>.gif,
//         <out>/<stem>-sample-*.png
//   --keep-frames        do not delete the png frames afterwards
//
// Output: <out>/out.mp4, <out>/preview.gif, <out>/frames/*.png
import { spawn, execFileSync } from 'node:child_process';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SCRATCH = '/tmp/claude-1000/-home-dark-Desktop-Projects/b5daf22a-b862-4b2b-ad5a-8aa4e872e169/scratchpad';
const DEFAULT_WALL = path.join(SCRATCH, 'wall/apple/sonoma-dark-169.png');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ------------------------------------------------------------- options -- */

const argv = process.argv.slice(2);
const positional = [];
const opt = {};
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a.startsWith('--')) {
    const key = a.slice(2);
    if (key === 'keep-frames' || key === 'png') opt[key] = true;
    else opt[key] = argv[++i];
  } else positional.push(a);
}

const takeDir = positional[0] || path.join(SCRATCH, 'studio/proof');
const stem = opt['out-name'] || 'out';
const frame = (opt.frame || '4k').toLowerCase();
const U = frame === '1080p' ? 1 : 2;                 // frame scale, 2 is 3840x2160
const FW = 1920 * U, FH = 1080 * U;
const source = (opt.source || 'raw').toLowerCase();
// PNG is lossless but the frames are only an intermediate for x264; a high
// quality JPEG halves the capture cost at 4K and survives crf 17 untouched.
const CAP = opt.png ? { format: 'png', ext: 'png' } : { format: 'jpeg', quality: 96, ext: 'jpg' };
const eventsPath = opt.events || path.join(takeDir, 'events.json');
if (!fs.existsSync(eventsPath)) { console.error('no event log at ' + eventsPath); process.exit(2); }
const log = JSON.parse(fs.readFileSync(eventsPath, 'utf8'));
let videoPath = path.resolve(opt.video || log.video);
let polishMeta = null;
if (source === 'polished') {
  // The polish stage owns the camera and the cursor; the compositor keeps the
  // window, the wallpaper, the captions and the click ripple, and follows
  // polish's zoom map so the ripple lands on the content it belongs to.
  videoPath = path.resolve(opt.video || path.join(takeDir, 'polished.mp4'));
  const metaPath = opt.meta || path.join(takeDir, 'polish-meta.json');
  if (fs.existsSync(metaPath)) {
    const m = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
    polishMeta = { videoW: m.video.w, videoH: m.video.h, segments: m.segments, zoom: m.zoom };
  } else {
    console.warn('no polish meta at ' + metaPath + ', overlays will assume no zoom');
  }
}
if (!fs.existsSync(videoPath)) { console.error('no video at ' + videoPath); process.exit(2); }
const outDir = opt.out || takeDir;
const fps = Number(opt.fps || log.fps || 30);
const gifSeconds = Number(opt.gif || 6);
const title = opt.title || log.title || 'Saucier School';
const chrome = process.env.CHROME;
if (!chrome) { console.error('set CHROME to a Chrome binary'); process.exit(2); }

let wallpaper = opt.wallpaper === undefined ? DEFAULT_WALL : opt.wallpaper;
if (wallpaper && !fs.existsSync(wallpaper)) {
  console.warn('wallpaper not found, falling back to the brand gradient: ' + wallpaper);
  wallpaper = null;
}

const framesDir = path.join(outDir, 'frames');
fs.mkdirSync(framesDir, { recursive: true });
fs.rmSync(framesDir, { recursive: true, force: true });
fs.mkdirSync(framesDir, { recursive: true });

/* -------------------------------------------------------------- server -- */

// A file:// page cannot range request its own sibling mp4, and seeking needs
// ranges, so the compositor is served over loopback instead.
const MIME = { '.html': 'text/html', '.mp4': 'video/mp4', '.webm': 'video/webm', '.png': 'image/png', '.jpg': 'image/jpeg' };
const wallUrl = wallpaper ? '/wall' + path.extname(wallpaper) : null;
const routes = {
  '/': path.join(HERE, 'studio.html'),
  '/studio.html': path.join(HERE, 'studio.html'),
  '/source.mp4': videoPath
};
if (wallUrl) routes[wallUrl] = wallpaper;

const server = http.createServer((req, res) => {
  const file = routes[req.url.split('?')[0]];
  if (!file) { res.writeHead(404); res.end('no'); return; }
  const stat = fs.statSync(file);
  const type = MIME[path.extname(file)] || 'application/octet-stream';
  const range = req.headers.range && /bytes=(\d*)-(\d*)/.exec(req.headers.range);
  if (range) {
    const start = range[1] ? Number(range[1]) : 0;
    const end = range[2] ? Number(range[2]) : stat.size - 1;
    res.writeHead(206, {
      'content-type': type,
      'content-length': end - start + 1,
      'content-range': `bytes ${start}-${end}/${stat.size}`,
      'accept-ranges': 'bytes'
    });
    fs.createReadStream(file, { start, end }).pipe(res);
    return;
  }
  res.writeHead(200, { 'content-type': type, 'content-length': stat.size, 'accept-ranges': 'bytes' });
  fs.createReadStream(file).pipe(res);
});
const httpPort = await new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server.address().port)));

/* --------------------------------------------------------------- chrome -- */

const port = 9700 + Math.floor(Math.random() * 250);
const proc = spawn(chrome, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--hide-scrollbars',
  '--force-device-scale-factor=1', '--autoplay-policy=no-user-gesture-required',
  `--remote-debugging-port=${port}`, `--user-data-dir=/tmp/claude-1000/nema-studio-${port}`,
  `--window-size=${FW},${FH}`, 'about:blank'
], { stdio: 'ignore' });

let target = null;
for (let i = 0; i < 80 && !target; i++) {
  try { target = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find((t) => t.type === 'page'); } catch {}
  if (!target) await sleep(250);
}
if (!target) { console.error('no chrome page target'); process.exit(1); }

const ws = new WebSocket(target.webSocketDebuggerUrl);
let id = 0; const pending = new Map(); const consoleErrors = [];
ws.onmessage = (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); return; }
  if (m.method === 'Runtime.exceptionThrown') consoleErrors.push(m.params.exceptionDetails?.exception?.description || m.params.exceptionDetails?.text);
};
const send = (method, params = {}) => new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
await new Promise((r) => (ws.onopen = r));
await send('Page.enable'); await send('Runtime.enable');
await send('Emulation.setDeviceMetricsOverride', { width: FW, height: FH, deviceScaleFactor: 1, mobile: false });

const evaluate = async (expression, awaitPromise = false) => {
  const m = await send('Runtime.evaluate', { expression, awaitPromise, returnByValue: true });
  const ex = m.result?.exceptionDetails;
  if (ex) throw new Error(ex.exception?.description || ex.text);
  return m.result?.result?.value;
};

await send('Page.navigate', { url: `http://127.0.0.1:${httpPort}/` });
for (let i = 0; i < 60; i++) { if (await evaluate('typeof window.studioInit === "function"').catch(() => false)) break; await sleep(200); }

const cfg = {
  video: '/source.mp4',
  wallpaper: wallUrl,
  title,
  pageW: log.width || 1440,
  pageH: log.height || 900,
  u: U,
  polish: polishMeta,
  events: log.events || []
};
const meta = await evaluate(`window.studioInit(${JSON.stringify(cfg)})`, true);
console.log(`${source} video ${meta.videoWidth}x${meta.videoHeight} ${meta.duration.toFixed(2)}s -> ${FW}x${FH}`);

/* --------------------------------------------------------------- render -- */

// The same rule the ffmpeg compositor follows: the film runs a second past the
// source so it ends on the window at rest. seekTo clamps to the last frame and
// renderAt is past every event by then, so the extra second is a held still.
const REST_S = 1.0;
let duration = polishMeta
  ? meta.duration
  : Math.max(0.5, Math.min(meta.duration, log.duration ? log.duration + 0.5 : meta.duration));
duration += REST_S;
if (opt.seconds) duration = Math.min(duration, Number(opt.seconds));
const total = Math.max(1, Math.floor(duration * fps));
console.log(`rendering ${total} frames at ${fps} fps`);
const started = Date.now();
let lastSeek = -1;
let stuck = 0;

const phase = { seek: 0, render: 0, capture: 0, write: 0 };
for (let i = 0; i < total; i++) {
  const t = i / fps;
  let mark = Date.now();
  const at = await evaluate(`window.seekTo(${t})`, true);
  phase.seek += Date.now() - mark; mark = Date.now();
  // A seek that never advances means the decoder stalled: worth saying out loud
  // rather than silently writing the same frame two hundred times.
  if (i > 0 && at === lastSeek && t > 0.2) stuck++;
  lastSeek = at;
  await evaluate(`window.renderAt(${t})`);
  phase.render += Date.now() - mark; mark = Date.now();
  const shot = await send('Page.captureScreenshot', {
    format: CAP.format, ...(CAP.quality ? { quality: CAP.quality } : {}),
    clip: { x: 0, y: 0, width: FW, height: FH, scale: 1 },
    captureBeyondViewport: false,
    fromSurface: true
  });
  if (!shot.result?.data) throw new Error('capture failed at frame ' + i);
  phase.capture += Date.now() - mark; mark = Date.now();
  fs.writeFileSync(path.join(framesDir, String(i + 1).padStart(6, '0') + '.' + CAP.ext), Buffer.from(shot.result.data, 'base64'));
  phase.write += Date.now() - mark;
  if (i % 30 === 0 || i === total - 1) {
    const per = (Date.now() - started) / (i + 1);
    process.stdout.write(`  frame ${i + 1}/${total}  video t=${Number(at).toFixed(3)}  eta ${Math.round((total - i - 1) * per / 1000)}s\n`);
  }
}
console.log('phases (s):', Object.entries(phase).map(([k, v]) => k + ' ' + (v / 1000).toFixed(1)).join('  '));
if (stuck > total * 0.5) console.warn(`warning: the video did not advance on ${stuck} frames`);
if (consoleErrors.length) console.warn('page errors: ' + consoleErrors.slice(0, 4).join(' | '));

ws.close(); proc.kill(); server.close();

/* -------------------------------------------------------------- encode -- */

const outMp4 = path.join(outDir, stem + '.mp4');
execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-framerate', String(fps), '-i', path.join(framesDir, '%06d.' + CAP.ext),
  '-c:v', 'libx264', '-preset', 'slow', '-crf', '17', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', '-r', String(fps), outMp4]);

// A 1080p companion for anything that has to move over a wire.
const outSmall = path.join(outDir, stem + '-1080p.mp4');
execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', outMp4, '-vf', 'scale=1920:1080:flags=lanczos',
  '-c:v', 'libx264', '-preset', 'slow', '-crf', '18', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', '-r', String(fps), outSmall]);

const gif = path.join(outDir, stem + '.gif');
const palette = path.join(outDir, stem + '-palette.png');
const gifFilters = `fps=12,scale=640:-1:flags=lanczos`;
execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-t', String(gifSeconds), '-i', outSmall, '-vf', `${gifFilters},palettegen=stats_mode=diff`, palette]);
execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-t', String(gifSeconds), '-i', outSmall, '-i', palette,
  '-lavfi', `${gifFilters}[x];[x][1:v]paletteuse=dither=bayer:bayer_scale=3`, gif]);
fs.rmSync(palette, { force: true });

// Three stills for a look at the render without opening the video: the open,
// the middle of the shot and the last frame.
const samples = [1, Math.round(total * 0.55), total]
  .map((n) => String(Math.max(1, Math.min(total, n))).padStart(6, '0') + '.' + CAP.ext);
for (const name of samples) {
  const png = path.join(outDir, stem + '-sample-' + name.replace(/\.jpg$/, '.png'));
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', path.join(framesDir, name), png]);
}
if (!opt['keep-frames']) fs.rmSync(framesDir, { recursive: true, force: true });

console.log('\nmaster      ' + outMp4 + `  (${FW}x${FH})`);
console.log('1080p       ' + outSmall);
console.log('gif         ' + gif);
console.log('duration    ' + (total / fps).toFixed(2) + 's, ' + total + ' frames, ' +
  ((Date.now() - started) / 1000 / total).toFixed(2) + 's per frame');
