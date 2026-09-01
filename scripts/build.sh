#!/usr/bin/env bash
# nema build: dist/<app>/ = apps/<app>/public/. plus a copy of shared/.
# There is no bundler. This script only copies files.
# Usage: scripts/build.sh            build all five apps (clears dist/)
#        scripts/build.sh vault      rebuild one app in place (safe while dev servers run)
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

ALL=(site vault harness security coach)
if [ "$#" -gt 0 ]; then
  APPS=("$@")
else
  APPS=("${ALL[@]}")
  find dist -mindepth 1 -maxdepth 1 -type d ! -name "*.tmp" 2>/dev/null | while read -r d; do case " ${ALL[*]} " in *" $(basename "$d") "*) ;; *) rm -rf "$d";; esac; done
fi

for app in "${APPS[@]}"; do
  case " ${ALL[*]} " in *" $app "*) ;; *) echo "unknown app: $app" >&2; exit 1;; esac
  mkdir -p "dist/$app"
  # Refresh in place: copy over, then remove files that no longer exist in the source.
  rm -rf "dist/$app.tmp"
  mkdir -p "dist/$app.tmp"
  if [ -d "apps/$app/public" ]; then
    cp -r "apps/$app/public/." "dist/$app.tmp/"
  fi
  cp -r shared "dist/$app.tmp/shared"
  rm -rf "dist/$app"
  mv "dist/$app.tmp" "dist/$app"
  echo "built dist/$app"
done

echo "build complete: ${#APPS[@]} app(s) in dist/"
