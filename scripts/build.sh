#!/usr/bin/env bash
# nema build: dist/<app>/ = apps/<app>/public/. plus a copy of shared/.
# There is no bundler. This script only copies files.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

APPS=(site vault harness security coach)

rm -rf dist

for app in "${APPS[@]}"; do
  mkdir -p "dist/$app"
  if [ -d "apps/$app/public" ]; then
    cp -r "apps/$app/public/." "dist/$app/"
  fi
  cp -r shared "dist/$app/shared"
  echo "built dist/$app"
done

echo "build complete: ${#APPS[@]} apps in dist/"
