// Pexels stock footage for the film. Landscape, large, 3840 wide where the
// clip has it, downloaded once into a cache directory with a credits file
// beside it.
//
//   PEXELS_KEY=<key> node scripts/video/stock.mjs <outDir> [--credits <path>]
//
// The key is read from PEXELS_KEY, or from the app.pexels_api_keys list of a
// MoneyPrinterTurbo config.toml pointed at by PEXELS_CONFIG. It is never
// printed. The Pexels licence allows use in a video without attribution; the
// photographer credits are written out anyway.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const outDir = process.argv[2] || '/tmp/nema-stock';
const creditsAt = (() => { const i = process.argv.indexOf('--credits'); return i > 0 ? process.argv[i + 1] : null; })();

function key() {
  if (process.env.PEXELS_KEY) return process.env.PEXELS_KEY.trim();
  const cfg = process.env.PEXELS_CONFIG;
  if (cfg && fs.existsSync(cfg)) {
    const out = execFileSync('python3', ['-c',
      'import tomllib,sys;c=tomllib.load(open(sys.argv[1],"rb"));k=c["app"]["pexels_api_keys"];print(k[0] if isinstance(k,list) else k)',
      cfg], { encoding: 'utf8' });
    return out.trim();
  }
  throw new Error('no Pexels key: set PEXELS_KEY or PEXELS_CONFIG');
}
const KEY = key();

// name, query, and how many results to look through before picking
const WANTS = JSON.parse(fs.readFileSync(new URL('./stock.json', import.meta.url), 'utf8'));

const api = async (url) => {
  const r = await fetch(url, { headers: { Authorization: KEY } });
  if (!r.ok) throw new Error(`pexels ${r.status} ${r.statusText}`);
  return r.json();
};

/** The biggest landscape mp4 file on a video, at or under 4K. */
function pickFile(video) {
  const files = (video.video_files || [])
    .filter((f) => f.file_type === 'video/mp4' && f.width && f.height && f.width > f.height)
    .sort((a, b) => b.width - a.width);
  return files.find((f) => f.width <= 3840 && f.width >= 1920) || files[0] || null;
}

fs.mkdirSync(outDir, { recursive: true });
const credits = [];
for (const want of WANTS) {
  const dest = path.join(outDir, want.name + '.mp4');
  const metaAt = path.join(outDir, want.name + '.json');
  if (fs.existsSync(dest) && fs.existsSync(metaAt)) {
    const m = JSON.parse(fs.readFileSync(metaAt, 'utf8'));
    credits.push(m);
    console.log(`${want.name}: cached (${m.width}x${m.height})`);
    continue;
  }
  const q = encodeURIComponent(want.query);
  const page = await api(`https://api.pexels.com/videos/search?query=${q}&orientation=landscape&size=large&per_page=${want.per_page || 15}`);
  const videos = (page.videos || []).filter((v) => v.duration >= (want.minSeconds || 5));
  const skip = new Set(want.skip || []);
  const chosen = videos.filter((v) => !skip.has(v.id))[want.pick || 0] || videos[0];
  if (!chosen) { console.warn(`${want.name}: nothing came back for "${want.query}"`); continue; }
  const file = pickFile(chosen);
  if (!file) { console.warn(`${want.name}: no landscape mp4 on ${chosen.id}`); continue; }
  const bin = Buffer.from(await (await fetch(file.link)).arrayBuffer());
  fs.writeFileSync(dest, bin);
  const meta = {
    name: want.name, query: want.query, id: chosen.id, url: chosen.url,
    photographer: chosen.user?.name || 'unknown', photographerUrl: chosen.user?.url || '',
    width: file.width, height: file.height, seconds: chosen.duration, file: dest
  };
  fs.writeFileSync(metaAt, JSON.stringify(meta, null, 2));
  credits.push(meta);
  console.log(`${want.name}: ${file.width}x${file.height}, ${chosen.duration}s, by ${meta.photographer}`);
}

if (creditsAt) {
  const lines = [
    '# Stock footage credits',
    '',
    'Clips from Pexels (https://www.pexels.com). The Pexels licence allows use in',
    'a video, modified, with no attribution required. The photographers are named',
    'here anyway, in the order the clips appear in the film.',
    ''
  ];
  for (const c of credits) {
    lines.push(`- **${c.name}** (${c.width}x${c.height}, ${c.seconds}s) by ${c.photographer}`);
    lines.push(`  - search: "${c.query}"`);
    lines.push(`  - clip: ${c.url}`);
    if (c.photographerUrl) lines.push(`  - photographer: ${c.photographerUrl}`);
  }
  lines.push('');
  lines.push('## Logos');
  lines.push('');
  lines.push('The agent, browser and platform marks in the logo section and on the closing');
  lines.push('card come from Simple Icons (https://simpleicons.org), CC0 1.0 Universal, via');
  lines.push('https://cdn.simpleicons.org. They are used as masks and painted in the nema ink');
  lines.push('colour, so every mark carries the same weight. The files live in');
  lines.push('docs/assets/press/logos. Codex and WebMCP have no mark in that set and are set');
  lines.push('in JetBrains Mono instead. The Model Context Protocol mark is the official one,');
  lines.push('also from Simple Icons, and the full official lockup is kept beside it as');
  lines.push('docs/assets/press/logos/mcp-official.svg. The three demo sites wear their own');
  lines.push('marks, drawn from their own stylesheets, in their own colours. Every brand');
  lines.push('belongs to its owner and none of them endorse this project.');
  lines.push('');
  lines.push('## Music');
  lines.push('');
  lines.push('"Banjos, Unite!" by Alexander Nakarada (https://creatorchords.com/), licensed');
  lines.push('under Creative Commons Attribution ShareAlike 3.0');
  lines.push('(https://creativecommons.org/licenses/by-sa/3.0/), sourced through');
  lines.push('BreakingCopyright (https://breakingcopyright.com). The credit is on the closing');
  lines.push('card of the film as well as here, which is what the BY part of that licence');
  lines.push('asks for. The SA part is a decision for the owner: sharing a film that carries');
  lines.push('this track may oblige the film itself to go out under BY-SA 3.0.');
  lines.push('');
  fs.mkdirSync(path.dirname(creditsAt), { recursive: true });
  fs.writeFileSync(creditsAt, lines.join('\n'));
  console.log('credits    ' + creditsAt);
}
