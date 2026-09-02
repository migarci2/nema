#!/usr/bin/env bash
# Restart the wrangler dev server of one app: scripts/dev-restart.sh vault
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
app="${1:?app name}"
case "$app" in site) port=8780;; vault) port=8781;; harness) port=8782;; security) port=8783;; blog) port=8785;; aesgcm) port=8786;; *) echo "unknown app" >&2; exit 1;; esac
inspector=$((port + 450))
for pid in $(pgrep -f 'wrangler dev' || true); do
  if tr '\0' ' ' < "/proc/$pid/cmdline" 2>/dev/null | grep -q "apps/$app/wrangler.jsonc"; then kill "$pid" 2>/dev/null || true; fi
done
sleep 1
bash scripts/build.sh "$app" >/dev/null
mkdir -p "$ROOT/.dev-logs"
nohup wrangler dev --config "apps/$app/wrangler.jsonc" --port "$port" --inspector-port "$inspector" > "$ROOT/.dev-logs/$app.log" 2>&1 &
for i in $(seq 1 60); do
  if [ "$(curl -s -o /dev/null -w '%{http_code}' "http://localhost:$port/")" = "200" ]; then echo "$app up on $port"; exit 0; fi
  sleep 1
done
echo "$app did not come up; see .dev-logs/$app.log" >&2
exit 1
