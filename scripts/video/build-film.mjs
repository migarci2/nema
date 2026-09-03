// The film, built from its parts. Motion graphics are rendered from the pages
// in scripts/video/mograph, the takes are composited by studio-ffmpeg.mjs, the
// stock is graded to sit on the navy, and every segment is trimmed and dipped
// to the same encoder settings so the final assembly is a copy, not a re-encode.
//
//   CHROME=<chrome> node scripts/video/build-film.mjs [--steps a,b,c] [--out <dir>]
//
// Steps, in order, each safe to run on its own:
//   mograph   the navy cards: cold open, title, slots, logos, two tags, closing
//   stock     the Pexels cuts, graded cooler and darker, trimmed to length
//   consent   the vault's question, pushed, from the still each take captured
//   compose   the takes into the macOS window at 4K (slow: the whole graph)
//   finalize  trim, dip to navy, one encoder setting for every segment
//   cut       docs/video/cut.json, the edit list, with the on camera slots noted
//   assemble  screen-1080.mp4 then screen-4k.mp4
//   sheet     contact-sheet.png, one frame per chapter
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '../..');
const SCRATCH = '/tmp/claude-1000/-home-dark-Desktop-Projects/b5daf22a-b862-4b2b-ad5a-8aa4e872e169/scratchpad';
const argv = process.argv.slice(2);
const optOf = (name, d) => { const i = argv.indexOf('--' + name); return i >= 0 ? argv[i + 1] : d; };
const FILM = optOf('out', path.join(SCRATCH, 'film'));
const STEPS = new Set((optOf('steps', 'mograph,stock,consent,compose,finalize,cut,assemble,sheet')).split(','));
/* Rebuild a few segments without rebuilding the film: --only takes segment
 * names and narrows the making steps. cut, assemble and sheet always see the
 * whole film, because a part of a cut is not a cut. */
const ONLY = optOf('only', null);
const wanted = (s2) => !ONLY || ONLY.split(',').includes(s2.name);
const MG = path.join(HERE, 'mograph');
const SEG = path.join(FILM, 'segments');
const WORK = path.join(FILM, 'work');
const TAKES = path.join(FILM, 'takes');
const STOCK = path.join(FILM, 'stock');
for (const d of [SEG, WORK]) fs.mkdirSync(d, { recursive: true });

const FPS = 30;
const NAVY = '0x0B1320';
const say = (...a) => console.log(...a);
const ff = (args) => { const r = spawnSync('ffmpeg', ['-y', '-loglevel', 'error', '-nostats', ...args], { stdio: ['ignore', 'inherit', 'inherit'] }); if (r.status !== 0) throw new Error('ffmpeg failed'); };
const probe = (f) => Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', f]).toString().trim());
const enc4k = ['-c:v', 'libx264', '-preset', 'medium', '-crf', '16', '-profile:v', 'high', '-level', '5.1',
  '-pix_fmt', 'yuv420p', '-r', String(FPS), '-g', '30', '-keyint_min', '30', '-sc_threshold', '0', '-movflags', '+faststart', '-an'];
const enc1080 = ['-c:v', 'libx264', '-preset', 'medium', '-crf', '18', '-profile:v', 'high', '-level', '4.2',
  '-pix_fmt', 'yuv420p', '-r', String(FPS), '-g', '30', '-keyint_min', '30', '-sc_threshold', '0', '-movflags', '+faststart', '-an'];

/* ------------------------------------------------------------- the film -- */

/* Two people on camera, chatting rather than reading. The slots are hard cuts
 * in and out; the placeholder card carries the lines so the cut plays now. */
const SLOTS = {
  A: { secs: 8, where: 'the filmed intro, before this part', lines: [
    ['C', 'Every site you learn from starts from zero. Nema fixes that. I want to show you three ways I use it.']
  ] },
  C: { secs: 4, where: 'a cut in between chapter two and chapter three', lines: [
    ['M', 'Two. A different site.'],
    ['C', 'This one has never seen the first one.']
  ] },
  D: { secs: 3, where: 'a cut in before the logo section', lines: [
    ['M', 'And which AI is this?'],
    ['C', 'The one you already use.']
  ] },
  E: { secs: 6, where: 'the closing words, before the closing card', lines: [
    ['C', "What you learn is yours. Not the sites'. So, that is nema."],
    ['M', 'Please try it. We would love your feedback.']
  ] }
};

