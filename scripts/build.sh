#!/usr/bin/env bash
# nema build: dist/<app>/ = apps/<app>/public/. plus a copy of shared/.
# There is no bundler. This script only copies files, in place, so a running
# wrangler dev that serves dist/<app> never loses the directory it watches.
# Usage: scripts/build.sh            build all five apps
#        scripts/build.sh vault      rebuild one app
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

ALL=(site vault harness security coach)
if [ "$#" -gt 0 ]; then APPS=("$@"); else APPS=("${ALL[@]}"); fi

for app in "${APPS[@]}"; do
  case " ${ALL[*]} " in *" $app "*) ;; *) echo "unknown app: $app" >&2; exit 1;; esac
  mkdir -p "dist/$app/shared"
  if [ -d "apps/$app/public" ]; then
    rsync -a --delete --exclude shared "apps/$app/public/" "dist/$app/"
  fi
  rsync -a --delete "shared/" "dist/$app/shared/"
  echo "built dist/$app"
done

echo "build complete: ${#APPS[@]} app(s) in dist/"
