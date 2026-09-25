#!/usr/bin/env bash
# One-time Cloudflare setup for the hosted Worker. Run after `npx wrangler login`.
#   scripts/cloudflare-setup.sh            # create D1 + KV, write ids into wrangler.toml, load the latest national pack
#   scripts/cloudflare-setup.sh --skip-load
set -euo pipefail
cd "$(dirname "$0")/.."

DB_NAME="uk-drone-airspace"
KV_TITLE="uk-drone-airspace-cache"

echo "== Cloudflare account"
npx wrangler whoami | sed -n '1,6p'

echo "== D1 database ($DB_NAME)"
find_db() { npx wrangler d1 list --json 2>/dev/null | node -p "const l=JSON.parse(require('fs').readFileSync(0,'utf8')); (l.find(d=>d.name==='$DB_NAME')||{}).uuid||''"; }
DB_ID=$(find_db)
if [ -z "$DB_ID" ]; then
  npx wrangler d1 create "$DB_NAME" >/dev/null
  DB_ID=$(find_db)
fi
echo "   id: $DB_ID"

echo "== KV namespace ($KV_TITLE)"
KV_ID=$(npx wrangler kv namespace list | node -p "const l=JSON.parse(require('fs').readFileSync(0,'utf8')); (l.find(n=>n.title.endsWith('$KV_TITLE'))||{}).id||''")
if [ -z "$KV_ID" ]; then
  npx wrangler kv namespace create "$KV_TITLE" >/dev/null
  KV_ID=$(npx wrangler kv namespace list | node -p "const l=JSON.parse(require('fs').readFileSync(0,'utf8')); l.find(n=>n.title.endsWith('$KV_TITLE')).id")
fi
echo "   id: $KV_ID"

echo "== wrangler.toml"
sed -i.bak "s/database_id = \".*\"/database_id = \"$DB_ID\"/; s/^id = \".*\"/id = \"$KV_ID\"/" wrangler.toml && rm -f wrangler.toml.bak
grep -E "database_id|^id =" wrangler.toml

if [ "${1:-}" != "--skip-load" ]; then
  echo "== Loading the latest national pack into D1 (this takes several minutes)"
  mkdir -p build/d1-load && cd build/d1-load
  curl -sSL -o manifest.json https://github.com/noodlemctwoodle/Drone-Airspace-MCP/releases/latest/download/manifest.json
  ASSET=$(node -p "require('./manifest.json').asset.url")
  echo "   $ASSET"
  curl -sSL -o pack.sqlite.gz "$ASSET" && gunzip -f pack.sqlite.gz
  cd ../..
  npx tsx scripts/export-d1.ts build/d1-load/pack.sqlite --out build/d1-load/d1.sql
  npx wrangler d1 execute "$DB_NAME" --remote --yes --file build/d1-load/d1.sql
fi

echo
echo "Next:"
echo "  npx wrangler secret put OS_NAMES_API_KEY   # optional, better place-name geocoding"
echo "  npm run worker:deploy                       # prints the workers.dev URL; put it in wrangler.toml as PUBLIC_URL"
echo "  GitHub repo: add secrets CLOUDFLARE_API_TOKEN + CLOUDFLARE_ACCOUNT_ID and variable CLOUDFLARE_DEPLOY=true"