/* Carmen narrates the screen part in the first person: three ways she uses it,
 * counted off. The on screen labels One, Two and Three sit on the first clip of
 * each way, so the picture counts with her. */
const VOICEOVER = {
  '09-ch1-ask': [
    'One. I open a cooking course I have never seen.',
    'It asks my nema what I already know.',
    'I say yes, and it adapts. Sixty eight minutes become twenty seven.'
  ],
  '13-ch2-answer': ['I do one exercise.'],
  '14-ch2-receipt': ['The course gives me a note that says I passed. That note is mine. I keep it in my nema.'],
  '18-ch3-ask': ['It asks, I say yes, and it already counts what I did before.'],
  '20-ch3-open': ['Two lessons done before I start. The lab opens.'],
  '21-ch4-ext': ['Three. With the extension, it is one click. My notes come home alone.'],
  '22-ch4-article': [
    'And this is a real article, with questions inside the text.',
    'One tag on the page. That is all.'
  ],
  '25-twotags': ['If you teach on the web, you can add this in one minute.']
};

const slotQuery = (k) => [
  'slot=' + k,
  'secs=' + SLOTS[k].secs,
  'lines=' + encodeURIComponent(SLOTS[k].lines.map(([w, s]) => `${w}|${s}`).join('~~'))
];

/* Every segment of this part, in order. `src` says where the picture comes
 * from; `in` and `dur` trim it; `dipIn` and `dipOut` are the only fades in the
 * film and they only ever happen at a chapter border. */
const SEGMENTS = [
  // 1. cold open. Starts on navy so the filmed intro can cross into it.
  { name: '01-open-a', chapter: 'Cold open', kind: 'mograph', page: 'open-a.html', dur: 1.30 },
  { name: '02-open-s1', kind: 'stock', clip: 'laptop-night', in: 3.0, dur: 1.50 },
  { name: '03-open-b', kind: 'mograph', page: 'open-b.html', dur: 0.65 },
  { name: '04-open-s2', kind: 'stock', clip: 'student-screen', in: 6.0, dur: 1.50 },
  { name: '05-open-c', kind: 'mograph', page: 'open-c.html', dur: 0.25 },
  { name: '06-open-s3', kind: 'stock', clip: 'reading-long', in: 2.5, dur: 1.30 },
  // 2. title
  { name: '07-title', chapter: 'Title', kind: 'mograph', page: 'title.html', dur: 3.00 },
  // 3. chapter one
  { name: '09-ch1-ask', chapter: 'Chapter 1', label: 'One', kind: 'take', take: 'ch1', shot: 'ask', title: 'Saucier School', in: 0.90, dur: 5.40 },
  { name: '10-ch1-consent', kind: 'consent', from: 'ch1', cap: 'You say yes', dur: 2.60 },
  { name: '11-ch1-became', kind: 'take', take: 'ch1', shot: 'became', title: 'Saucier School', in: 1.40, dur: 7.60, dipOut: 0.20 },
  // 4. the beat
  { name: '12-beat', chapter: 'Beat', kind: 'stock', clip: 'pan-sauce', in: 4.0, dur: 2.00, dipIn: 0.16, dipOut: 0.16 },
  // 5. chapter two
  /* One recording, two cuts: the answer and the submit, then the signed
   * receipt. What sits between them is a page thinking, and a film cuts it. */
  { name: '13-ch2-answer', chapter: 'Chapter 2', kind: 'take', take: 'ch2', shot: 'check', title: 'Saucier School', in: 3.80, dur: 4.80, dipIn: 0.16 },
  { name: '14-ch2-receipt', kind: 'take', take: 'ch2', shot: 'check', title: 'Saucier School', in: 12.30, dur: 5.60 },
  { name: '15-ch2-keep', kind: 'take', take: 'ch2', shot: 'keep', title: 'Saucier School', in: 0.50, dur: 2.20 },
  { name: '16-ch2-ledger', kind: 'take', take: 'ch2', shot: 'ledger', title: 'Your vault', in: 0.30, dur: 3.40 },
  // on camera, slot C
  { name: '17-slot-c', chapter: 'Slot C', kind: 'mograph', page: 'slot.html', dur: SLOTS.C.secs, query: slotQuery('C') },
  // 6. chapter three
  { name: '18-ch3-ask', chapter: 'Chapter 3', label: 'Two', kind: 'take', take: 'ch3', shot: 'lc-ask', title: 'Line Cook Lab', in: 0.60, dur: 3.40 },
  { name: '19-ch3-consent', kind: 'consent', from: 'ch3', cap: 'A different site. It already knows.', dur: 2.20 },
  { name: '20-ch3-open', kind: 'take', take: 'ch3', shot: 'lc-open', title: 'Line Cook Lab', in: 2.20, dur: 6.00, dipOut: 0.20 },
  // 7. chapter four
  { name: '21-ch4-ext', chapter: 'Chapter 4', label: 'Three', kind: 'ext', take: 'ch4', shot: 'ext', in: 1.10, dur: 5.60, dipIn: 0.16 },
  { name: '22-ch4-article', kind: 'take', take: 'ch4b', shot: 'article', title: 'AES-GCM, with and without nema', in: 1.60, dur: 4.40, dipOut: 0.20 },
  // on camera, slot D
  { name: '23-slot-d', chapter: 'Slot D', kind: 'mograph', page: 'slot.html', dur: SLOTS.D.secs, query: slotQuery('D') },
  // 8. the logos
  { name: '24-logos', chapter: 'Logos', kind: 'mograph', page: 'logos.html', dur: 6.00 },
  // 9. two tags
  { name: '25-twotags', chapter: 'Two tags', kind: 'mograph', page: 'twotags.html', dur: 3.00 },
  // on camera, slot E
  { name: '26-slot-e', chapter: 'Slot E', kind: 'mograph', page: 'slot.html', dur: SLOTS.E.secs, query: slotQuery('E') },
  // 10. the close
  { name: '27-closing', chapter: 'Closing', kind: 'mograph', page: 'closing.html', dur: 5.00 }
];

