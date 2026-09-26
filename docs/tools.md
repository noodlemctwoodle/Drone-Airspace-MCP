# Tools

The model-facing contract lives in `src/tools/definitions.ts`; this page is the human version. Back to the [README](../README.md).

Every tool accepts `format: "text"` (default, a plain-text report), `format: "json"` (the same data as structured JSON) or `format: "brief"` (two or three sentences written to be read aloud, for voice). Tools that take a location accept either `place` (name, postcode or landmark) or `lat` and `lon`. When a place name matches several places, the tool returns the candidates instead of guessing.

## `check_location`

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

## `get_aerodrome_zone`

| Argument | Type | Notes |
|---|---|---|
| `aerodrome` | string | Name or ICAO code, e.g. `Bristol` or `EGGD` |
| `include_geojson` | boolean | Include zone geometry |

Example prompt: *"Show me the Gatwick FRZ."*

## `check_notams`

| Argument | Type | Notes |
|---|---|---|
| `place` / `lat`+`lon` | | |
| `radius_km` | 0–50 | Also list NOTAMs whose circle comes within this distance. 0 = covering only |
| `date` | ISO 8601 | Defaults to now; the bulletin covers the next 7 days |
| `max_results` | 1–50 | |

Example prompt: *"Any NOTAMs over Durdle Door this Saturday?"*

## `check_route`

| Argument | Type | Notes |
|---|---|---|
| `waypoints` | array of `[lon, lat]` or place names | 2–50 points; routes over 500 km are rejected |
| `area` | `{ bbox: [w, s, e, n] }` or GeoJSON Polygon | Instead of waypoints |
| `include_above_120m` | boolean | |

Example prompt: *"Check a route from Clevedon to Portishead along the coast."*

## `check_takeoff_site`

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

## `find_parking`

| Argument | Type | Notes |
|---|---|---|
| `place` / `lat`+`lon` | | |
| `max_results` | 1–20 | Default 5 |
| `search_radius_m` | 100–10000 | Default 2000 |
| `include_private` | boolean | Also list private, customers-only and permit parking |

Example prompt: *"Where can I park near Durdle Door?"*

## `check_weather`

| Argument | Type | Notes |
|---|---|---|
| `place` / `lat`+`lon` | | |
| `date` | ISO 8601 | A bare date reports daylight hours; a date-time starts there. Defaults to now |
| `hours` | 1–24 | Hours to report from the start (default 6) |

Example prompt: *"Is it flyable at Ilkley Moor on Saturday afternoon?"*

Ratings are advisory: caution from 8 m/s, poor from 10.7 m/s sustained or 12 m/s gusts, any rain, visibility under 1.5 km, and a caution for freezing temperatures, low cloud or strong wind at 120 m.

The report also carries the NOAA planetary K-index (geomagnetic activity), which affects GPS accuracy and compass behaviour: quiet, unsettled, active (Kp 4) or storm (Kp 5 and above). It does not change the weather rating; the briefing tool treats a storm as caution.

## `preflight_briefing`

One report for a take-off point and time. `place` / `lat`+`lon`, `date` (default now), `hours` (window length, default 3), optional `drone` and `a2_certificate`, `frz_permission` when an aerodrome has already agreed the flight, `notam_radius_km` (default 10), `max_paths`. The status is deterministic: prohibited, prison or restricted airspace, an FRZ without permission, or a landowner ban is NO-GO; an FRZ with permission, a covering NOTAM, a danger area, poor weather, a geomagnetic storm, a physical ground hazard within 200 m, or any live source that could not be read is CAUTION; otherwise GO. Notes (marginal weather, nearby or unlocated NOTAMs, a school, hospital or park within 150 m, no right of way nearby, A3 separation) never change the status. The JSON carries each sub-result, the reasons and an `outages` list.

## `check_terrain`

Ground elevation against the 120 m rule. Give `waypoints` (2 to 50) for a profile, or a point with `radius_m` (default 500) for the ground around it; `flight_height_m` (default 120) is the planned height above take-off and `step_m` the sample spacing. Reports the highest and lowest ground relative to the take-off point and warns when the ground rises within 30 m of the flight height (caution) or above it (poor), or falls far enough that the flight would be more than 120 m above the surface. Elevations come from Copernicus GLO-90 via Open-Meteo at about 90 m resolution, so cliffs and buildings are not resolved.

## `find_takeoff_spots`

Candidate spots come from the nearest rights of way (the closest point of each plus samples every 250 m), public parking and open access land within `search_radius_m` (default 3 km), de-duplicated on a 50 m grid and capped at 60. Each is checked against the airspace and landowner layers: prohibited, restricted, prison and aerodrome zones and take-off bans exclude it; a covering NOTAM, a danger area, a landowner rule or a ground hazard within 200 m lower the score; being on a right of way, having parking within 300 m and open access land raise it; distance from the centre costs a little. Scores are integers with a reason per term, so the ordering is deterministic. `max_results` (default 3), optional `drone` and `a2_certificate` (a school, hospital, park or similar within 150 m costs a little, and a lot for A3 pilots). The JSON lists the spots and the excluded candidates grouped by reason. A right of way is a right to pass, not to stop and fly.

## `check_drone_rules`

Which UK open category rules apply to a consumer drone. Give `model` (looked up in the curated catalogue in `src/services/drones/catalogue.ts`: DJI, Autel, Potensic, HoverAir and Parrot models with take-off weight, EU C-class and UK class marks) or `weight_g` with an optional `class_mark` (C0 to C4, UK0 to UK4, or none). Set `a2_certificate` if the pilot holds an A2 CofC and `date` to see the rules on a future date. The answer gives the subcategory, overflight and separation rules, registration (Flyer ID and Operator ID, 100 g threshold from 2026), Remote ID dates (UK1 to UK3 from 2026, camera aircraft of 100 g or more otherwise from 2028) and the transition under which EU C-class labels count as UK classes until the end of 2027. Rules and dates live in `src/services/drones/rules.ts` with the CAA pages they were taken from; the catalogue is community-maintained like the byelaw list, and an unconfirmed class mark is left null so the aircraft is treated as legacy.


## `geocode`

| Argument | Type | Notes |
|---|---|---|
| `query` | string | |
| `limit` | 1–10 | |

## `get_data_status`

No arguments. Reports pack tag, AIRAC effective dates, per-source fetch dates and licences, NOTAM cache age, geocoding providers and every attribution string.
