#!/usr/bin/env bash
# nema deploy: build, then deploy the workers in dependency order.
#
# Secrets are set once by hand, they are not automated here:
#   npx wrangler secret put ISSUER_PRIVATE_JWK --config apps/harness/wrangler.jsonc
#   npx wrangler secret put ISSUER_PRIVATE_JWK --config apps/security/wrangler.jsonc
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

bash scripts/build.sh

APPS=(site vault harness security blog)

for app in "${APPS[@]}"; do
  echo
  echo "deploying $app"
  npx wrangler deploy --config "apps/$app/wrangler.jsonc"
done

echo
echo "deployed:"
# The URLs come from the documented copy in shared/origins.json so a domain
# change only has to be made there and in shared/origins.js.
node -e 'const o = require("./shared/origins.json").prod; for (const [name, url] of Object.entries(o)) console.log("  " + name + ": " + url);'
