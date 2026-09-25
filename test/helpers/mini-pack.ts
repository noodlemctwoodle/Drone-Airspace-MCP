import { readFileSync } from 'node:fs';
import path from 'node:path';
import { createPackDb, finaliseDb } from '../../pipeline/assemble/create-db.js';
import { insertAdminAreas, insertAuthority, insertCoverage, insertHazards, insertLandRestrictions, insertMeta, insertParking, insertRightsOfWay, insertSource, insertZones } from '../../pipeline/assemble/insert.js';
import { buildGazetteer } from '../../pipeline/assemble/gazetteer.js';
import { parseAixmAirspaces } from '../../pipeline/sources/nats/aixm-parser.js';
import { parseRowmapsGeojson } from '../../pipeline/sources/rowmaps/geojson-parser.js';
import { loadByelaws } from '../../pipeline/sources/byelaws/loader.js';
import { parseCountries } from '../../pipeline/sources/countries/ons.js';
import { normaliseNtFeature } from '../../pipeline/sources/nt/arcgis.js';
import { parseLads } from '../../pipeline/sources/lad/ons.js';
import { normaliseCrowFeature, normaliseNationalParkFeature, normaliseSssiFeature } from '../../pipeline/sources/access/natural-england.js';
import { normaliseForestryFeature } from '../../pipeline/sources/forestry/legal-boundary.js';
import { SCHEMA_VERSION } from '../../src/pack/schema.js';

const fx = (p: string) => new URL(`../fixtures/${p}`, import.meta.url);

/** Assemble a small but real pack from the test fixtures. */
export async function buildMiniPack(dir: string): Promise<string> {
  const file = path.join(dir, 'mini.sqlite');
  const db = await createPackDb(file);
  const now = '2026-09-25T06:00:00Z';
  const src = (id: string, name: string, extra: Partial<{ effectiveFrom: string; version: string }> = {}) => ({
    id, name, url: 'https://example.test', licence: 'OGL-3.0', attribution: `${name} attribution`, fetchedAt: now,
    effectiveFrom: extra.effectiveFrom ?? null, effectiveTo: null, version: extra.version ?? null, featureCount: 0, notes: null,
  });
  insertSource(db, src('nats_uas', 'NATS test', { effectiveFrom: '2026-09-03', version: '20260903' }));
  insertSource(db, src('rowmaps', 'rowmaps test'));
  insertSource(db, src('nt_always_open', 'NT test'));
  insertSource(db, src('byelaws', 'byelaws test'));
  insertSource(db, src('ons_countries', 'ONS test'));
  insertSource(db, src('osm_hazards', 'OSM hazards test'));
  insertSource(db, src('ons_lad', 'ONS LAD test'));
  for (const id of ['ne_crow_access', 'ne_sssi', 'ne_national_parks', 'fe_legal_boundary']) insertSource(db, src(id, `${id} test`));

  const zones = parseAixmAirspaces(readFileSync(fx('aixm/mini-uas.xml'), 'utf8')).zones;
  const nZones = await insertZones(db, 'nats_uas', zones);
  insertAuthority(db, { code: 'BD', name: 'Barking and Dagenham', country: 'england', attribution: 'BD attribution', fetchedAt: now, featureCount: 5 });
  const paths = parseRowmapsGeojson(JSON.parse(readFileSync(fx('rowmaps/BD-mutated1.json'), 'utf8')), 'BD', 'footpath').paths;
  const nPaths = await insertRightsOfWay(db, paths);
  const nt = JSON.parse(readFileSync(fx('nt/page-1.json'), 'utf8')).features.map((f: never) => normaliseNtFeature(f, 'nt_always_open', 'always_open', 'x', now)!);
  const lads = parseLads(JSON.parse(readFileSync(fx('lad/lad-thin.geojson'), 'utf8')));
  const byelaws = (await loadByelaws(fx('byelaws/seed.yaml').pathname, (code) => lads.find((a) => a.code === code)?.geometry)).restrictions;
  const access = [
    ...JSON.parse(readFileSync(fx('access/crow-page-1.json'), 'utf8')).features.map((f: never) => normaliseCrowFeature(f, now)!),
    ...JSON.parse(readFileSync(fx('access/sssi-page-1.json'), 'utf8')).features.map((f: never) => normaliseSssiFeature(f, now)!),
    ...JSON.parse(readFileSync(fx('access/national-parks.json'), 'utf8')).features.map((f: never) => normaliseNationalParkFeature(f, now)!),
    ...JSON.parse(readFileSync(fx('forestry/page-1.json'), 'utf8')).features.map((f: never) => normaliseForestryFeature(f, now)!),
  ];
  const nLand = await insertLandRestrictions(db, [...nt, ...byelaws, ...access]);
  const nCov = insertCoverage(db, parseCountries(JSON.parse(readFileSync(fx('countries/countries-thin.geojson'), 'utf8'))));
  const nParking = await insertParking(db, [
    { osmId: 'w1', kind: 'car_park', name: 'Durdle Door Car Park', access: null, fee: 'yes', capacity: 400, surface: null, operator: null, lon: -2.2765, lat: 50.6227 },
    { osmId: 'w2', kind: 'car_park', name: 'Private Yard', access: 'private', fee: null, capacity: null, surface: null, operator: null, lon: -2.2768, lat: 50.6225 },
  ]);
  const nHazards = await insertHazards(db, 'osm_hazards', [
    { osmId: 'w10', kind: 'railway', name: 'Test Line', operator: 'Network Rail', ref: null, geometry: { type: 'LineString', coordinates: [[-2.29, 50.6265], [-2.264, 50.6265]] } },
    { osmId: 'n11', kind: 'helipad', name: 'Test helipad', operator: null, ref: null, geometry: { type: 'Point', coordinates: [-2.25, 50.63] } },
    { osmId: 'w12', kind: 'military', name: 'Lulworth Ranges', operator: 'MOD', ref: null, geometry: { type: 'Polygon', coordinates: [[[-2.25, 50.62], [-2.2, 50.62], [-2.2, 50.65], [-2.25, 50.65], [-2.25, 50.62]]] } },
  ]);
  const nAdmin = await insertAdminAreas(db, lads);
  const nGaz = buildGazetteer(db);
  insertMeta(db, {
    schema_version: SCHEMA_VERSION, pack_tag: 'pack-20260903-test', built_at: now, build_commit: 'test', region: 'test',
    bbox: [-8.7, 49.8, 1.9, 60.9], airac_effective: '2026-09-03', airac_next: '2026-10-01',
    counts: { zones: nZones, rights_of_way: nPaths, land_restrictions: nLand, coverage: nCov, gazetteer: nGaz, parking: nParking, hazards: nHazards, admin_areas: nAdmin },
    attribution: ['a', 'b', 'c', 'd', 'e'], licences: {}, warnings: [],
  });
  finaliseDb(db);
  db.close();
  return file;
}

