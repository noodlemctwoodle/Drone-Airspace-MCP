# Configuration

Back to the [README](../README.md).

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
| `SUPPORT_URL` | unset | One-off donation link shown in the map credits and the worker's landing JSON; empty hides it |
| `SUPPORT_MONTHLY_URL` | unset | Recurring donation link shown beside it |
| `STRIPE_SECRET_KEY` | unset | Enables embedded Stripe Checkout on the map through `POST /api/donate`; keep it a secret (`wrangler secret put`), never a var |
| `STRIPE_PUBLISHABLE_KEY` | unset | Publishable key the map passes to Stripe.js; safe to commit |
| `STRIPE_PRICE_ONCE` | unset | Price id for the one-off donation (customer chooses the amount) |
| `STRIPE_PRICE_MONTHLY` | unset | Price id for the monthly donation, £1 per unit with an adjustable quantity |
| `PACK_MANIFEST_URL` | latest GitHub release manifest | Point at a mirror or `file://` |
| `PACK_PATH` | unset | Use a local pack and skip downloads |
| `PACK_UPDATE_CHECK` | `true` | Background check for a newer pack |
| `PACK_STALE_HOURS` | `24` | How often to check |
| `LOG_LEVEL` | `info` | `debug`, `info`, `warn`, `error`, `silent` |
| `MCP_TRANSPORT` / `--transport` | `stdio` | `stdio` or `http` |
| `PORT` / `--port` | `8080` | HTTP transport |
