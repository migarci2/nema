#!/usr/bin/env bash
# Build the unpacked Chrome extension into packages/nema-extension/dist.
#
# The extension is the vault plus four small files. There is no bundler: this
# script copies apps/vault/public into the extension root (so the vault's
# absolute imports, /vault.js and /shared/..., resolve inside
# chrome-extension://<id>/), copies shared/ next to it, adds the extension's own
# files, writes sidepanel.html from the vault's index.html, and writes the
# manifest last so a half built directory is never loadable.
#
# Usage: scripts/build-extension.sh
# Load:  chrome://extensions -> Developer mode -> Load unpacked -> that dist.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

PKG="packages/nema-extension"
OUT="$PKG/dist"
VAULT="apps/vault/public"

for file in index.html app.js app.css graph.js vault.js tools.js seed.json; do
  [ -f "$VAULT/$file" ] || { echo "missing $VAULT/$file" >&2; exit 1; }
done

rm -rf "$OUT"
mkdir -p "$OUT/shared" "$OUT/icons"

# 1. The vault, whole and unmodified. Other agents own these files; whatever is
#    on disk at build time is what the panel runs.
rsync -a --exclude shared "$VAULT/" "$OUT/"

# 2. shared/ at the root, because the vault imports /shared/... absolutely.
rsync -a "shared/" "$OUT/shared/"

# 3. The extension's own files.
cp "$PKG/sw.js" "$PKG/content.js" "$PKG/bridge.js" "$PKG/sidepanel.js" "$PKG/sidepanel.css" "$OUT/"
cp "$PKG"/icons/icon*.png "$OUT/icons/"

# 4. sidepanel.html: the vault page with the hub nav hidden, the "This page"
#    strip above the summary, and one more module. Every anchor is checked, so
#    an edit to index.html that moves one of them fails the build loudly instead
#    of shipping a panel with no strip.
node - "$OUT" <<'NODE'
const { readFileSync, writeFileSync } = require('node:fs');
const out = process.argv[2];
let html = readFileSync(out + '/index.html', 'utf8');

function replace(find, make, what) {
  const at = html.indexOf(find);
  if (at === -1) {
    console.error(`build-extension: ${what} not found in the vault's index.html`);
    process.exit(1);
  }
  html = html.slice(0, at) + make(find) + html.slice(at + find.length);
}

const STRIP = `<!-- This page: the extension's broker strip. Filled by sidepanel.js. -->
    <section class="n-panel n-panel--quiet x-page" aria-labelledby="p-ext-page" data-ext-page></section>

    `;

replace('<title>nema vault</title>',
  () => '<title>nema in your browser</title>', 'the title');
replace('<link rel="stylesheet" href="/app.css">',
  (found) => found + '\n<link rel="stylesheet" href="/sidepanel.css">', 'the app.css link');
replace('<section class="n-panel n-panel--quiet v-summary"',
  (found) => STRIP + found, 'the summary section');
replace('<script type="module" src="/app.js"></script>',
  (found) => found + '\n<script type="module" src="/sidepanel.js"></script>', 'the app.js script');

writeFileSync(out + '/sidepanel.html', html);
NODE

# 5. The manifest, last.
cp "$PKG/manifest.json" "$OUT/manifest.json"
node -e "JSON.parse(require('node:fs').readFileSync('$OUT/manifest.json','utf8'))"

files=$(find "$OUT" -type f | wc -l)
echo "built $OUT ($files files)"
echo "load it: chrome://extensions, Developer mode, Load unpacked, choose $ROOT/$OUT"
