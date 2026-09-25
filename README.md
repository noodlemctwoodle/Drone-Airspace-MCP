# UK Drone Airspace MCP

An MCP server that answers the question existing airspace tools do not: **can I legally take off and fly a drone here, in the UK?**

Airspace restriction data is the easy half. A UK pilot actually has to clear three layers: permanent airspace restrictions (aerodrome flight restriction zones, prohibited, restricted and danger areas), temporary restrictions (NOTAMs), and landowner rules (National Trust byelaws, council park byelaws). The practical workaround pilots use is launching from a public right of way, where no landowner permission is needed. This server puts all of that behind seven tools that take a place name, a postcode or coordinates.

Informational only. It is not a substitute for a NATS pre-flight briefing, the CAA Drone Code, or permission from the landowner and any relevant aerodrome.

## What it answers

- **Is this point inside a restriction?** `check_location` returns a one-line verdict and every zone containing the point, with vertical limits, activation notes and who to ask.
- **What is this aerodrome's zone?** `get_aerodrome_zone` by name or ICAO code, including runway protection zones.
- **Is there a NOTAM in force?** `check_notams` reads the live NATS UK bulletin, filters by point, radius and date, and never silently drops NOTAMs it cannot place.
- **What does my route cross?** `check_route` for a list of waypoints or an area, with the distance along the route at which each zone is entered.
- **Can I take off here?** `check_takeoff_site` lists the nearest public rights of way with distances and the responsible council, plus National Trust land and known council byelaws at the point.
- Plus `geocode` to disambiguate place names and `get_data_status` for data provenance and attribution.

## Quick start

