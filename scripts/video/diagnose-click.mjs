// Where the film says a thing happened, and where the recording shows it.
//
//   node scripts/video/diagnose-click.mjs <takeDir> [--selector-box x,y,w,h]
//
// Reads the take's raw video one frame at a time inside the box of the element
// that was clicked, and prints the frame where the page visibly changed next to
// the time the log carries for the move, the hover and the press. Any gap
// between the two columns is the offset to fix; there is no way to argue about
// it from a video player.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const takeDir = process.argv[2];
if (!takeDir) { console.error('usage: diagnose-click.mjs <takeDir>'); process.exit(2); }
const log = JSON.parse(fs.readFileSync(path.join(takeDir, 'events.json'), 'utf8'));
const video = log.video || path.join(takeDir, 'raw.mp4');
const fps = log.fps || 30;
const scale = (log.capture ? log.capture.w : log.width) / log.width;   // css px -> video px

const click = log.events.find((e) => e.type === 'click');
if (!click || !click.bbox) { console.error('the log has no click with a box'); process.exit(2); }
const [bx, by, bw, bh] = click.bbox.map((v) => Math.round(v * scale));

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nema-diag-'));
execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', video,
  '-vf', `crop=${bw}:${bh}:${bx}:${by},scale=24:8`, '-vsync', '0', path.join(dir, '%05d.png')]);
const files = fs.readdirSync(dir).filter((f) => f.endsWith('.png')).sort();

/* The red channel, because a hover usually moves hue more than brightness: this
 * button goes rgb(255,116,41) to rgb(228,131,44), which is 27 points of red and
 * barely two of luma. */
function redOf(file) {
  const raw = execFileSync('ffmpeg', ['-v', 'error', '-i', file, '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-']);
  let sum = 0;
  for (let i = 0; i < raw.length; i += 3) sum += raw[i];
  return sum / (raw.length / 3);
}
const reds = files.map((f) => redOf(path.join(dir, f)));
fs.rmSync(dir, { recursive: true, force: true });

const moves = log.events.filter((e) => e.type === 'move');
const samples = moves.flatMap((m) => m.samples || []);
const firstHand = samples.find((s) => s[3] === 'hand');
const inBox = samples.find((s) => s[1] >= click.bbox[0] && s[1] <= click.bbox[0] + click.bbox[2] &&
                                 s[2] >= click.bbox[1] && s[2] <= click.bbox[1] + click.bbox[3]);

/* Two moments, not one: the hover, which is the first change after the pointer
 * enters the element, and the page's answer to the press, which is the next
 * change after the click. A button whose :active looks like its :hover, and this
 * one does, only gives the second. */
const enter = inBox ? inBox[0] : click.t - 1;
const from = Math.max(0, Math.round((enter - 0.5) * fps));
const to = Math.min(reds.length - 1, Math.round((click.t + 1.5) * fps));
const base = reds.slice(Math.max(0, from - 10), from).reduce((a, b) => a + b, 0) / Math.max(1, Math.min(10, from));
let changed = null, reacted = null, level = base;
for (let i = from; i <= to; i++) {
  if (Math.abs(reds[i] - level) > 6) {
    if (changed == null) changed = i;
    else if (reacted == null && i / fps > click.t - 0.05) reacted = i;
    level = reds[i];
  }
}

const row = (label, t) => console.log(`  ${label.padEnd(26)} ${t == null ? '-' : t.toFixed(3) + 's  frame ' + Math.round(t * fps)}`);
console.log(`take ${takeDir}`);
console.log(`  capture ${log.capture ? log.capture.w + 'x' + log.capture.h : '?'}, ${reds.length} frames at ${fps} fps, latency field ${log.latency}s`);
console.log('log says:');
row('pointer enters the box', inBox ? inBox[0] : null);
row('pointer becomes a hand', firstHand ? firstHand[0] : null);
row('click', click.t);
console.log('the recording shows:');
row('hover paints', changed == null ? null : changed / fps);
row('page answers the press', reacted == null ? null : reacted / fps);
const gap = (a, b, what) => {
  if (a == null || b == null) return;
  const off = a - b;
  console.log(`  ${what}: ${(off * 1000).toFixed(0)} ms ${off >= 0 ? 'after' : 'before'}`);
};
console.log('offsets:');
gap(changed == null ? null : changed / fps, inBox ? inBox[0] : null, 'hover paint after the pointer enters');
gap(reacted == null ? null : reacted / fps, click.t, 'page answer after the logged click');
console.log('red per frame around the click:');
for (let i = Math.max(0, Math.round((click.t - 0.7) * fps)); i <= to; i++) {
  console.log(`  frame ${String(i).padStart(3)} t=${(i / fps).toFixed(3)}  red ${reds[i].toFixed(1)}${i === changed ? '   <- first change' : ''}${Math.abs(i / fps - click.t) < 1 / fps / 2 ? '   <- logged click' : ''}`);
}