const raw4k = (s) => path.join(WORK, s.name + '-raw.mp4');
const seg4k = (s) => path.join(SEG, s.name + '-4k.mp4');
const seg1080 = (s) => path.join(SEG, s.name + '-1080.mp4');

/* ------------------------------------------------------------- mograph -- */

if (STEPS.has('mograph')) {
  for (const s of SEGMENTS.filter((x) => x.kind === 'mograph' && wanted(x))) {
    say('mograph  ' + s.name);
    const args = [path.join(HERE, 'mograph.mjs'), path.join(MG, s.page), '--out', raw4k(s),
      '--seconds', String(s.dur), '--fps', String(FPS), '--scale', '2'];
    for (const q of s.query || []) args.push('--query', q);
    execFileSync('node', args, { stdio: 'inherit' });
  }
}

/* --------------------------------------------------------------- stock -- */

/* Cooler, darker and a little less saturated, so a kitchen at noon sits next to
 * the navy without shouting at it. */
const GRADE = 'eq=contrast=1.06:brightness=-0.055:saturation=0.74,' +
  'colorbalance=rs=-0.05:bs=0.08:rm=-0.05:bm=0.09:rh=-0.03:bh=0.06,' +
  'colorlevels=rimin=0.02:gimin=0.01:bimin=0:romin=0.015:gomin=0.02:bomin=0.05';

if (STEPS.has('stock')) {
  for (const s of SEGMENTS.filter((x) => x.kind === 'stock' && wanted(x))) {
    const src = path.join(STOCK, s.clip + '.mp4');
    if (!fs.existsSync(src)) throw new Error('no stock clip: ' + src);
    say(`stock    ${s.name}  ${s.clip} at ${s.in}s for ${s.dur}s`);
    ff(['-ss', String(s.in), '-i', src, '-t', String(s.dur),
      '-vf', `fps=${FPS},scale=3840:2160:force_original_aspect_ratio=increase,crop=3840:2160,setsar=1,${GRADE},format=yuv420p`,
      ...enc4k, raw4k(s)]);
  }
}

