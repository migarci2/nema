#!/usr/bin/env bash
# nema dev: build, write provider secrets for local runs, then start the five
# wrangler dev servers on their fixed ports (contract section 1).
#   site 8780, vault 8781, harness 8782, security 8783, coach 8784
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

bash scripts/build.sh

SECRETS="secrets/issuer-private-keys.json"
if [ -f "$SECRETS" ]; then
  for app in harness security; do
    if node -e "
      const keys = require('./$SECRETS');
      if (!keys['$app']) process.exit(1);
      process.stdout.write(JSON.stringify(keys['$app']));
    " > "apps/$app/.dev.vars.tmp" 2>/dev/null; then
      printf 'ISSUER_PRIVATE_JWK=%s\n' "$(cat "apps/$app/.dev.vars.tmp")" > "apps/$app/.dev.vars"
      echo "wrote apps/$app/.dev.vars"
    else
      echo "warning: no '$app' entry in $SECRETS, skipping .dev.vars"
    fi
    rm -f "apps/$app/.dev.vars.tmp"
  done
else
  echo "warning: $SECRETS not found. Providers will not be able to sign receipts."
fi

PIDS=()
CLEANED=0

# Resolve wrangler directly rather than through npx: a signal sent to an npx or
# npm exec wrapper is not forwarded to the wrangler process it spawned.
if [ -x "node_modules/.bin/wrangler" ]; then
  WRANGLER="$ROOT/node_modules/.bin/wrangler"
elif command -v wrangler > /dev/null 2>&1; then
  WRANGLER="$(command -v wrangler)"
else
  echo "error: wrangler not found. Install it globally or run npm install." >&2
  exit 1
fi

cleanup() {
  if [ "$CLEANED" = "1" ]; then
    return
  fi
  CLEANED=1
  echo
  echo "stopping dev servers"
  for pid in "${PIDS[@]:-}"; do
    if [ -z "$pid" ]; then
      continue
    fi
    # Job control is on, so every background job leads its own process group.
    # Signal the whole group so wrangler and its workerd child both stop.
    kill -TERM -- -"$pid" 2>/dev/null || kill -TERM "$pid" 2>/dev/null || true
  done
  wait 2>/dev/null || true
}
trap cleanup EXIT
trap 'exit 130' INT TERM

# Enable job control so each background job becomes its own process group.
set -m

start() {
  local app="$1" port="$2" inspector="$3"
  "$WRANGLER" dev --config "apps/$app/wrangler.jsonc" --port "$port" --inspector-port "$inspector" --local &
  PIDS+=("$!")
  echo "  $app: http://localhost:$port"
}

echo "starting nema dev servers"
start site 8780 9780
start vault 8781 9781
start harness 8782 9782
start security 8783 9783
start coach 8784 9784

echo
echo "press ctrl-c to stop all five"
wait
