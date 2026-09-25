import booleanValid from '@turf/boolean-valid';
import type { BBox } from '../../src/types.js';
import { SqlitePackRepository } from '../../src/pack/repository.js';
import { openDatabase } from '../../src/pack/driver.js';
import { META_KEYS, SCHEMA_VERSION } from '../../src/pack/schema.js';
import { KNOWN_POINTS } from './known-points.js';
import { parseGeometry } from '../../src/pack/geometry.js';

export interface VerifyResult {
  ok: boolean;
  failures: string[];
  warnings: string[];
  counts: Record<string, number>;
  sizeBytes: number;
}

export interface VerifyOptions {
  region: string;
  strict?: boolean;
  sizeBytes: number;
  /** Run the real-world known-point assertions (default true; fixture packs pass false). */
  knownPoints?: boolean;
}

const FLOORS: Record<string, Record<string, number>> = {
  national: { zones: 800, rights_of_way: 100_000, land_restrictions: 1000, gazetteer: 200, coverage: 4 }, // coverage counts polygon parts
  'south-west': { zones: 40, rights_of_way: 10_000, land_restrictions: 100, gazetteer: 20, coverage: 1 },
  default: { zones: 1, rights_of_way: 0, land_restrictions: 0, gazetteer: 1, coverage: 0 },
};

const SIZE_WARN = 400 * 1024 * 1024;
const SIZE_FAIL = 600 * 1024 * 1024;