/* ------------------------------------------------------------- consent -- */

if (STEPS.has('consent')) {
  for (const s of SEGMENTS.filter((x) => x.kind === 'consent' && wanted(x))) {
    const raw = path.join(TAKES, s.from, 'consent.png');
    if (!fs.existsSync(raw)) { say('consent  ' + s.name + ': no still, skipped'); continue; }
    /* The card, not the window around it: cropping the popup chrome away is
     * what lets the question be read at this size. */
    const shot = path.join(TAKES, s.from, 'consent-card.png');
    execFileSync('python3', [path.join(HERE, 'crop-consent.py'), raw, shot], { stdio: 'inherit' });
    const dim = execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'csv=p=0:s=x', shot]).toString().trim();
    const height = 900;
    say(`consent  ${s.name}  card ${dim}, ${height} design px tall`);
    execFileSync('node', [path.join(HERE, 'mograph.mjs'), path.join(MG, 'consent.html'),
      '--out', raw4k(s), '--seconds', String(s.dur), '--fps', String(FPS), '--scale', '2',
      '--query', 'shot=file://' + shot, '--query', 'cap=' + encodeURIComponent(s.cap), '--query', 'h=' + height],
      { stdio: 'inherit' });
  }
}

/* ------------------------------------------------------------- compose -- */

if (STEPS.has('compose')) {
  /* One composite per recording, not per segment: chapter two cuts the same
   * take twice and there is no reason to run the whole graph for it twice. */
  for (const s of SEGMENTS.filter((x) => x.kind === 'take' && wanted(x))) {
    const dir = path.join(TAKES, s.take);
    const events = path.join(dir, s.shot + '.events.json');
    if (!fs.existsSync(events)) { say('compose  ' + s.name + ': no take, skipped'); continue; }
    const stem = `studio-${s.take}-${s.shot}`;
    const made = path.join(WORK, stem + '-4k.mp4');
    if (!fs.existsSync(made) || fs.statSync(made).mtimeMs < fs.statSync(path.join(dir, s.shot + '.mp4')).mtimeMs) {
      say('compose  ' + s.take + '/' + s.shot);
      execFileSync('node', [path.join(HERE, 'studio-ffmpeg.mjs'), dir,
        '--events', events, '--video', path.join(dir, s.shot + '.mp4'),
        '--out', WORK, '--out-name', stem, '--title', s.title, '--gif', '2'], { stdio: 'inherit' });
    } else say('compose  ' + s.take + '/' + s.shot + ': already composited');
    fs.copyFileSync(made, raw4k(s));
  }
  for (const s of SEGMENTS.filter((x) => x.kind === 'ext' && wanted(x))) {
    const src = path.join(TAKES, s.take, s.shot + '.mp4');
    if (!fs.existsSync(src)) { say('compose  ' + s.name + ': no extension take, skipped'); continue; }
    say('compose  ' + s.name + ' (already a frame, only conformed)');
    ff(['-i', src, '-vf', `fps=${FPS},scale=3840:2160:force_original_aspect_ratio=decrease,pad=3840:2160:(ow-iw)/2:(oh-ih)/2:color=${NAVY},setsar=1,format=yuv420p`, ...enc4k, raw4k(s)]);
  }
}

/* ------------------------------------------------------------ finalize -- */

