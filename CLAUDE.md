# CLAUDE.md

Context for Claude Code working on this repo.

## What this is
A TypeScript MCP server answering **where a drone can legally take off and fly
in the UK**: NATS ENR 5.1 flight restriction zones, live NOTAMs, public rights
of way, National Trust land and known council byelaws. Runs over stdio for
Claude Desktop (`npx fpv-airspace`) or streamable HTTP
(`--transport http`) for a hosted deployment. Permanent data comes from a
SQLite **data pack** built by GitHub Actions and downloaded on first run;
geocoding and NOTAMs are live.

## Run / dev
```bash
npm install
npm run dev                        # stdio server from source (tsx)
npm run build && node dist/index.js --help
npm test                           # vitest, fully offline
npm run lint && npm run typecheck
npx @modelcontextprotocol/inspector node dist/index.js   # poke the tools

# data pack (needs network; ~2 min for south-west, longer for national)
npm run pack:build -- --region south-west --tag pack-dev
PACK_PATH=build/pack/pack-dev.sqlite npm run dev
```
Node 22.13+ is required: the server uses the built-in `node:sqlite` (no native
module) and silences its ExperimentalWarning in `src/index.ts`.

`PackRepository` is async everywhere (D1 has no sync API); the query core lives in `QueryPackRepository` over the tiny `AsyncQuery` interface with node:sqlite and D1 adapters.

`npm run build` typechecks then bundles everything into a single `dist/index.js`
with esbuild (`scripts/bundle.mjs`). The published package has **no runtime
dependencies**, so `npx` starts it in seconds instead of resolving 200+
packages; keep it that way (all packages live in `devDependencies`).

