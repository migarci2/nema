#!/usr/bin/env bash
# nema build: dist/<app>/ = apps/<app>/public/. plus a copy of shared/.
# There is no bundler. This script only copies files, in place, so a running
# wrangler dev that serves dist/<app> never loses the directory it watches.
# Usage: scripts/build.sh            build every app
#        scripts/build.sh vault      rebuild one app
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

ALL=(site vault harness security blog aesgcm cpu)
if [ "$#" -gt 0 ]; then APPS=("$@"); else APPS=("${ALL[@]}"); fi

for app in "${APPS[@]}"; do
  case " ${ALL[*]} " in *" $app "*) ;; *) echo "unknown app: $app" >&2; exit 1;; esac
  mkdir -p "dist/$app"
  if [ -d "apps/$app/public" ]; then
    rsync -a --delete --exclude shared "apps/$app/public/" "dist/$app/"
  fi
  if [ "$app" = "blog" ] || [ "$app" = "aesgcm" ] || [ "$app" = "cpu" ]; then
    # The blog and the two mirrored articles are the proof that the install is
    # one tag: their origins carry the article and nothing else. They load the
    # embed and the modules the embed imports from the hub, cross origin.
    rm -rf "dist/$app/shared"
  else
    mkdir -p "dist/$app/shared"
    rsync -a --delete "shared/" "dist/$app/shared/"
  fi
  if [ "$app" = "aesgcm" ] || [ "$app" = "cpu" ]; then
    # compare.html reads this file to show, and to count, exactly what nema
    # added to the article. diff exits 1 when the files differ, which is the
    # normal case here, so its status is ignored on purpose.
    ( cd "apps/$app/public" && diff -u original.html index.html > diff.txt || true )
    cp "apps/$app/public/diff.txt" "dist/$app/diff.txt"
  fi
  echo "built dist/$app"
done

echo "build complete: ${#APPS[@]} app(s) in dist/"