if (STEPS.has('finalize')) {
  for (const s of SEGMENTS.filter(wanted)) {
    const src = raw4k(s);
    if (!fs.existsSync(src)) { say('finalize ' + s.name + ': nothing to trim, skipped'); continue; }
    const have = probe(src);
    /* Only a recording arrives longer than the film needs it. The cards and the
     * stock are cut to length when they are made, so their `in` was already
     * spent and applying it here would eat the clip a second time. */
    const start = (s.kind === 'take' || s.kind === 'ext') ? Math.max(0, s.in || 0) : 0;
    const dur = Math.min(s.dur, Math.max(0.2, have - start));
    if (dur < s.dur - 0.05) say(`  ${s.name}: only ${have.toFixed(2)}s of source, using ${dur.toFixed(2)}s`);
    const fades = [];
    if (s.dipIn) fades.push(`fade=t=in:st=0:d=${s.dipIn}:c=${NAVY}`);
    if (s.dipOut) fades.push(`fade=t=out:st=${(dur - s.dipOut).toFixed(3)}:d=${s.dipOut}:c=${NAVY}`);
    const vf = ['setpts=PTS-STARTPTS', ...fades].join(',');
    if (s.label) {
      /* The counted label that opens a way: One, Two, Three. It lives on the
       * frame rather than in the scene, so the camera can push behind it, and
       * it slides in from the left over 240 ms and holds. */
      const png = path.join(WORK, s.name + '-label.png');
      execFileSync('python3', [path.join(HERE, 'label.py'), s.label, '2', png], { encoding: 'utf8' });
      const outAt = Math.max(0.8, Math.min(2.4, dur - 0.6));
      ff(['-ss', String(start), '-i', src, '-loop', '1', '-framerate', String(FPS), '-t', String(dur), '-i', png,
        '-filter_complex',
        `[0:v]${vf}[base];` +
        `[1:v]format=rgba,fade=t=in:st=0.20:d=0.24:alpha=1,fade=t=out:st=${outAt.toFixed(2)}:d=0.30:alpha=1[lab];` +
        `[base][lab]overlay=x='46-36*(1-min(1,max(0,(t-0.20)/0.24)))':y=190:eval=frame:format=auto,format=yuv420p[v]`,
        '-map', '[v]', '-t', String(dur), ...enc4k, seg4k(s)]);
    } else {
      ff(['-ss', String(start), '-i', src, '-t', String(dur), '-vf', `${vf},format=yuv420p`, ...enc4k, seg4k(s)]);
    }
    ff(['-i', seg4k(s), '-vf', 'scale=1920:1080:flags=lanczos', ...enc1080, seg1080(s)]);
    say(`finalize ${s.name}  ${dur.toFixed(2)}s`);
  }
}

/* ----------------------------------------------------------------- cut -- */

const present = () => SEGMENTS.filter((s) => fs.existsSync(seg4k(s)));
const t = (x) => new Date(Math.max(0, x) * 1000).toISOString().slice(11, 23);

if (STEPS.has('cut')) {
  const clips = [];
  const voLines = [];
  let at = 0;
  for (const s of present()) {
    const d = probe(seg4k(s));
    const note = [];
    if (s.chapter) note.push(s.chapter);
    const slot = /slot-([a-e])$/.exec(s.name);
    if (slot) {
      const k = slot[1].toUpperCase();
      note.push(`ON CAMERA, SLOT ${k}: placeholder, ${SLOTS[k].secs} s, ${SLOTS[k].where}. Hard cut in and out, no dissolve.`);
      note.push('Lines: ' + SLOTS[k].lines.map(([w, l]) => `${w}: "${l}"`).join('  '));
    }
    const vo = VOICEOVER[s.name];
    clips.push({ name: s.name, src: seg4k(s), duration: t(d), at: t(at),
      ...(note.length ? { note: note.join(' | ') } : {}),
      ...(vo ? { voiceover: vo } : {}) });
    if (vo) for (const line of vo) voLines.push({ at: t(at), clip: s.name, speaker: 'Carmen', text: line });
    at += d;
  }
  const cut = {
    title: 'nema demo, the screen part',
    profile: 'uhd_2160p_30',
    note: [
      'This is the part after the filmed intro. SLOT A is that intro and is not a clip here:',
      `it runs ${SLOTS.A.secs} s before clip 1 and its lines are in slots.A below.`,
      'Every clip is already trimmed, dipped and encoded the same way, so the assembly is a',
      'straight concat. Dips to navy only happen at chapter borders and are baked into the clips.'
    ].join(' '),
    slots: Object.fromEntries(Object.entries(SLOTS).map(([k, v]) => [k, { seconds: v.secs, where: v.where, lines: v.lines.map(([w, l]) => `${w}: ${l}`) }])),
    tracks: [
      { name: 'V1', kind: 'video', note: 'The clips below, in order. Hard cuts. Every dip to navy is already in the picture.' },
      { name: 'voiceover', kind: 'audio', src: null, gain: 0, speaker: 'Carmen',
        note: 'Carmen narrates the screen part as the learner. Her lines are on the clips they belong to and listed in `voiceover.lines`. Record it against the picture: the timings are where each line starts, not where it has to end.' },
      { name: 'music', kind: 'audio', src: null, gain: -18,
        note: 'Owner supplies the track. Duck it 10 dB under the voiceover.' }
    ],
    music: { src: null, gain: -18, startAt: '00:00:02.000', duckUnderVoiceoverDb: -10,
      note: 'Owner supplies the track. The first two seconds are silent on purpose: that is the cross from the filmed intro. Duck the bed by 10 dB wherever the voiceover speaks.' },
    voiceover: { src: null, gain: 0, speaker: 'Carmen', duckMusicDb: -10,
      note: 'One track, recorded down the whole screen part. Miguel speaks only in the on camera slots.',
      lines: voLines },
    clips
  };
  const at2 = path.join(REPO, 'docs/video/cut.json');
  fs.mkdirSync(path.dirname(at2), { recursive: true });
  fs.writeFileSync(at2, JSON.stringify(cut, null, 2) + '\n');
  say(`cut      ${at2}  ${clips.length} clips, ${at.toFixed(2)}s`);
}

