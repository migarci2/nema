// Motion graphics, rendered frame by frame from an HTML page. No timers, no
// requestAnimationFrame: the page exposes window.renderAt(seconds) and this
// screenshots it once per frame, so a 4K render is exact and repeatable however
// slow the machine is.
//
//   node scripts/video/mograph.mjs <page.html> --out <file.mp4> --seconds <n>
//     [--fps 30] [--width 1920] [--height 1080] [--scale 2]
//     [--alpha]            transparent ground; writes a png sequence instead
//     [--frames <dir>]     keep the frames
//     [--query k=v]        appended to the page url, repeatable
//
// The page is laid out in CSS pixels at --width x --height and captured at
// --scale, so a 1920x1080 design renders a 3840x2160 master.
import fs from 'node:fs';
import path from 'node:path';
import { spawn, execFileSync } from 'node:child_process';

const argv = process.argv.slice(2);
const positional = [];
const opt = { fps: 30, width: 1920, height: 1080, scale: 2, seconds: 3, query: [] };
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === '--alpha') opt.alpha = true;
  else if (a === '--query') opt.query.push(argv[++i]);
  else if (a.startsWith('--')) opt[a.slice(2)] = argv[++i];
  else positional.push(a);
}
const page = path.resolve(positional[0] || '');
if (!fs.existsSync(page)) { console.error('no page at ' + page); process.exit(2); }
const CHROME = process.env.CHROME;
if (!CHROME) { console.error('set CHROME'); process.exit(2); }
const fps = Number(opt.fps), W = Number(opt.width), H = Number(opt.height), scale = Number(opt.scale);
const seconds = Number(opt.seconds);
const total = Math.round(seconds * fps);
const framesDir = opt.frames ? path.resolve(opt.frames) : path.join(path.dirname(path.resolve(opt.out || page)), '.mograph-' + path.basename(page, '.html'));
fs.rmSync(framesDir, { recursive: true, force: true });
fs.mkdirSync(framesDir, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const port = 9800 + Math.floor(Math.random() * 190);
const proc = spawn(CHROME, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--hide-scrollbars', '--allow-file-access-from-files', '--force-color-profile=srgb',
  `--remote-debugging-port=${port}`, `--user-data-dir=/tmp/claude-1000/nema-mograph-${port}`,
  `--window-size=${W},${H}`, 'about:blank'], { stdio: 'ignore' });

let target = null;
for (let i = 0; i < 80 && !target; i++) {
  try { target = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find((t) => t.type === 'page'); } catch {}
  if (!target) await sleep(250);
}
if (!target) { proc.kill(); throw new Error('no page target'); }
const ws = new WebSocket(target.webSocketDebuggerUrl);
let id = 0; const pending = new Map();
ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
const send = (method, params = {}) => new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
await new Promise((r) => (ws.onopen = r));
await send('Page.enable'); await send('Runtime.enable');
await send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: scale, mobile: false });
if (opt.alpha) await send('Emulation.setDefaultBackgroundColorOverride', { color: { r: 0, g: 0, b: 0, a: 0 } });

const url = 'file://' + page + (opt.query.length ? '?' + opt.query.join('&') : '');
await send('Page.navigate', { url });
const evaluate = async (expression) => {
  const m = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (m.result?.exceptionDetails) throw new Error(m.result.exceptionDetails.exception?.description || 'evaluate failed');
  return m.result?.result?.value;
};
for (let i = 0; i < 80; i++) { if (await evaluate('typeof window.renderAt === "function"').catch(() => false)) break; await sleep(200); }
if (!(await evaluate('typeof window.renderAt === "function"'))) { proc.kill(); throw new Error('the page never defined renderAt(t)'); }
// fonts settle before the first frame, or frame 0 is drawn in a fallback face
await evaluate('document.fonts.ready.then(() => true)').catch(() => {});
await sleep(400);

const t0 = Date.now();
for (let f = 0; f < total; f++) {
  const t = f / fps;
  await evaluate(`window.renderAt(${t.toFixed(6)}); new Promise((d) => requestAnimationFrame(() => requestAnimationFrame(() => d(true))))`);
  const shot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false, fromSurface: true });
  fs.writeFileSync(path.join(framesDir, String(f).padStart(6, '0') + '.png'), Buffer.from(shot.result.data, 'base64'));
  if (f % 30 === 0) process.stdout.write(`\r  ${path.basename(page)} ${f}/${total}`);
}
process.stdout.write(`\r  ${path.basename(page)} ${total}/${total} in ${((Date.now() - t0) / 1000).toFixed(1)}s\n`);
ws.close(); proc.kill();

if (opt.out) {
  const out = path.resolve(opt.out);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  const args = ['-y', '-loglevel', 'error', '-framerate', String(fps), '-i', path.join(framesDir, '%06d.png')];
  if (opt.alpha && /\.mov$/.test(out)) args.push('-c:v', 'qtrle', '-pix_fmt', 'argb');
  else args.push('-c:v', 'libx264', '-preset', 'slow', '-crf', '14', '-pix_fmt', 'yuv420p', '-profile:v', 'high', '-level', '5.1', '-movflags', '+faststart');
  args.push('-r', String(fps), out);
  execFileSync('ffmpeg', args);
  console.log('  wrote ' + out);
}
if (!opt.frames && opt.out) fs.rmSync(framesDir, { recursive: true, force: true });
else console.log('  frames ' + framesDir);
