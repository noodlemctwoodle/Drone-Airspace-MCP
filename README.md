# UK Drone Airspace MCP

An MCP server that answers the question existing airspace tools do not: **can I legally take off and fly a drone here, in the UK?**

Airspace restriction data is the easy half. A UK pilot actually has to clear three layers: permanent airspace restrictions (aerodrome flight restriction zones, prohibited, restricted and danger areas), temporary restrictions (NOTAMs), and landowner rules (National Trust byelaws, council park byelaws). The practical workaround pilots use is launching from a public right of way, where no landowner permission is needed. This server puts all of that behind twelve tools that take a place name, a postcode or coordinates.

Informational only. It is not a substitute for a NATS pre-flight briefing, the CAA Drone Code, or permission from the landowner and any relevant aerodrome.

## What it answers

- **Is this point inside a restriction?** `check_location` returns a one-line verdict and every zone containing the point, with vertical limits, activation notes and who to ask. Prison restricted areas (the 400 m zones around every closed prison and young offender institution in England and Wales, an offence to enter without HMPPS permission) are recognised as their own zone type rather than as aerodromes.
- **What is this aerodrome's zone?** `get_aerodrome_zone` by name or ICAO code, including runway protection zones.
- **Is there a NOTAM in force?** `check_notams` reads the live NATS UK bulletin, filters by point, radius and date, and never silently drops NOTAMs it cannot place.
- **What does my route cross?** `check_route` for a list of waypoints or an area, with the distance along the route at which each zone is entered.
- **Can I take off here?** `check_takeoff_site` lists the nearest public rights of way with distances and the responsible council, the nearest public parking, plus National Trust land and known council byelaws at the point.
- **Where can I park?** `find_parking` lists car parks, laybys and rest areas from OpenStreetMap, nearest first, with fee and access notes.
- **Can I fly here, now?** `preflight_briefing` combines everything into one GO, CAUTION or NO-GO answer with reasons: airspace verdict, live NOTAMs, the weather window and geomagnetic activity, rights of way, parking and, when you name your drone, its rules. A live source that fails is reported as an outage, never assumed clear.
- **What is the ground doing?** `check_terrain` profiles ground elevation along a route or around a point against the 120 m rule, which is measured from the surface below the aircraft, and warns when rising ground eats the clearance or falling ground puts a fixed height above the limit.
- **What can my drone do?** `check_drone_rules` takes a model name or a weight and class mark and answers which open subcategory applies (A1, A2 or A3), the separation from people, whether Flyer and Operator IDs are needed and when Remote ID is required, under the CAA class mark rules in force from 2026. `check_takeoff_site` accepts a `drone` too and adds the same summary to the site report. Both tools also list open access land (context for take-off, never permission) and SSSI or National Park designations (advisory) at the point, and treat Forestry England land as a take-off ban without a permit. Take-off and location reports also name the local authority at the point and any council-wide drone policy recorded for it in the seed list.
- **Is the weather flyable?** `check_weather` gives an hourly forecast from Open-Meteo with wind and gusts at 10 m, wind at 120 m, rain, visibility, cloud, temperature and daylight, each hour rated good, caution or poor against typical small-drone limits.
- **Show me.** On the hosted server every location answer carries a map link, and clients that support MCP Apps (Claude web, desktop and mobile) render the map inline: zones coloured by severity, NOTAM circles, footpaths, landowner land and parking.
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

The same server runs as a Cloudflare Worker at **`https://drone-airspace.fetchlabs.co.uk/mcp`**, which is what Claude's mobile app and voice mode can reach: they cannot run local servers, only remote connectors. Add it on claude.ai under Settings > Connectors > Add custom connector with that URL, and it becomes available on every surface, including voice conversations. Every tool accepts `format: "brief"`, which returns two or three spoken-friendly sentences instead of the full report.

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

### `find_parking`

| Argument | Type | Notes |
|---|---|---|
| `place` / `lat`+`lon` | | |
| `max_results` | 1–20 | Default 5 |
| `search_radius_m` | 100–10000 | Default 2000 |
| `include_private` | boolean | Also list private, customers-only and permit parking |

Example prompt: *"Where can I park near Durdle Door?"*

### `check_weather`

| Argument | Type | Notes |
|---|---|---|
| `place` / `lat`+`lon` | | |
| `date` | ISO 8601 | A bare date reports daylight hours; a date-time starts there. Defaults to now |
| `hours` | 1–24 | Hours to report from the start (default 6) |

Example prompt: *"Is it flyable at Ilkley Moor on Saturday afternoon?"*

