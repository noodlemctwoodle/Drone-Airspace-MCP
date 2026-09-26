# FPV Airspace

An MCP server and map that answer the question existing airspace tools do not: **can I legally take off and fly a drone here, in the UK?**

<p align="center"><img src="docs/images/hero.webp" alt="The FPV Airspace map at Durdle Door: satellite imagery, footpaths, parking, hazards, the weather timeline and a drone marker" width="900"></p>

Airspace restriction data is the easy half. A UK pilot actually has to clear three layers: permanent airspace restrictions (aerodrome flight restriction zones, prohibited, restricted and danger areas, the 400 m zone around every prison), temporary restrictions (NOTAMs), and landowner rules (National Trust byelaws, Forestry England permits, council park byelaws). The practical workaround pilots use is launching from a public right of way, where no landowner permission is needed. This server puts all of that behind thirteen tools that take a place name, a postcode or coordinates, covers England, Wales, Scotland and Northern Ireland, and draws it on a map that Claude can show inline or that you can open on a phone.

Informational only. It is not a substitute for a NATS pre-flight briefing, the CAA Drone Code, or permission from the landowner and any relevant aerodrome.

## What it answers

- **Is this point inside a restriction?** `check_location` returns a one-line verdict and every zone containing the point, with vertical limits, activation notes and who to ask. Prison restricted areas (the 400 m zones around every closed prison and young offender institution in England and Wales, an offence to enter without HMPPS permission) are recognised as their own zone type rather than as aerodromes.
- **What is this aerodrome's zone?** `get_aerodrome_zone` by name or ICAO code, including runway protection zones.
- **Is there a NOTAM in force?** `check_notams` reads the live NATS UK bulletin, filters by point, radius and date, and never silently drops NOTAMs it cannot place.
- **What does my route cross?** `check_route` for a list of waypoints or an area, with the distance along the route at which each zone is entered.
- **Can I take off here?** `check_takeoff_site` lists the nearest public rights of way with distances and the responsible council, the nearest public parking, ground hazards within 1 km (railways, major roads, power lines and pylons, substations, helipads, masts, military land) and places people gather (schools, hospitals, parks), plus National Trust land and known council byelaws at the point.
- **Where can I park?** `find_parking` lists car parks, laybys and rest areas from OpenStreetMap, nearest first, with fee and access notes.
- **Can I fly here, now?** `preflight_briefing` combines everything into one GO, CAUTION or NO-GO answer with reasons: airspace verdict, live NOTAMs, the weather window and geomagnetic activity, rights of way, parking and, when you name your drone, its rules. A live source that fails is reported as an outage, never assumed clear.
- **What is the ground doing?** `check_terrain` profiles ground elevation along a route or around a point against the 120 m rule, which is measured from the surface below the aircraft, and warns when rising ground eats the clearance or falling ground puts a fixed height above the limit.
- **Where could I take off?** `find_takeoff_spots` scores points on public rights of way, next to parking and on open access land within a radius, excludes anything inside prohibited, restricted, prison or aerodrome zones or on banned land, and returns the best few with reasons; the map shows them numbered.
- **What can my drone do?** `check_drone_rules` takes a model name or a weight and class mark and answers which open subcategory applies (A1, A2 or A3), the separation from people, whether Flyer and Operator IDs are needed and when Remote ID is required, under the CAA class mark rules in force from 2026. `check_takeoff_site` accepts a `drone` too and adds the same summary to the site report. Both tools also list open access land (context for take-off, never permission) and SSSI or National Park designations (advisory) at the point, and treat Forestry England land as a take-off ban without a permit. Take-off and location reports also name the local authority at the point and any council-wide drone policy recorded for it in the seed list.
- **Is the weather flyable?** `check_weather` gives an hourly forecast from Open-Meteo with wind and gusts at 10 m, wind at 120 m, rain, visibility, cloud, temperature and daylight, each hour rated good, caution or poor against typical small-drone limits.
- **Show me.** On the hosted server every location answer carries a map link, and clients that support MCP Apps (Claude web, desktop and mobile) render the map inline: zones coloured by severity, NOTAM circles, footpaths, landowner land and parking.
- Plus `geocode` to disambiguate place names and `get_data_status` for data provenance and attribution.