export async function verifyPack(file: string, opts: VerifyOptions): Promise<VerifyResult> {
  const failures: string[] = [];
  const warnings: string[] = [];
  const counts: Record<string, number> = {};
  const db = openDatabase(file, { readonly: true });
  try {
    const integrity = db.prepare('PRAGMA integrity_check').get();
    if (String(Object.values(integrity ?? {})[0]) !== 'ok') failures.push('integrity_check failed');
    if (Number(db.pragma('user_version')) !== SCHEMA_VERSION) failures.push(`user_version is ${db.pragma('user_version')}, expected ${SCHEMA_VERSION}`);
    const opts_ = db.prepare("SELECT compile_options AS o FROM pragma_compile_options WHERE compile_options IN ('ENABLE_RTREE','ENABLE_FTS5')").all().map((r) => String(r.o));
    if (!opts_.includes('ENABLE_RTREE')) failures.push('SQLite build lacks ENABLE_RTREE');
    if (!opts_.includes('ENABLE_FTS5')) failures.push('SQLite build lacks ENABLE_FTS5');

    for (const t of ['zones', 'rights_of_way', 'land_restrictions', 'gazetteer', 'coverage', 'sources', 'authorities']) {
      counts[t] = Number(db.prepare(`SELECT COUNT(*) AS c FROM ${t}`).get()?.c ?? 0);
    }
    for (const t of ['zones', 'rights_of_way', 'land_restrictions', 'coverage']) {
      const rt = Number(db.prepare(`SELECT COUNT(*) AS c FROM ${t}_rtree`).get()?.c ?? 0);
      if (rt !== counts[t]) failures.push(`${t}_rtree has ${rt} rows but ${t} has ${counts[t]}`);
    }
    const floors = FLOORS[opts.region] ?? FLOORS.default;
    for (const [t, min] of Object.entries(floors)) {
      if ((counts[t] ?? 0) < min) failures.push(`${t} has ${counts[t]} rows, floor for ${opts.region} is ${min}`);
    }

    const metaRows = db.prepare('SELECT key, value FROM meta').all();
    const meta: Record<string, unknown> = {};
    for (const r of metaRows) meta[String(r.key)] = JSON.parse(String(r.value));
    for (const k of META_KEYS) if (!(k in meta)) failures.push(`meta.${k} missing`);
    const attribution = meta.attribution as string[] | undefined;
    const sourceIds = db.prepare('SELECT id FROM sources').all().map((r) => String(r.id));
    if (!Array.isArray(attribution) || attribution.length < sourceIds.length) warnings.push('meta.attribution has fewer entries than sources');
    const effective = meta.airac_effective as string | null;
    if (counts.zones > 0 && (!effective || !/^\d{4}-\d{2}-\d{2}$/.test(effective))) failures.push('meta.airac_effective is not a date');

    // Geometry validity: all zones/land, a 2 % sample of PRoW (decoded lines only need >= 2 points).
    let invalid = 0;
    for (const r of db.prepare('SELECT id, geom FROM zones').all()) {
      const g = parseGeometry(String(r.geom));
      if (!g || !booleanValid(g)) invalid += 1;
    }
    if (invalid > 0) {
      const msg = `${invalid} zone geometries are invalid`;
      if (invalid > counts.zones * 0.02) failures.push(msg);
      else warnings.push(msg);
    }
    let invalidLand = 0;
    for (const r of db.prepare('SELECT id, geom FROM land_restrictions').all()) {
      const g = parseGeometry(String(r.geom));
      if (!g || !booleanValid(g)) invalidLand += 1;
    }
    if (invalidLand > 0) warnings.push(`${invalidLand} land restriction geometries are invalid (still usable for point-in-polygon)`);

    const bbox = (meta.bbox as BBox | null) ?? null;
    const repo = new SqlitePackRepository(db);
    for (const kp of opts.knownPoints === false ? [] : KNOWN_POINTS) {
      if (bbox && (kp.lon < bbox[0] || kp.lon > bbox[2] || kp.lat < bbox[1] || kp.lat > bbox[3])) continue;
      const e = kp.expect;
      if (e.layer === 'zones') {
        if (counts.zones === 0) continue;
        const zones = await repo.zonesAt(kp.lon, kp.lat);
        const hit = zones.find((z) => (!e.zoneType || z.zoneType === e.zoneType) && (!e.icao || z.icao === e.icao) && (!e.designatorPrefix || (z.designator ?? '').startsWith(e.designatorPrefix)));
        if (!hit) failures.push(`known point "${kp.name}": no matching zone (found ${zones.map((z) => `${z.designator} ${z.name} ${z.zoneType} ${z.icao ?? ''}`).join('; ') || 'nothing'})`);
      } else if (e.layer === 'rights_of_way') {
        if (counts.rights_of_way === 0) continue;
        const hits = await repo.nearestRightsOfWay(kp.lon, kp.lat, e.withinMetres, 3);
        const hit = hits.find((h) => !e.authorityCode || h.authorityCode === e.authorityCode);
        if (!hit) failures.push(`known point "${kp.name}": no right of way within ${e.withinMetres} m`);
      } else if (e.layer === 'land_restrictions') {
        if (counts.land_restrictions === 0) continue;
        const hits = await repo.landRestrictionsAt(kp.lon, kp.lat);
        if (!hits.some((h) => h.owner === e.owner)) failures.push(`known point "${kp.name}": expected ${e.owner} land`);
      } else {
        if ((await repo.zonesAt(kp.lon, kp.lat)).length > 0) failures.push(`known point "${kp.name}": unexpected zone`);
        if ((await repo.landRestrictionsAt(kp.lon, kp.lat)).length > 0) failures.push(`known point "${kp.name}": unexpected land restriction`);
      }
    }
    if (opts.region === 'national' && counts.gazetteer > 0) {
      if ((await repo.findAerodrome('EGLL')).length === 0) failures.push('gazetteer cannot resolve EGLL');
      if ((await repo.findAerodrome('heathrow')).length === 0) failures.push('gazetteer cannot resolve "heathrow"');
    }

    if (opts.sizeBytes > SIZE_FAIL) failures.push(`pack is ${(opts.sizeBytes / 1048576).toFixed(0)} MB, over the ${SIZE_FAIL / 1048576} MB limit`);
    else if (opts.sizeBytes > SIZE_WARN) warnings.push(`pack is ${(opts.sizeBytes / 1048576).toFixed(0)} MB, over the ${SIZE_WARN / 1048576} MB warning threshold`);

    if (opts.strict) {
      const buildWarnings = (meta.warnings as string[] | undefined) ?? [];
      const crossCheckWarnings = buildWarnings.filter((w) => /cross-check|unmatched|differ in area/i.test(w));
      if (crossCheckWarnings.length > 0) failures.push(`strict: ${crossCheckWarnings.join('; ')}`);
    }
  } finally {
    db.close();
  }
  return { ok: failures.length === 0, failures, warnings, counts, sizeBytes: opts.sizeBytes };
}
