#!/usr/bin/env bash
# nema build: dist/<app>/ = apps/<app>/public/. plus a copy of shared/.
# There is no bundler. This script only copies files, in place, so a running
# wrangler dev that serves dist/<app> never loses the directory it watches.
# Usage: scripts/build.sh            build every app
#        scripts/build.sh vault      rebuild one app
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

ALL=(site vault harness security blog)
if [ "$#" -gt 0 ]; then APPS=("$@"); else APPS=("${ALL[@]}"); fi

for app in "${APPS[@]}"; do
  case " ${ALL[*]} " in *" $app "*) ;; *) echo "unknown app: $app" >&2; exit 1;; esac
  mkdir -p "dist/$app"
  if [ -d "apps/$app/public" ]; then
    rsync -a --delete --exclude shared "apps/$app/public/" "dist/$app/"
  fi
  if [ "$app" = "blog" ]; then
    # The blog is the proof that the install is one tag: its origin carries the
    # article and nothing else. It loads the embed and the modules the embed
    # imports from the hub, cross origin.
    rm -rf "dist/$app/shared"
  else
    mkdir -p "dist/$app/shared"
    rsync -a --delete "shared/" "dist/$app/shared/"
  fi
  echo "built dist/$app"
done

echo "build complete: ${#APPS[@]} app(s) in dist/"