## Quick start

Requires Node 22.13 or newer (the server uses Node's built-in SQLite, so there is nothing native to compile). The package is a single bundled file with no dependencies, so `npx` starts it in a few seconds.

```bash
npx -y fpv-airspace
```

### Claude Desktop

Add to `claude_desktop_config.json` (Settings > Developer > Edit Config):

```json
{
  "mcpServers": {
    "fpv-airspace": {
      "command": "npx",
      "args": ["-y", "fpv-airspace"],
      "env": {
        "OS_NAMES_API_KEY": ""
      }
    }
  }
}
```

`OS_NAMES_API_KEY` is optional. Without it, geocoding uses OpenStreetMap's Nominatim. With a free key from the [OS Data Hub](https://osdatahub.os.uk/), Ordnance Survey place names are tried first.

On first use the server downloads the current airspace data pack (about 195 MB compressed, 527 MB on disk: 1,069 restriction zones, 520,000 rights of way, 94,000 landowner and designation polygons, 586,000 parking spots and 816,000 ground hazards) into `~/.cache/fpv-airspace` and reports progress on stderr. NOTAM and geocoding tools work while it downloads. The pack is refreshed automatically when a new AIRAC cycle is published.

### Claude Desktop extension (.mcpb)

Each release also ships `fpv-airspace.mcpb`. Download it from the [releases page](https://github.com/noodlemctwoodle/fpv-airspace/releases), double-click it, and Claude Desktop installs the server with its bundled Node runtime and a settings panel for the optional OS Names key.

### Claude Code

```bash
claude mcp add fpv-airspace -- npx -y fpv-airspace
```

### Remote connector (Claude web, mobile and voice)

The same server runs as a Cloudflare Worker at **`https://fpv-airspace.fetchlabs.co.uk/mcp`**, which is what Claude's mobile app and voice mode can reach: they cannot run local servers, only remote connectors. Add it on claude.ai under Settings > Connectors > Add custom connector with that URL, and it becomes available on every surface, including voice conversations. Every tool accepts `format: "brief"`, which returns two or three spoken-friendly sentences instead of the full report.

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
npx -y fpv-airspace --transport http --port 8080
# or
docker build -t fpv-airspace . && docker run -p 8080:8080 -v drone-data:/data fpv-airspace
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

One report for a take-off point and time. `place` / `lat`+`lon`, `date` (default now), `hours` (window length, default 3), optional `drone` and `a2_certificate`, `frz_permission` when an aerodrome has already agreed the flight, `notam_radius_km` (default 10), `max_paths`. The status is deterministic: prohibited, prison or restricted airspace, an FRZ without permission, or a landowner ban is NO-GO; an FRZ with permission, a covering NOTAM, a danger area, poor weather, a geomagnetic storm, a physical ground hazard within 200 m, or any live source that could not be read is CAUTION; otherwise GO. Notes (marginal weather, nearby or unlocated NOTAMs, a school, hospital or park within 150 m, no right of way nearby, A3 separation) never change the status. The JSON carries each sub-result, the reasons and an `outages` list.

### `check_terrain`

Ground elevation against the 120 m rule. Give `waypoints` (2 to 50) for a profile, or a point with `radius_m` (default 500) for the ground around it; `flight_height_m` (default 120) is the planned height above take-off and `step_m` the sample spacing. Reports the highest and lowest ground relative to the take-off point and warns when the ground rises within 30 m of the flight height (caution) or above it (poor), or falls far enough that the flight would be more than 120 m above the surface. Elevations come from Copernicus GLO-90 via Open-Meteo at about 90 m resolution, so cliffs and buildings are not resolved.

### `find_takeoff_spots`

Candidate spots come from the nearest rights of way (the closest point of each plus samples every 250 m), public parking and open access land within `search_radius_m` (default 3 km), de-duplicated on a 50 m grid and capped at 60. Each is checked against the airspace and landowner layers: prohibited, restricted, prison and aerodrome zones and take-off bans exclude it; a covering NOTAM, a danger area, a landowner rule or a ground hazard within 200 m lower the score; being on a right of way, having parking within 300 m and open access land raise it; distance from the centre costs a little. Scores are integers with a reason per term, so the ordering is deterministic. `max_results` (default 3), optional `drone` and `a2_certificate` (a school, hospital, park or similar within 150 m costs a little, and a lot for A3 pilots). The JSON lists the spots and the excluded candidates grouped by reason. A right of way is a right to pass, not to stop and fly.

### `check_drone_rules`

Which UK open category rules apply to a consumer drone. Give `model` (looked up in the curated catalogue in `src/services/drones/catalogue.ts`: DJI, Autel, Potensic, HoverAir and Parrot models with take-off weight, EU C-class and UK class marks) or `weight_g` with an optional `class_mark` (C0 to C4, UK0 to UK4, or none). Set `a2_certificate` if the pilot holds an A2 CofC and `date` to see the rules on a future date. The answer gives the subcategory, overflight and separation rules, registration (Flyer ID and Operator ID, 100 g threshold from 2026), Remote ID dates (UK1 to UK3 from 2026, camera aircraft of 100 g or more otherwise from 2028) and the transition under which EU C-class labels count as UK classes until the end of 2027. Rules and dates live in `src/services/drones/rules.ts` with the CAA pages they were taken from; the catalogue is community-maintained like the byelaw list, and an unconfirmed class mark is left null so the aircraft is treated as legacy.

### Maps

The hosted server serves the same map three ways: inline in Claude as an MCP App (Claude web, desktop and mobile render it with the answer; Claude Code shows the text only), as a standalone page at `GET /map`, and as the JSON behind it at `GET /api/view`. Every location tool on the hosted server returns a map link and the view descriptor the app needs; geometry only ever travels through `/api/view`, so tool results stay small.

<p align="center"><img src="docs/images/layers-key.webp" alt="Haytor on Dartmoor with the layers panel open: base map choice, airspace, on the ground, one row per ground hazard kind with icons and counts, and weather toggles" width="900"></p>

**Finding a place.** The search box takes a place name, a postcode or `lat, lon` and calls `GET /api/geocode?q=`, the same resolver the tools use: a confident match moves the map, an ambiguous name shows the candidates to pick from, and nothing is ever guessed. The locate button uses the browser's position. Tapping or clicking anywhere on the map checks that point, and a long press (right click on a desktop) lists everything drawn under the point, since a NOTAM or aerodrome zone often covers the whole view. Pan or zoom away and the overlays for the new area load on their own, while the chosen point, its weather and the URL stay put; the URL updates as you search, so it can be shared.

**Layers.** The layers button opens a panel with Map or Satellite base layers (Esri World Imagery with a place-name overlay; `basemap=satellite` opens in that view) and a toggle for every overlay, grouped into Airspace (each zone class and NOTAMs), On the ground (rights of way, landowner land, open access land, nature designations, parking, route, take-off spots), Ground hazards (one row per kind with its icon and count, and All or None shortcuts) and Weather. Prohibited and restricted areas, aerodrome FRZs and prison zones are always drawn and cannot be switched off. Choices are remembered per browser, and `ui=layers` or `ui=info` on the URL opens a panel for a shared link.

<p align="center"><img src="docs/images/severn.webp" alt="A wide view of the Severn crossings: motorway, railway and power line icons spaced along the lines, pylons, substations, a NOTAM circle and the wind flow" width="900"></p>

**Ground hazards.** Nineteen kinds from OpenStreetMap, each with its own icon in the style of a road sign: railways, motorways, trunk roads and bridges; power lines, minor lines, pylons, substations and generators; helipads, masts and military land; and the places people gather, schools, nurseries, hospitals, fire and fuel stations, parks and cemeteries. Line hazards carry their icon at intervals along the line, so a motorway reads as one at any zoom. A wide view keeps every line and the 600 nearest point hazards, so nothing you have toggled on goes missing as you pan.

**Weather.** Three toggles: Conditions now (the Open-Meteo flyability rating for the coming hour, including the wind at 120 m), Wind flow (animated streamlines over the visible map, coloured by the advisory thresholds, paused while you drag; a still frame when the browser prefers reduced motion) and Rain radar (the latest RainViewer frame, coarse at about 600 m per pixel on the free tier). The location card also carries a timeline: a pill per day for the coming week coloured by its best daylight rating with the count of good hours, and an hour strip for the chosen day; tap a day to jump to its first good hour and an hour to see its wind, gusts, 120 m wind, temperature and the reasons for its rating. `weather=0` on `/api/view` skips the forecast.

<table align="center"><tr>
<td><img src="docs/images/phone-empty.webp" alt="The map on a phone before a location is chosen: search, use my location, or tap the map" width="260"></td>
<td><img src="docs/images/phone.webp" alt="Durdle Door on a phone with the location sheet collapsed to its name and rating" width="260"></td>
<td><img src="docs/images/phone-sheet.webp" alt="The location sheet expanded on a phone: counts, the drone picker, conditions and the weather timeline" width="260"></td>
</tr></table>

**On a phone** the search bar spans the top, the location card is a collapsible sheet at the bottom, the layers panel opens as a sheet from the same button, pinch replaces the zoom buttons, and a page opened without a location invites a search, a tap or your position. Opening the worker's root URL in a browser lands on the map.

<p align="center"><img src="docs/images/giants-causeway.webp" alt="Giant's Causeway in Northern Ireland with the ASSI and AONB designations, hazards and parking" width="900"></p>

**Your drone.** The location card has a picker fed by `GET /api/drones` (the catalogue with each model's rules summary and a drawn silhouette). Choosing a model makes it the location marker and the key swatch, and shows its subcategory and overflight rule in the card. Add `drone=<catalogue id>` to the `/map` URL to preselect one; `check_takeoff_site` called with a `drone` does this for the MCP App. The silhouettes are original drawings, one per family (palm, mini, air, mavic, fpv, phantom), because manufacturer photographs are copyrighted.

`GET /api/wind?bbox=w,s,e,n&z=` serves the wind field (one Open-Meteo request per view, snapped to a fixed lattice of at most 64 points and cached per point).

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
| Northern Ireland designations | [ASSI](https://www.opendatani.gov.uk/dataset/areas-of-special-scientific-interest), [AONB](https://www.opendatani.gov.uk/dataset/areas-of-outstanding-natural-beauty) and [National Nature Reserves](https://www.opendatani.gov.uk/dataset/national-nature-reserves) from the Northern Ireland Environment Agency on OpenDataNI | With the pack | OGL v3, advisory only, see [licences/northern-ireland.md](licences/northern-ireland.md) |
| Forestry England land | [Forestry England Legal Boundary](https://data-forestry.opendata.arcgis.com/) | With the pack | OGL v3 with acknowledgement, see [licences/forestry-england.md](licences/forestry-england.md); byelaws need a permit for drones |
| Northern Ireland rights of way | Asserted public rights of way published by councils, so far [Mid Ulster](https://www.opendatani.gov.uk/dataset/mid-ulster-council-public-rights-of-way); there is no definitive map | Weekly | OGL v3 per council, see [licences/northern-ireland.md](licences/northern-ireland.md) |
| Scottish core paths | [Core Paths - Scotland, Improvement Service Spatial Hub](https://data.spatialhub.scot/dataset/core_paths-is) (needs a free account key, `SPATIALHUB_AUTHKEY`) | Weekly | OGL v3 per council, see [licences/improvement-service-core-paths.md](licences/improvement-service-core-paths.md) |
| Local authorities | [ONS Local Authority Districts (May 2026) BSC](https://geoportal.statistics.gov.uk/) | With the pack | OGL v3, see [licences/ONS.md](licences/ONS.md) |
| Ground hazards | OpenStreetMap via the Geofabrik Great Britain and Ireland extracts (the latter clipped to Northern Ireland): railways, motorways and trunk roads, bridges, power lines and minor lines, pylons, substations, generators, helipads, masts, military land, schools, nurseries, hospitals, fire and fuel stations, parks, cemeteries | Weekly | ODbL, see [licences/openstreetmap-ODbL.md](licences/openstreetmap-ODbL.md); advisory only |
| Parking and laybys | OpenStreetMap via the [Geofabrik Great Britain extract](https://download.geofabrik.de/europe/great-britain.html) plus the Ireland extract clipped to Northern Ireland (`amenity=parking`, `highway=rest_area`) | Weekly | ODbL |
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
| `OSM_PBF_URL`, `OSM_PBF_URL_IRELAND`, `NE_CROW_URL`, `NE_SSSI_URL`, `NE_NATIONAL_PARKS_URL`, `NRW_WFS_URL`, `FE_LEGAL_BOUNDARY_URL`, `ONS_LAD_URL`, `SPATIALHUB_WFS_URL` | (upstream defaults) | Build only: override a source endpoint when a publisher moves it; the `NRW_*_TYPENAME` and `SPATIALHUB_TYPENAME` variables do the same for WFS layer names |
| `SPATIALHUB_AUTHKEY` | (unset) | Build only: Spatial Hub account key for Scottish core paths; without it the pack has none |
| `NOMINATIM_URL` | `https://nominatim.openstreetmap.org/search` | Self-host to lift the 1 req/s limit |
| `POSTCODES_IO_URL` | `https://api.postcodes.io` | |
| `NOTAM_PIB_URL` | `https://pibs.nats.co.uk/operational/pibs/PIB.xml` | |
| `NOTAM_CACHE_TTL_SECONDS` | `1800` | |
| `OPEN_METEO_URL` | `https://api.open-meteo.com/v1/forecast` | |
| `WEATHER_CACHE_TTL_SECONDS` | `900` | |
| `GEOCODE_CACHE_TTL_SECONDS` | `2592000` | 30 days |
| `HTTP_TIMEOUT_MS` | `8000` | Live calls |
| `FPV_AIRSPACE_CACHE_DIR` | `~/.cache/fpv-airspace` | Pack and caches (`DRONE_AIRSPACE_CACHE_DIR` and an existing `~/.cache/uk-drone-airspace-mcp` are still honoured) |
| `PACK_MANIFEST_URL` | latest GitHub release manifest | Point at a mirror or `file://` |
| `PACK_PATH` | unset | Use a local pack and skip downloads |
| `PACK_UPDATE_CHECK` | `true` | Background check for a newer pack |
| `PACK_STALE_HOURS` | `24` | How often to check |
| `LOG_LEVEL` | `info` | `debug`, `info`, `warn`, `error`, `silent` |
| `MCP_TRANSPORT` / `--transport` | `stdio` | `stdio` or `http` |
| `PORT` / `--port` | `8080` | HTTP transport |

## Caveats

- Rights-of-way data is an interpretation of each council's Definitive Map, not the Definitive Map itself, and covers England and Wales. Scotland has no definitive map (access rights apply instead, and core paths need a Spatial Hub key) and Northern Ireland has no definitive map either: only councils that publish their asserted paths appear, so absence there means unknown; the tools say so.
- The landowner rule layer holds National Trust and Forestry England land and a hand-curated list of council byelaws and policies. The National Trust's open data omits its Northern Ireland properties. Absence of a rule never means take-off is permitted.
- Ground hazards and parking come from OpenStreetMap and are as complete as the map is; they are advisory and never change a verdict.
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