/* ------------------------------------------------------------ assemble -- */

function concat(list, out, silent = true) {
  const txt = list.map((f) => `file '${f}'`).join('\n') + '\n';
  const at2 = path.join(WORK, path.basename(out) + '.txt');
  fs.writeFileSync(at2, txt);
  const tmp = path.join(WORK, 'cat-' + path.basename(out));
  ff(['-f', 'concat', '-safe', '0', '-i', at2, '-c', 'copy', tmp]);
  if (!silent) { fs.renameSync(tmp, out); return out; }
  /* A silent stereo track, so an editor can drop the music straight in. */
  ff(['-i', tmp, '-f', 'lavfi', '-i', 'anullsrc=channel_layout=stereo:sample_rate=48000',
    '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k', '-shortest', '-movflags', '+faststart', out]);
  fs.rmSync(tmp, { force: true });
  return out;
}

if (STEPS.has('assemble')) {
  const list = present();
  const out1080 = path.join(FILM, 'screen-1080.mp4');
  concat(list.map(seg1080), out1080);
  say(`assemble ${out1080}  ${probe(out1080).toFixed(2)}s`);
  const out4k = path.join(FILM, 'screen-4k.mp4');
  concat(list.map(seg4k), out4k);
  say(`assemble ${out4k}  ${probe(out4k).toFixed(2)}s`);
}

/* --------------------------------------------------------------- sheet -- */

if (STEPS.has('sheet')) {
  const master = path.join(FILM, 'screen-1080.mp4');
  const rows = [];
  let at = 0;
  for (const s of present()) {
    const d = probe(seg4k(s));
    if (s.chapter) rows.push({ label: s.chapter, at: at + Math.min(d * 0.55, d - 0.1) });
    at += d;
  }
  const shots = [];
  rows.forEach((row, i) => {
    const f = path.join(WORK, `sheet-${String(i).padStart(2, '0')}.png`);
    ff(['-ss', row.at.toFixed(3), '-i', master, '-frames:v', '1', f]);
    shots.push({ ...row, file: f });
  });
  const spec = { out: path.join(FILM, 'contact-sheet.png'), cols: 4, cell: 640,
    font: path.join(REPO, 'shared/brand/fonts/inter-latin-var.woff2'), shots };
  fs.writeFileSync(path.join(WORK, 'sheet.json'), JSON.stringify(spec, null, 2));
  execFileSync('python3', [path.join(HERE, 'contact-sheet.py'), path.join(WORK, 'sheet.json')], { stdio: 'inherit' });
}