Ratings are advisory: caution from 8 m/s, poor from 10.7 m/s sustained or 12 m/s gusts, any rain, visibility under 1.5 km, and a caution for freezing temperatures, low cloud or strong wind at 120 m.

The report also carries the NOAA planetary K-index (geomagnetic activity), which affects GPS accuracy and compass behaviour: quiet, unsettled, active (Kp 4) or storm (Kp 5 and above). It does not change the weather rating; the briefing tool treats a storm as caution.

### `preflight_briefing`

One report for a take-off point and time. `place` / `lat`+`lon`, `date` (default now), `hours` (window length, default 3), optional `drone` and `a2_certificate`, `frz_permission` when an aerodrome has already agreed the flight, `notam_radius_km` (default 10), `max_paths`. The status is deterministic: prohibited, prison or restricted airspace, an FRZ without permission, or a landowner ban is NO-GO; an FRZ with permission, a covering NOTAM, a danger area, poor weather, a geomagnetic storm, a ground hazard within 200 m, or any live source that could not be read is CAUTION; otherwise GO. Notes (marginal weather, nearby or unlocated NOTAMs, no right of way nearby, A3 separation) never change the status. The JSON carries each sub-result, the reasons and an `outages` list.

### `check_terrain`

Ground elevation against the 120 m rule. Give `waypoints` (2 to 50) for a profile, or a point with `radius_m` (default 500) for the ground around it; `flight_height_m` (default 120) is the planned height above take-off and `step_m` the sample spacing. Reports the highest and lowest ground relative to the take-off point and warns when the ground rises within 30 m of the flight height (caution) or above it (poor), or falls far enough that the flight would be more than 120 m above the surface. Elevations come from Copernicus GLO-90 via Open-Meteo at about 90 m resolution, so cliffs and buildings are not resolved.

### `check_drone_rules`

Which UK open category rules apply to a consumer drone. Give `model` (looked up in the curated catalogue in `src/services/drones/catalogue.ts`: DJI, Autel, Potensic, HoverAir and Parrot models with take-off weight, EU C-class and UK class marks) or `weight_g` with an optional `class_mark` (C0 to C4, UK0 to UK4, or none). Set `a2_certificate` if the pilot holds an A2 CofC and `date` to see the rules on a future date. The answer gives the subcategory, overflight and separation rules, registration (Flyer ID and Operator ID, 100 g threshold from 2026), Remote ID dates (UK1 to UK3 from 2026, camera aircraft of 100 g or more otherwise from 2028) and the transition under which EU C-class labels count as UK classes until the end of 2027. Rules and dates live in `src/services/drones/rules.ts` with the CAA pages they were taken from; the catalogue is community-maintained like the byelaw list, and an unconfirmed class mark is left null so the aircraft is treated as legacy.

### Maps

The hosted server serves `GET /map?lat=&lon=[&radius=][&route=lon,lat;lon,lat]` as a standalone Leaflet map, `GET /api/view` as the JSON behind it, and `GET /api/wind?bbox=w,s,e,n&z=` for the wind field (one Open-Meteo request per view, snapped to a fixed lattice of at most 64 points and cached per point). It also publishes an MCP App resource (`ui://uk-drone-airspace/map`) attached to `check_location`, `check_takeoff_site`, `check_route` and `find_parking`, so hosts that support MCP Apps show the map inline with the answer. Claude web, desktop and mobile render it; Claude Code shows the text only.

The layers panel (top left) offers Map or Satellite base layers and a checkbox for every overlay, grouped into Airspace (each zone class and NOTAMs), On the ground (rights of way, landowner land, parking, route) and Weather. Prohibited and restricted areas and aerodrome FRZs are always drawn and cannot be switched off. Satellite is Esri World Imagery with a place-name overlay; add `basemap=satellite` to the `/map` URL to open in that view. Weather has three toggles: Conditions now (a badge with the Open-Meteo flyability rating for the coming hour, including the wind at 120 m), Wind flow (animated streamlines over the visible map, as on a forecast chart, coloured by the advisory thresholds; a still frame when the browser prefers reduced motion) and Rain radar (the latest RainViewer frame, coarse at about 600 m per pixel on the free tier). `weather=0` on `/api/view` skips the forecast. Base layer, overlay and panel choices are remembered per browser.