## Architecture
```
src/
  index.ts, bootstrap.ts   entry, argv, dependency wiring, transport start (never blocks on the pack)
  server.ts                McpServer; zips tools/definitions.ts with handlers/
  tools/                   names.ts (TOOL_NAMES), schemas.ts (zod fragments), definitions.ts (model-facing contract)
  handlers/                one file per tool group; deps.ts (HandlerDependencies, PackAccess); caveats.ts
  services/
    geocoder/              postcodes.io -> OS Names (if key) -> Nominatim; query-normaliser strips "the layby below X"
    location-resolver.ts   resolved | ambiguous | not_found (never guesses)
    notam/                 pib-schema.ts (ALL element names), pib-parser, q-line, validity, fetcher (30 min cache), service
    airspace/              engine (point / route / area), verdict.ts (exact wording + severity), vertical.ts (400 ft rule)
    rights-of-way.ts
    weather/               open-meteo.ts (client, 15 min cache per 5 km cell), assessment.ts (advisory flyability thresholds)
    drones/                catalogue.ts (curated consumer models: weight, C-class, UK class), rules.ts (CAA open category rules as dated data)
  pack/                    schema.ts (DDL, SCHEMA_VERSION), driver.ts (node:sqlite), repository.ts (rtree + turf), loader.ts, manifest.ts
  formatters/              report.ts (plain text), units.ts, attribution.ts, hazards.ts (kind labels, map groups, danger vs site kinds)
  transport/               stdio.ts, http.ts (Express, stateless POST /mcp, GET /healthz)
pipeline/                  build-time only: lib/ (http cache, zip, airac, regions, geometry, ordered xml), sources/{nats,rowmaps,nt,byelaws,countries,osm}, assemble/, verify/
                           osm/parking.ts needs `osmium` (brew/apt osmium-tool) and the 1.9 GB Geofabrik GB extract, cached a week in build/raw/osm
scripts/                   tsx CLIs: fetch-*, build-pack, verify-pack, make-manifest, check-upstream, prune-releases, inspect-pib
data/byelaws/seed.yaml     community-maintained council byelaw list
test/                      fixtures/ (real NATS excerpts, PIB excerpt, rowmaps, NT, byelaws), helpers/ (FakePackRepository, mini-pack, fake-fetch)
```
  worker/                  Cloudflare Worker entry (fetch handler, WebStandard streamable HTTP, /map, /api/view), d1-pack.ts (PackAccess over D1), kv-cache.ts
  map/                     view-data.ts (JSON for the map, wind lattice, drone index), html.ts (Leaflet page; also the MCP App resource ui://fpv-airspace/map), silhouettes.ts (drawn drone marker outlines)
Flow: tool -> `resolveOrRespond` (geocode) -> `pack.require()` -> engine/service -> formatter -> `respond(format, data, renderText, renderBrief)`.

Three runtimes share everything above `pack/` and `core/`:
- **npx / .mcpb**: node:sqlite pack downloaded from GitHub Releases (`pack/loader.ts`).
- **Cloudflare Worker**: the same pack loaded into D1 by `scripts/d1-load.sh` (`export-d1.ts --parts` writes 80 MB files, schema first and chunked rtree rebuilds last, because one 400 MB import times out and rolls back; rows split so no statement exceeds D1's 100 KB limit), KV for caches. `npm run worker:dev` runs it locally against `.wrangler/state`; `wrangler d1 execute uk-drone-airspace --local --file build/d1.sql` loads a pack for local dev.
- **Docker / --transport http**: Express in `transport/http.ts`.
`format: "brief"` exists for voice: two or three sentences, no coordinates, one short "Sources:" sentence.
Maps: with `PUBLIC_URL` set, location tools append `Map: <url>` to text output and return `structuredContent.view` (a tiny descriptor, never geometry); the MCP App HTML fetches `/api/view` itself. Keep tool results small; geometry only ever travels through `/api/view`.

## Conventions (follow these)
- Tool descriptions and zod schemas in `src/tools/` are the model-facing contract. Keep them tight, en-GB, no emoji, no em-dashes.
- Validate with zod in `tools/`; handlers never re-implement argument checks (except the place XOR lat/lon rule in `schemas.ts`).
- Parsers are **defensive**: a shape change degrades to `[]` / `null` and a warning, never a crash. The NOTAM feed has no schema; its element names live only in `pib-schema.ts`.
- Endpoints that drift live in env vars with defaults (`src/core/config.ts`); never hard-code a URL in a service.
- Cache every live fetch through `DiskCache`; Nominatim stays behind the 1 req/s `TokenBucket`.
- Logs go to **stderr only**; stdout is the MCP channel.
- Rtree prefilter then exact turf test, always. Geometry in the pack is 6 dp; PRoW lines are polyline6 (axis flip lives only in `pack/geometry.ts` and `pipeline/lib/geometry.ts`).
- Every response ends with an `Attribution:` line naming only the sources used. Rights-of-way attribution is per council (OGL requirement).
- Anything testable without network gets an offline test under `test/`; add a fixture when touching a parser. The contract test keeps definitions and handlers in sync.
- Conventional commits; no Co-Authored-By lines; do not mention AI tooling in commit messages.

## Guardrails (do not cross)
- Never guess a location: ambiguity returns candidates, an outage returns an error.
- Never drop NOTAMs silently; unlocated ones are listed separately.
- Keep the disclaimer caveats in every route and take-off response. This is informational, not a pre-flight briefing.
- No tools that write anything. All tools carry `readOnlyHint`.
- NATS redistribution terms are unconfirmed (see `licences/NATS.md`); keep `--exclude nats` working.

## Testing
`npm test` runs 100+ vitest tests offline in under two seconds. Baselines: contract (definitions == handlers), in-memory MCP client end to end, HTTP transport on port 0, AIXM parser against real NATS excerpts with a KML cross-check, PIB parser against a real excerpt, mini pack build + repository queries + loader download/verify/hot-swap. CI (`.github/workflows/ci.yml`) runs lint, typecheck, tests and a `npm pack` content check on Node 22 and 24.

## Data pack lifecycle
`build-pack.yml` runs daily; `scripts/check-upstream.ts` builds only when the NATS AIRAC date, the National Trust edit date, the byelaw seed or the pipeline changed (plus a weekly rights-of-way refresh). Releases are tagged `pack-<AIRAC yyyymmdd>-<run>` with `manifest.json`; the server reads `releases/latest/download/manifest.json`, verifies both sha256 hashes, and hot-swaps. Bump `SCHEMA_VERSION` in `src/pack/schema.ts` on any incompatible change.