Requires Node 22.13 or newer (the server uses Node's built-in SQLite, so there is nothing native to compile). The package is a single bundled file with no dependencies, so `npx` starts it in a few seconds.

```bash
npx -y uk-drone-airspace-mcp
```

### Claude Desktop

Add to `claude_desktop_config.json` (Settings > Developer > Edit Config):

```json
{
  "mcpServers": {
    "uk-drone-airspace": {
      "command": "npx",
      "args": ["-y", "uk-drone-airspace-mcp"],
      "env": {
        "OS_NAMES_API_KEY": ""
      }
    }
  }
}
```

`OS_NAMES_API_KEY` is optional. Without it, geocoding uses OpenStreetMap's Nominatim. With a free key from the [OS Data Hub](https://osdatahub.os.uk/), Ordnance Survey place names are tried first.

On first use the server downloads the current airspace data pack (about 49 MB compressed, 115 MB on disk: 1,050 restriction zones, 520,391 rights of way, 1,694 landowner polygons) into `~/.cache/uk-drone-airspace-mcp` and reports progress on stderr. NOTAM and geocoding tools work while it downloads. The pack is refreshed automatically when a new AIRAC cycle is published.

### Claude Desktop extension (.mcpb)

Each release also ships `uk-drone-airspace.mcpb`. Download it from the [releases page](https://github.com/noodlemctwoodle/Drone-Airspace-MCP/releases), double-click it, and Claude Desktop installs the server with its bundled Node runtime and a settings panel for the optional OS Names key.

### Claude Code

```bash
claude mcp add uk-drone-airspace -- npx -y uk-drone-airspace-mcp
```

### Remote connector (Claude web, mobile and voice)

The same server runs as a Cloudflare Worker, which is what Claude's mobile app and voice mode can reach: they cannot run local servers, only remote connectors. Add it on claude.ai under Settings > Connectors > Add custom connector with the Worker's `/mcp` URL, and it becomes available on every surface, including voice conversations. Every tool accepts `format: "brief"`, which returns two or three spoken-friendly sentences instead of the full report.

Hosting your own copy:

```bash
npx wrangler login
```

```bash
npm run worker:setup
```

The setup script creates the D1 database and KV namespace, writes their ids into `wrangler.toml`, and loads the latest national pack into D1. Then `npm run worker:deploy` prints the URL. With the repository variable `CLOUDFLARE_DEPLOY=true` and the `CLOUDFLARE_API_TOKEN` / `CLOUDFLARE_ACCOUNT_ID` secrets set, GitHub Actions deploys on every push to `main` and reloads D1 whenever a new data pack is built.

### Hosted (streamable HTTP on your own server)

```bash
npx -y uk-drone-airspace-mcp --transport http --port 8080
# or
docker build -t uk-drone-airspace-mcp . && docker run -p 8080:8080 -v drone-data:/data uk-drone-airspace-mcp
```

`POST /mcp` speaks the MCP streamable HTTP transport (stateless), `GET /healthz` reports pack and NOTAM cache state.

## Tools

Every tool accepts `format: "text"` (default, a plain-text report), `format: "json"` (the same data as structured JSON) or `format: "brief"` (two or three sentences written to be read aloud, for voice). Tools that take a location accept either `place` (name, postcode or landmark) or `lat` and `lon`. When a place name matches several places, the tool returns the candidates instead of guessing.

### `check_location`

Permanent airspace restrictions and landowner rules at a point.

| Argument | Type | Notes |
|---|---|---|
| `place` / `lat`+`lon` | string / numbers | One form only |
| `include_above_120m` | boolean | Also list zones whose lower limit is above 400 ft |

Example prompt: *"Can I fly my drone at Tyndale Monument?"*

```
No permanent airspace restriction at this point.
Note: "the layby below Tyndale Monument" was not found; results are for "Tyndale Monument".

Location: Tyndale Monument, North Nibley, Gloucestershire (51.68390, -2.40540) via nominatim
...
Attribution: Airspace restrictions: UK AIP ENR 5.1 UAS Flight Restrictions dataset © NATS Limited ...; Geocoding © OpenStreetMap contributors (ODbL), via Nominatim
```

### `get_aerodrome_zone`

| Argument | Type | Notes |
|---|---|---|
| `aerodrome` | string | Name or ICAO code, e.g. `Bristol` or `EGGD` |
| `include_geojson` | boolean | Include zone geometry |

Example prompt: *"Show me the Gatwick FRZ."*

### `check_notams`

| Argument | Type | Notes |
|---|---|---|
| `place` / `lat`+`lon` | | |
| `radius_km` | 0–50 | Also list NOTAMs whose circle comes within this distance. 0 = covering only |
| `date` | ISO 8601 | Defaults to now; the bulletin covers the next 7 days |
| `max_results` | 1–50 | |

Example prompt: *"Any NOTAMs over Durdle Door this Saturday?"*

### `check_route`

| Argument | Type | Notes |
|---|---|---|
| `waypoints` | array of `[lon, lat]` or place names | 2–50 points; routes over 500 km are rejected |
| `area` | `{ bbox: [w, s, e, n] }` or GeoJSON Polygon | Instead of waypoints |
| `include_above_120m` | boolean | |

Example prompt: *"Check a route from Clevedon to Portishead along the coast."*

### `check_takeoff_site`

| Argument | Type | Notes |
|---|---|---|
| `place` / `lat`+`lon` | | |
| `max_paths` | 1–20 | Rights of way to list (default 5) |
| `search_radius_m` | 50–5000 | Default 1000 |

Example prompt: *"Where's the nearest footpath I could take off from near Corfe Castle?"*

```
Take-off restricted by landowner rule.
No permanent airspace restriction at this point.
Landowner rule: Corfe Castle (National Trust (always open land)) - National Trust byelaws prohibit taking off or landing unmanned aircraft on Trust land without the Trust's permission.
Nearest public right of way: 120 m away (footpath, Dorset).
...
```

### `geocode`

| Argument | Type | Notes |
|---|---|---|
| `query` | string | |
| `limit` | 1–10 | |

### `get_data_status`

No arguments. Reports pack tag, AIRAC effective dates, per-source fetch dates and licences, NOTAM cache age, geocoding providers and every attribution string.

## Data sources and attribution

| Layer | Source | Refresh | Licence |
|---|---|---|---|
| Flight restrictions | [NATS UK AIP ENR 5.1 UAS Flight Restrictions dataset](https://nats-uk.ead-it.com/cms-nats/opencms/en/uas-restriction-zones/) (AIXM 5.1, cross-checked against the NATS KML) | Every AIRAC cycle (28 days) | © NATS Limited; redistribution terms unconfirmed, see [licences/NATS.md](licences/NATS.md) |
| NOTAMs | [NATS AIS contingency PIB](https://www.nats.aero/do-it-online/pre-flight-information-bulletins/) (all UK NOTAMs in force or within 7 days) | Hourly upstream, 30 min cache | Informational; obtain an official briefing |
| Rights of way | Council open data aggregated by [rowmaps.com](https://www.rowmaps.com/) (143 authorities, England and Wales) | Weekly | Open Government Licence v3 per council, OS attribution, see [licences/rowmaps.md](licences/rowmaps.md) |
| National Trust land | [National Trust Open Data](https://open-data-national-trust.hub.arcgis.com/) Always Open and Limited Access | When edited | OGL v3 / CC-BY |
| Council byelaws | [data/byelaws/seed.yaml](data/byelaws/seed.yaml) in this repository | Manual | MIT; incomplete by nature |
| Country boundaries | ONS Countries (December 2024) BUC | Yearly | OGL v3 |
| Geocoding | postcodes.io, OS Names API (optional), Nominatim | Live, cached 30 days | OGL v3; ODbL |

Every response ends with an `Attribution:` line listing only the sources actually used, including the per-council attribution that the OGL requires for rights-of-way data.

The permanent layers are assembled into a data pack by [`.github/workflows/build-pack.yml`](.github/workflows/build-pack.yml), published as a GitHub Release tagged `pack-<AIRAC date>-<run>`, and verified by sha256 on download. See [CLAUDE.md](CLAUDE.md) for the pipeline layout.

## Configuration

| Variable | Default | Purpose |
|---|---|---|
| `OS_NAMES_API_KEY` | unset | Enables the OS Names geocoder |
| `OS_NAMES_URL` | `https://api.os.uk/search/names/v1/find` | |
| `NOMINATIM_URL` | `https://nominatim.openstreetmap.org/search` | Self-host to lift the 1 req/s limit |
| `POSTCODES_IO_URL` | `https://api.postcodes.io` | |
| `NOTAM_PIB_URL` | `https://pibs.nats.co.uk/operational/pibs/PIB.xml` | |
| `NOTAM_CACHE_TTL_SECONDS` | `1800` | |
| `GEOCODE_CACHE_TTL_SECONDS` | `2592000` | 30 days |
| `HTTP_TIMEOUT_MS` | `8000` | Live calls |
| `DRONE_AIRSPACE_CACHE_DIR` | `~/.cache/uk-drone-airspace-mcp` | Pack and caches |
| `PACK_MANIFEST_URL` | latest GitHub release manifest | Point at a mirror or `file://` |
| `PACK_PATH` | unset | Use a local pack and skip downloads |
| `PACK_UPDATE_CHECK` | `true` | Background check for a newer pack |
| `PACK_STALE_HOURS` | `24` | How often to check |
| `LOG_LEVEL` | `info` | `debug`, `info`, `warn`, `error`, `silent` |
| `MCP_TRANSPORT` / `--transport` | `stdio` | `stdio` or `http` |
| `PORT` / `--port` | `8080` | HTTP transport |

## Caveats

- Rights-of-way data is an interpretation of each council's Definitive Map, not the Definitive Map itself, and covers England and Wales only. Scotland has no definitive map (access rights apply instead) and Northern Ireland has very few recorded rights of way; the tools say so.
- The landowner rule layer holds National Trust land and a hand-curated list of council byelaws. Absence of a rule never means take-off is permitted.
- Only zones reaching below 400 ft (120 m) count towards a verdict; higher zones are listed on request.
- NOTAMs are read from the NATS contingency bulletin, which may lag the live system by up to an hour.
- ICAO codes for aerodromes come from a curated table covering major and well-known UK aerodromes; lookups by name always work.

## Development

```bash
npm install
npm test                                  # offline vitest suite
npm run lint && npm run typecheck
npm run build && npx @modelcontextprotocol/inspector node dist/index.js
npm run pack:build -- --region south-west --tag pack-dev   # build a small real pack (network)
PACK_PATH=build/pack/pack-dev.sqlite node dist/index.js
```

Releases: tag `vX.Y.Z` to publish to npm and attach the `.mcpb` bundle. The data pack has its own release cadence driven by `build-pack.yml`.

## Licence

MIT. Data sources carry their own licences; see the [licences](licences/) folder.
