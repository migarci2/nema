// edit.mjs: an edit list in JSON becomes a Shotcut project (.mlt) and, on
// request, a rendered mp4 through melt. People open the .mlt in Shotcut and
// move things around; agents edit the JSON (or the XML) and render again.
//
//   node scripts/video/edit.mjs <edit.json> [--mlt out.mlt] [--render out.mp4]
//
// edit.json:
//   {
//     "profile": "atsc_1080p_30" | "uhd_2160p_30",
//     "clips": [
//       { "src": "intro.mp4", "in": "00:00:00.000", "out": "00:00:12.500" },
//       { "src": "take-ask.mp4" },
//       { "src": "closing.png", "duration": "00:00:05.000" },
//       { "src": "take-receipt.mp4", "fade": 0.5 }
//     ],
//     "music": { "src": "bed.mp3", "gain": -18 }
//   }
//
// Times are HH:MM:SS.mmm. A still image needs a duration. "fade" is a seconds
// long dissolve into the clip from the previous one. ponytail: one video
// track and one optional music track, which covers a demo reel; multitrack
// layouts are Shotcut's job once the project is open.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const args = process.argv.slice(2);
const file = args.find((a) => !a.startsWith('--'));
if (!file) {
  console.error('usage: node scripts/video/edit.mjs <edit.json> [--mlt out.mlt] [--render out.mp4]');
  process.exit(2);
}
const opt = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : fallback;
};
const edit = JSON.parse(fs.readFileSync(file, 'utf8'));
const base = path.dirname(path.resolve(file));
const abs = (p) => (path.isAbsolute(p) ? p : path.join(base, p));
const mltOut = opt('--mlt', file.replace(/\.json$/, '') + '.mlt');
const renderOut = opt('--render', null);
const profile = edit.profile || 'atsc_1080p_30';
const fps = /2160p_30|1080p_30/.test(profile) ? 30 : 25;

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
const tc = (s) => s; // Shotcut accepts HH:MM:SS.mmm strings as in and out

let producers = '';
let entries = '';
let transitions = '';
let id = 0;
for (const clip of edit.clips || []) {
  const pid = `producer${id++}`;
  const src = abs(clip.src);
  if (!fs.existsSync(src)) throw new Error(`missing clip: ${src}`);
  const still = /\.(png|jpe?g)$/i.test(src);
  const props = [`<property name="resource">${esc(src)}</property>`];
  if (still) {
    props.push('<property name="mlt_service">qimage</property>');
    props.push(`<property name="length">${esc(clip.duration || '00:00:05.000')}</property>`);
    props.push(`<property name="out">${esc(clip.duration || '00:00:05.000')}</property>`);
  } else {
    props.push('<property name="mlt_service">avformat-novalidate</property>');
    /* melt needs the clip's own length on the producer, or the entry is empty. */
    const seconds = Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', src]).toString().trim());
    const t = (x) => new Date(Math.max(0, x) * 1000).toISOString().slice(11, 23);
    props.push(`<property name="length">${t(seconds)}</property>`);
    props.push(`<property name="out">${t(seconds - 1 / fps)}</property>`);
  }
  props.push(`<property name="shotcut:caption">${esc(path.basename(src))}</property>`);
  producers += `  <producer id="${pid}">\n    ${props.join('\n    ')}\n  </producer>\n`;
  const range = `${clip.in ? ` in="${esc(tc(clip.in))}"` : ''}${clip.out ? ` out="${esc(tc(clip.out))}"` : still ? ` out="${esc(clip.duration || '00:00:05.000')}"` : ''}`;
  entries += `    <entry producer="${pid}"${range}/>\n`;
  if (clip.fade) transitions += `    <!-- ${esc(clip.src)}: ${clip.fade}s dissolve from the previous clip; set it in Shotcut by overlapping the clips -->\n`;
}

let music = '';
let musicTrack = '';
if (edit.music && edit.music.src) {
  const src = abs(edit.music.src);
  music = `  <producer id="music">\n    <property name="resource">${esc(src)}</property>\n    <property name="mlt_service">avformat-novalidate</property>\n    <filter id="musicgain">\n      <property name="mlt_service">volume</property>\n      <property name="level">${Number(edit.music.gain ?? -18)}</property>\n    </filter>\n  </producer>\n  <playlist id="playlist1">\n    <property name="shotcut:audio">1</property>\n    <property name="shotcut:name">Music</property>\n    <entry producer="music"/>\n  </playlist>\n`;
  musicTrack = '    <track producer="playlist1" hide="video"/>\n';
}

const xml = `<?xml version="1.0" standalone="no"?>
<mlt LC_NUMERIC="C" version="7.41.0" title="${esc(edit.title || 'nema edit')}" producer="main_bin">
  <profile description="${esc(profile)}" ${profile === 'uhd_2160p_30' ? 'width="3840" height="2160"' : 'width="1920" height="1080"'} progressive="1" sample_aspect_num="1" sample_aspect_den="1" display_aspect_num="16" display_aspect_den="9" frame_rate_num="${fps}" frame_rate_den="1" colorspace="709"/>
  <playlist id="main_bin">
    <property name="xml_retain">1</property>
  </playlist>
${producers}${music}  <playlist id="playlist0">
    <property name="shotcut:video">1</property>
    <property name="shotcut:name">V1</property>
${entries}${transitions}  </playlist>
  <tractor id="tractor0" title="Shotcut" in="00:00:00.000">
    <property name="shotcut">1</property>
    <track producer="playlist0"/>
${musicTrack}  </tractor>
</mlt>
`;
fs.writeFileSync(mltOut, xml);
console.log('wrote', mltOut);

if (renderOut) {
  const enc = profile === 'uhd_2160p_30'
    ? ['vcodec=libx264', 'crf=16', 'preset=slow', 'pix_fmt=yuv420p', 'acodec=aac', 'ab=192k']
    : ['vcodec=libx264', 'crf=18', 'preset=medium', 'pix_fmt=yuv420p', 'acodec=aac', 'ab=192k'];
  execFileSync('melt', [mltOut, '-silent', '-consumer', `avformat:${renderOut}`, ...enc], { stdio: 'inherit' });
  console.log('rendered', renderOut);
}
