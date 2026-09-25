#!/usr/bin/env bash
# Load a built pack into the remote D1 database and verify the row counts.
#   scripts/d1-load.sh build/pack/<tag>.sqlite
# wrangler sometimes exits non-zero from a status poll after a long import has
# finished, so the exit code is ignored and the counts are the source of truth.
set -uo pipefail
cd "$(dirname "$0")/.."
PACK="${1:?usage: d1-load.sh <pack.sqlite>}"
DB_NAME="${D1_DATABASE_NAME:-uk-drone-airspace}"
SQL="build/d1-load.sql"

npx tsx scripts/export-d1.ts "$PACK" --out "$SQL" || exit 1
npx wrangler d1 execute "$DB_NAME" --remote --yes --file "$SQL" || echo "[d1-load] wrangler exited non-zero; verifying counts"

EXPECTED=$(node --no-warnings -e "
const { DatabaseSync } = require('node:sqlite'); const db = new DatabaseSync(process.argv[1], { readOnly: true });
const c = {}; for (const t of ['zones','rights_of_way','land_restrictions','coverage','parking','hazards','admin_areas','gazetteer']) c[t] = db.prepare('SELECT COUNT(*) AS n FROM '+t).get().n;
console.log(JSON.stringify(c));" "$PACK")
ACTUAL=$(npx wrangler d1 execute "$DB_NAME" --remote --yes --json --command "SELECT (SELECT COUNT(*) FROM zones) AS zones, (SELECT COUNT(*) FROM rights_of_way) AS rights_of_way, (SELECT COUNT(*) FROM land_restrictions) AS land_restrictions, (SELECT COUNT(*) FROM coverage) AS coverage, (SELECT COUNT(*) FROM parking) AS parking, (SELECT COUNT(*) FROM hazards) AS hazards, (SELECT COUNT(*) FROM admin_areas) AS admin_areas, (SELECT COUNT(*) FROM gazetteer) AS gazetteer, (SELECT COUNT(*) FROM zones_rtree) AS zones_rtree, (SELECT COUNT(*) FROM rights_of_way_rtree) AS prow_rtree, (SELECT COUNT(*) FROM hazards_rtree) AS hazards_rtree" 2>/dev/null | node -e "
let d=''; process.stdin.on('data', c => d += c).on('end', () => { const r = JSON.parse(d)[0].results[0]; console.log(JSON.stringify(r)); });")
echo "[d1-load] expected $EXPECTED"
echo "[d1-load] actual   $ACTUAL"
node -e "
const e = JSON.parse(process.argv[1]), a = JSON.parse(process.argv[2]);
const bad = Object.keys(e).filter(k => e[k] !== a[k]).concat(a.zones_rtree !== a.zones ? ['zones_rtree'] : [], a.prow_rtree !== a.rights_of_way ? ['prow_rtree'] : [], a.hazards_rtree !== a.hazards ? ['hazards_rtree'] : []);
if (bad.length) { console.error('[d1-load] MISMATCH: ' + bad.join(', ')); process.exit(1); }
console.log('[d1-load] D1 matches the pack');" "$EXPECTED" "$ACTUAL"