The location card has a Your drone picker fed by `GET /api/drones` (the catalogue with each model's rules summary and a drawn silhouette). Choosing a model makes it the location marker and the key swatch, and shows its subcategory and overflight rule in the card. Add `drone=<catalogue id>` to the `/map` URL to preselect one; `check_takeoff_site` called with a `drone` does this for the MCP App. The silhouettes are original drawings, one per family (palm, mini, air, mavic, fpv, phantom), because manufacturer photographs are copyrighted.

Map tiles © OpenStreetMap contributors; imagery © Esri, Maxar, Earthstar Geographics, and the GIS User Community; rain radar © RainViewer; weather © Open-Meteo.com (CC BY 4.0).

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
| Elevation | [Open-Meteo Elevation API](https://open-meteo.com/en/docs/elevation-api), Copernicus GLO-90 DEM | Live, cached 30 days per 100 m cell | CC BY 4.0 (Open-Meteo), Copernicus data licence |
| Geomagnetic activity | [NOAA SWPC planetary K-index](https://services.swpc.noaa.gov/products/noaa-planetary-k-index.json) | Live, cached 15 min | US Government, public domain |
| Drone rules | [CAA class marks](https://www.caa.co.uk/drones/getting-started-with-drones-and-model-aircraft/class-marks/) and the [Drone Code](https://register-drones.caa.co.uk/drone-code), summarised in `src/services/drones/rules.ts`; drone catalogue curated from manufacturer specifications | With the code | Crown copyright, OGL v3; the CAA pages are authoritative |
| Open access land | [Natural England CRoW Access Layer](https://naturalengland-defra.opendata.arcgis.com/datasets/Defra::crow-act-2000-access-layer/about), [NRW open country and common land](https://datamap.gov.wales/) | With the pack | OGL v3, see [licences/natural-england.md](licences/natural-england.md) and [licences/natural-resources-wales.md](licences/natural-resources-wales.md) |
| SSSI and National Parks | Natural England and Natural Resources Wales designation boundaries | With the pack | OGL v3, advisory only |
| Forestry England land | [Forestry England Legal Boundary](https://data-forestry.opendata.arcgis.com/) | With the pack | OGL v3 with acknowledgement, see [licences/forestry-england.md](licences/forestry-england.md); byelaws need a permit for drones |
| Local authorities | [ONS Local Authority Districts (May 2026) BSC](https://geoportal.statistics.gov.uk/) | With the pack | OGL v3, see [licences/ONS.md](licences/ONS.md) |
| Parking and laybys | OpenStreetMap via the [Geofabrik Great Britain extract](https://download.geofabrik.de/europe/great-britain.html) (`amenity=parking`, `highway=rest_area`) | Weekly | ODbL |
| Country boundaries | ONS Countries (December 2024) BUC | Yearly | OGL v3 |
| Geocoding | postcodes.io, OS Names API (optional), Nominatim | Live, cached 30 days | OGL v3; ODbL |
| Weather | [Open-Meteo](https://open-meteo.com/) forecast API | Live, cached 15 min | CC BY 4.0 |

Every response ends with an `Attribution:` line listing only the sources actually used, including the per-council attribution that the OGL requires for rights-of-way data.

The permanent layers are assembled into a data pack by [`.github/workflows/build-pack.yml`](.github/workflows/build-pack.yml), published as a GitHub Release tagged `pack-<AIRAC date>-<run>`, and verified by sha256 on download. See [CLAUDE.md](CLAUDE.md) for the pipeline layout.

## Configuration

| Variable | Default | Purpose |
|---|---|---|
| `OS_NAMES_API_KEY` | unset | Enables the OS Names geocoder |
| `OS_NAMES_URL` | `https://api.os.uk/search/names/v1/find` | |
| `OPEN_METEO_ELEVATION_URL` | `https://api.open-meteo.com/v1/elevation` | |
| `ELEVATION_CACHE_TTL_SECONDS` | `2592000` | Terrain does not change |
| `NOAA_KP_URL` | `https://services.swpc.noaa.gov/products/noaa-planetary-k-index.json` | |
| `SPACE_WEATHER_CACHE_TTL_SECONDS` | `900` | |
| `NOMINATIM_URL` | `https://nominatim.openstreetmap.org/search` | Self-host to lift the 1 req/s limit |
| `POSTCODES_IO_URL` | `https://api.postcodes.io` | |
| `NOTAM_PIB_URL` | `https://pibs.nats.co.uk/operational/pibs/PIB.xml` | |
| `NOTAM_CACHE_TTL_SECONDS` | `1800` | |
| `OPEN_METEO_URL` | `https://api.open-meteo.com/v1/forecast` | |
| `WEATHER_CACHE_TTL_SECONDS` | `900` | |
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
