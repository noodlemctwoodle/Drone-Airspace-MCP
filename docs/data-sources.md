# Data sources and attribution

Back to the [README](../README.md).

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
