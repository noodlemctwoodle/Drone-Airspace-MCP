/**
 * Data pack schema. Shared by the build pipeline (writer) and the server (reader).
 * Bump SCHEMA_VERSION on any incompatible change; the loader refuses packs whose
 * `PRAGMA user_version` does not match.
 */
export const SCHEMA_VERSION = 5;
export const APPLICATION_ID = 0x44524e41; // 'DRNA'

export const ZONE_TYPES = ['frz', 'prohibited', 'restricted', 'danger', 'other', 'prison'] as const;
export const PATH_TYPES = ['footpath', 'bridleway', 'restricted_byway', 'boat', 'core_path'] as const;
export const RESTRICTION_KINDS = ['landowner', 'byelaw', 'pspo', 'policy', 'access_land', 'designation'] as const;
export const RESTRICTION_SCOPES = ['site', 'authority'] as const;
export const HAZARD_KINDS = [
  'railway', 'motorway', 'trunk_road', 'bridge',
  'power_line', 'minor_power_line', 'pylon', 'substation', 'power_generator',
  'helipad', 'tower', 'military',
  'school', 'kindergarten', 'hospital', 'fire_station', 'fuel_station', 'park', 'cemetery',
] as const;
export const ADMIN_KINDS = ['lad'] as const;
export const COUNTRIES = ['england', 'wales', 'scotland', 'northern_ireland'] as const;
export const PARKING_KINDS = ['car_park', 'layby', 'rest_area', 'street_side'] as const;

export const SOURCE_IDS = {
  nats: 'nats_uas',
  rowmaps: 'rowmaps',
  ntAlwaysOpen: 'nt_always_open',
  ntLimitedAccess: 'nt_limited_access',
  byelaws: 'byelaws',
  countries: 'ons_countries',
  parking: 'osm_parking',
  hazards: 'osm_hazards',
  neCrowAccess: 'ne_crow_access',
  neSssi: 'ne_sssi',
  neNationalParks: 'ne_national_parks',
  nrwOpenCountry: 'nrw_open_country',
  nrwCommonLand: 'nrw_common_land',
  nrwSssi: 'nrw_sssi',
  nrwNationalParks: 'nrw_national_parks',
  forestryEngland: 'fe_legal_boundary',
  corePaths: 'is_core_paths',
  nieaAssi: 'niea_assi',
  nieaAonb: 'niea_aonb',
  nieaNnr: 'niea_nnr',
  niProw: 'ni_prow',
  lad: 'ons_lad',
} as const;

const list = (values: readonly string[]) => values.map((v) => `'${v}'`).join(',');

export const DDL: string[] = [
  `CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)`,
  `CREATE TABLE sources (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    url TEXT NOT NULL,
    licence TEXT NOT NULL,
    attribution TEXT NOT NULL,
    fetched_at TEXT NOT NULL,
    effective_from TEXT,
    effective_to TEXT,
    version TEXT,
    feature_count INTEGER NOT NULL,
    notes TEXT
  )`,
  `CREATE TABLE zones (
    id INTEGER PRIMARY KEY,
    source_id TEXT NOT NULL REFERENCES sources(id),
    aixm_id TEXT,
    designator TEXT,
    name TEXT NOT NULL,
    zone_type TEXT NOT NULL CHECK (zone_type IN (${list(ZONE_TYPES)})),
    raw_type TEXT,
    icao TEXT,
    aerodrome_name TEXT,
    lower_ft INTEGER, lower_ref TEXT, lower_raw TEXT,
    upper_ft INTEGER, upper_ref TEXT, upper_raw TEXT,
    activation TEXT,
    contact TEXT,
    notes TEXT,
    valid_from TEXT, valid_to TEXT,
    centroid_lon REAL NOT NULL, centroid_lat REAL NOT NULL,
    min_lon REAL NOT NULL, max_lon REAL NOT NULL, min_lat REAL NOT NULL, max_lat REAL NOT NULL,
    geom TEXT NOT NULL
  )`,
  `CREATE VIRTUAL TABLE zones_rtree USING rtree(id, min_lon, max_lon, min_lat, max_lat)`,
  `CREATE INDEX zones_designator ON zones(designator)`,
  `CREATE INDEX zones_icao ON zones(icao)`,
  `CREATE INDEX zones_type ON zones(zone_type)`,
  `CREATE TABLE authorities (
    code TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    country TEXT NOT NULL CHECK (country IN ('england','wales','scotland','northern_ireland')),
    attribution TEXT NOT NULL,
    fetched_at TEXT,
    feature_count INTEGER
  )`,
  `CREATE TABLE rights_of_way (
    id INTEGER PRIMARY KEY,
    authority_code TEXT NOT NULL REFERENCES authorities(code),
    source_ref TEXT,
    path_type TEXT NOT NULL CHECK (path_type IN (${list(PATH_TYPES)})),
    route_no TEXT, route_name TEXT, parish TEXT,
    length_m INTEGER NOT NULL,
    min_lon REAL NOT NULL, max_lon REAL NOT NULL, min_lat REAL NOT NULL, max_lat REAL NOT NULL,
    geom_fmt TEXT NOT NULL DEFAULT 'polyline6',
    geom TEXT NOT NULL
  )`,
  `CREATE VIRTUAL TABLE rights_of_way_rtree USING rtree(id, min_lon, max_lon, min_lat, max_lat)`,
  `CREATE INDEX row_authority ON rights_of_way(authority_code)`,
  `CREATE TABLE land_restrictions (
    id INTEGER PRIMARY KEY,
    source_id TEXT NOT NULL REFERENCES sources(id),
    entry_id TEXT,
    kind TEXT NOT NULL CHECK (kind IN (${list(RESTRICTION_KINDS)})),
    owner TEXT NOT NULL,
    name TEXT NOT NULL,
    access_class TEXT,
    takeoff_banned INTEGER NOT NULL,
    landing_banned INTEGER,
    summary TEXT,
    source_url TEXT,
    last_verified TEXT,
    props TEXT,
    scope TEXT NOT NULL DEFAULT 'site' CHECK (scope IN (${list(RESTRICTION_SCOPES)})),
    min_lon REAL NOT NULL, max_lon REAL NOT NULL, min_lat REAL NOT NULL, max_lat REAL NOT NULL,
    geom TEXT NOT NULL
  )`,
  `CREATE VIRTUAL TABLE land_restrictions_rtree USING rtree(id, min_lon, max_lon, min_lat, max_lat)`,
  `CREATE INDEX land_kind ON land_restrictions(kind)`,
  `CREATE TABLE coverage (
    id INTEGER PRIMARY KEY,
    country TEXT NOT NULL CHECK (country IN (${list(COUNTRIES)})),
    min_lon REAL NOT NULL, max_lon REAL NOT NULL, min_lat REAL NOT NULL, max_lat REAL NOT NULL,
    geom TEXT NOT NULL
  )`,
  `CREATE VIRTUAL TABLE coverage_rtree USING rtree(id, min_lon, max_lon, min_lat, max_lat)`,
  `CREATE TABLE parking (
    id INTEGER PRIMARY KEY,
    osm_id TEXT,
    kind TEXT NOT NULL CHECK (kind IN (${list(PARKING_KINDS)})),
    name TEXT,
    access TEXT,
    fee TEXT,
    capacity INTEGER,
    surface TEXT,
    operator TEXT,
    lon REAL NOT NULL, lat REAL NOT NULL,
    min_lon REAL NOT NULL, max_lon REAL NOT NULL, min_lat REAL NOT NULL, max_lat REAL NOT NULL
  )`,
  `CREATE VIRTUAL TABLE parking_rtree USING rtree(id, min_lon, max_lon, min_lat, max_lat)`,
  `CREATE INDEX parking_kind ON parking(kind)`,
  `CREATE TABLE hazards (
    id INTEGER PRIMARY KEY,
    source_id TEXT NOT NULL REFERENCES sources(id),
    osm_id TEXT,
    kind TEXT NOT NULL CHECK (kind IN (${list(HAZARD_KINDS)})),
    name TEXT,
    operator TEXT,
    ref TEXT,
    geom_fmt TEXT NOT NULL CHECK (geom_fmt IN ('geojson','polyline6')),
    lon REAL NOT NULL, lat REAL NOT NULL,
    min_lon REAL NOT NULL, max_lon REAL NOT NULL, min_lat REAL NOT NULL, max_lat REAL NOT NULL,
    geom TEXT NOT NULL
  )`,
  `CREATE VIRTUAL TABLE hazards_rtree USING rtree(id, min_lon, max_lon, min_lat, max_lat)`,
  `CREATE INDEX hazards_kind ON hazards(kind)`,
  `CREATE TABLE admin_areas (
    id INTEGER PRIMARY KEY,
    code TEXT NOT NULL,
    name TEXT NOT NULL,
    kind TEXT NOT NULL CHECK (kind IN (${list(ADMIN_KINDS)})),
    country TEXT CHECK (country IN (${list(COUNTRIES)})),
    min_lon REAL NOT NULL, max_lon REAL NOT NULL, min_lat REAL NOT NULL, max_lat REAL NOT NULL,
    geom TEXT NOT NULL
  )`,
  `CREATE VIRTUAL TABLE admin_areas_rtree USING rtree(id, min_lon, max_lon, min_lat, max_lat)`,
  `CREATE INDEX admin_code ON admin_areas(code)`,
  `CREATE TABLE gazetteer (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    icao TEXT,
    kind TEXT NOT NULL CHECK (kind IN ('aerodrome','zone')),
    lon REAL NOT NULL, lat REAL NOT NULL,
    zone_id INTEGER REFERENCES zones(id),
    aliases TEXT
  )`,
  `CREATE INDEX gazetteer_icao ON gazetteer(icao)`,
  `CREATE VIRTUAL TABLE gazetteer_fts USING fts5(name, aliases, content='gazetteer', content_rowid='id', tokenize='unicode61')`,
];

/** Tables that carry a bbox and a companion `<table>_rtree`; used to rebuild rtrees after a D1 import. */
export const SPATIAL_TABLES = ['zones', 'rights_of_way', 'land_restrictions', 'coverage', 'parking', 'hazards', 'admin_areas'] as const;

export const META_KEYS = [
  'schema_version',
  'pack_tag',
  'built_at',
  'build_commit',
  'region',
  'bbox',
  'airac_effective',
  'airac_next',
  'counts',
  'attribution',
  'licences',
  'warnings',
] as const;

export type MetaKey = (typeof META_KEYS)[number];
