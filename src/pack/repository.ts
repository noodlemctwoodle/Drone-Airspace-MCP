import booleanPointInPolygon from '@turf/boolean-point-in-polygon';
import booleanIntersects from '@turf/boolean-intersects';
import bboxPolygon from '@turf/bbox-polygon';
import { lineString, point } from '@turf/helpers';
import pointToLineDistance from '@turf/point-to-line-distance';
import nearestPointOnLine from '@turf/nearest-point-on-line';
import type {
  BBox,
  GazetteerHit,
  LandRestriction,
  LineString,
  PackMeta,
  PackSource,
  Position,
  ProwCoverage,
  RightOfWay,
  RightOfWayHit,
  Zone,
  ZoneType,
} from '../types.js';
import { openDatabase, type Row, type SqliteDriver } from './driver.js';
import { PackIncompatibleError } from '../core/errors.js';
import { SCHEMA_VERSION } from './schema.js';
import { LruCache, bboxOfGeometry, decodeLine, metresToDegrees, parseGeometry } from './geometry.js';

export interface ZonesAtOptions {
  types?: ZoneType[];
}

/**
 * Everything the tools need from the data pack. `FakePackRepository` in the
 * tests implements the same interface over fixtures.
 */
export interface PackRepository {
  meta(): PackMeta;
  zonesAt(lon: number, lat: number, opts?: ZonesAtOptions): Zone[];
  zonesInBbox(bbox: BBox): Zone[];
  zonesAlongLine(line: LineString): Zone[];
  zoneById(id: number): Zone | undefined;
  nearestRightsOfWay(lon: number, lat: number, limitMetres?: number, n?: number): RightOfWayHit[];
  prowCoverageAt(lon: number, lat: number): ProwCoverage;
  landRestrictionsAt(lon: number, lat: number): LandRestriction[];
  findAerodrome(nameOrIcao: string, n?: number): GazetteerHit[];
  /** Every zone component (FRZ circle plus runway protection zones) for an aerodrome name. */
  zonesByAerodrome(aerodromeName: string): Zone[];
  close(): void;
}

const ROW_CANDIDATE_CAP = 2000;

function str(v: unknown): string | null {
  return v === null || v === undefined ? null : String(v);
}
function num(v: unknown): number | null {
  return v === null || v === undefined ? null : Number(v);
}

function zoneFromRow(row: Row, withGeometry: boolean): Zone {
  const geometry = withGeometry ? parseGeometry(String(row.geom)) : undefined;
  return {
    id: Number(row.id),
    sourceId: String(row.source_id),
    designator: str(row.designator),
    name: String(row.name),
    zoneType: String(row.zone_type) as ZoneType,
    rawType: str(row.raw_type),
    icao: str(row.icao),
    aerodromeName: str(row.aerodrome_name),
    lower: { ft: num(row.lower_ft), ref: str(row.lower_ref) as Zone['lower']['ref'], raw: str(row.lower_raw) },
    upper: { ft: num(row.upper_ft), ref: str(row.upper_ref) as Zone['upper']['ref'], raw: str(row.upper_raw) },
    activation: str(row.activation),
    contact: str(row.contact),
    notes: str(row.notes),
    validFrom: str(row.valid_from),
    validTo: str(row.valid_to),
    centroid: [Number(row.centroid_lon), Number(row.centroid_lat)],
    geometry: geometry ?? { type: 'Polygon', coordinates: [] },
  };
}

export class SqlitePackRepository implements PackRepository {
  private readonly db: SqliteDriver;
  private readonly geomCache = new LruCache<string, Zone['geometry']>(500);
  private metaCache: PackMeta | undefined;

  constructor(pathOrDriver: string | SqliteDriver) {
    this.db = typeof pathOrDriver === 'string' ? openDatabase(pathOrDriver, { readonly: true }) : pathOrDriver;
    const version = Number(this.db.pragma('user_version') ?? 0);
    if (version !== SCHEMA_VERSION) {
      this.db.close();
      throw new PackIncompatibleError(version, SCHEMA_VERSION);
    }
    try {
      this.db.exec('PRAGMA query_only = 1');
    } catch {
      // read-only connections already enforce this
    }
  }

  get path(): string {
    return this.db.path;
  }

  meta(): PackMeta {
    if (this.metaCache) return this.metaCache;
    const rows = this.db.prepare('SELECT key, value FROM meta').all();
    const kv: Record<string, unknown> = {};
    for (const r of rows) {
      try {
        kv[String(r.key)] = JSON.parse(String(r.value));
      } catch {
        kv[String(r.key)] = String(r.value);
      }
    }
    const sources: PackSource[] = this.db
      .prepare('SELECT * FROM sources ORDER BY id')
      .all()
      .map((r) => ({
        id: String(r.id),
        name: String(r.name),
        url: String(r.url),
        licence: String(r.licence),
        attribution: String(r.attribution),
        fetchedAt: String(r.fetched_at),
        effectiveFrom: str(r.effective_from),
        effectiveTo: str(r.effective_to),
        version: str(r.version),
        featureCount: Number(r.feature_count),
        notes: str(r.notes),
      }));
    const asStringArray = (v: unknown): string[] => (Array.isArray(v) ? v.map(String) : []);
    this.metaCache = {
      schemaVersion: Number(kv.schema_version ?? SCHEMA_VERSION),
      packTag: String(kv.pack_tag ?? 'unknown'),
      builtAt: String(kv.built_at ?? ''),
      buildCommit: kv.build_commit ? String(kv.build_commit) : null,
      region: String(kv.region ?? 'unknown'),
      bbox: Array.isArray(kv.bbox) && kv.bbox.length === 4 ? (kv.bbox.map(Number) as BBox) : null,
      airacEffective: kv.airac_effective ? String(kv.airac_effective) : null,
      airacNext: kv.airac_next ? String(kv.airac_next) : null,
      counts: (kv.counts as Record<string, number>) ?? {},
      attribution: asStringArray(kv.attribution),
      licences: (kv.licences as Record<string, string>) ?? {},
      warnings: asStringArray(kv.warnings),
      sources,
    };
    return this.metaCache;
  }

  private zoneGeometry(row: Row): Zone['geometry'] {
    const key = `zone:${row.id}`;
    const cached = this.geomCache.get(key);
    if (cached) return cached;
    const geom = parseGeometry(String(row.geom)) ?? { type: 'Polygon', coordinates: [] };
    this.geomCache.set(key, geom);
    return geom;
  }

  private zonesInBox(bbox: BBox): Row[] {
    return this.db
      .prepare(
        `SELECT z.* FROM zones_rtree r JOIN zones z ON z.id = r.id
         WHERE r.min_lon <= ? AND r.max_lon >= ? AND r.min_lat <= ? AND r.max_lat >= ?`
      )
      .all(bbox[2], bbox[0], bbox[3], bbox[1]);
  }

  zonesAt(lon: number, lat: number, opts: ZonesAtOptions = {}): Zone[] {
    const pt = point([lon, lat]);
    const out: Zone[] = [];
    for (const row of this.zonesInBox([lon, lat, lon, lat])) {
      const zone = zoneFromRow(row, false);
      if (opts.types && !opts.types.includes(zone.zoneType)) continue;
      const geometry = this.zoneGeometry(row);
      if (geometry.coordinates.length === 0) continue;
      if (booleanPointInPolygon(pt, geometry)) {
        out.push({ ...zone, geometry });
      }
    }
    return out;
  }

  zonesInBbox(bbox: BBox): Zone[] {
    const poly = bboxPolygon(bbox);
    const out: Zone[] = [];
    for (const row of this.zonesInBox(bbox)) {
      const geometry = this.zoneGeometry(row);
      if (geometry.coordinates.length === 0) continue;
      if (booleanIntersects(poly, geometry)) {
        out.push({ ...zoneFromRow(row, false), geometry });
      }
    }
    return out;
  }

  zonesAlongLine(line: LineString): Zone[] {
    const bbox = bboxOfGeometry(line);
    const feature = lineString(line.coordinates);
    const out: Zone[] = [];
    for (const row of this.zonesInBox(bbox)) {
      const geometry = this.zoneGeometry(row);
      if (geometry.coordinates.length === 0) continue;
      if (booleanIntersects(feature, geometry)) {
        out.push({ ...zoneFromRow(row, false), geometry });
      }
    }
    return out;
  }

  zoneById(id: number): Zone | undefined {
    const row = this.db.prepare('SELECT * FROM zones WHERE id = ?').get(id);
    if (!row) return undefined;
    return { ...zoneFromRow(row, false), geometry: this.zoneGeometry(row) };
  }

  nearestRightsOfWay(lon: number, lat: number, limitMetres = 500, n = 5): RightOfWayHit[] {
    const { dLat, dLon } = metresToDegrees(limitMetres, lat);
    const rows = this.db
      .prepare(
        `SELECT p.*, a.name AS authority_name, a.attribution AS attribution
         FROM rights_of_way_rtree r
         JOIN rights_of_way p ON p.id = r.id
         JOIN authorities a ON a.code = p.authority_code
         WHERE r.min_lon <= ? AND r.max_lon >= ? AND r.min_lat <= ? AND r.max_lat >= ?
         LIMIT ?`
      )
      .all(lon + dLon, lon - dLon, lat + dLat, lat - dLat, ROW_CANDIDATE_CAP);
    const pt = point([lon, lat]);
    const hits: RightOfWayHit[] = [];
    for (const row of rows) {
      let geometry: LineString;
      try {
        geometry = String(row.geom_fmt) === 'polyline6' ? decodeLine(String(row.geom)) : (JSON.parse(String(row.geom)) as LineString);
      } catch {
        continue;
      }
      if (geometry.coordinates.length < 2) continue;
      const feature = lineString(geometry.coordinates);
      const distanceM = pointToLineDistance(pt, feature, { units: 'meters' });
      if (distanceM > limitMetres) continue;
      const snapped = nearestPointOnLine(feature, pt, { units: 'meters' });
      const base: RightOfWay = {
        id: Number(row.id),
        authorityCode: String(row.authority_code),
        authorityName: String(row.authority_name),
        attribution: String(row.attribution),
        sourceRef: str(row.source_ref),
        pathType: String(row.path_type) as RightOfWay['pathType'],
        routeNo: str(row.route_no),
        routeName: str(row.route_name),
        parish: str(row.parish),
        lengthM: Number(row.length_m),
        geometry,
      };
      hits.push({ ...base, distanceM: Math.round(distanceM), nearestPoint: snapped.geometry.coordinates as Position });
    }
    hits.sort((a, b) => a.distanceM - b.distanceM);
    return hits.slice(0, n);
  }

  prowCoverageAt(lon: number, lat: number): ProwCoverage {
    const rows = this.db
      .prepare(
        `SELECT c.country, c.geom FROM coverage_rtree r JOIN coverage c ON c.id = r.id
         WHERE r.min_lon <= ? AND r.max_lon >= ? AND r.min_lat <= ? AND r.max_lat >= ?`
      )
      .all(lon, lon, lat, lat);
    if (rows.length === 0) {
      const any = this.db.prepare('SELECT COUNT(*) AS c FROM coverage').get();
      return Number(any?.c ?? 0) === 0 ? 'unknown' : 'unknown';
    }
    const pt = point([lon, lat]);
    for (const row of rows) {
      const geom = parseGeometry(String(row.geom));
      if (geom && booleanPointInPolygon(pt, geom)) {
        const country = String(row.country);
        if (country === 'england' || country === 'wales') return 'england_wales';
        if (country === 'scotland') return 'scotland';
        if (country === 'northern_ireland') return 'northern_ireland';
      }
    }
    return 'unknown';
  }

  landRestrictionsAt(lon: number, lat: number): LandRestriction[] {
    const rows = this.db
      .prepare(
        `SELECT l.* FROM land_restrictions_rtree r JOIN land_restrictions l ON l.id = r.id
         WHERE r.min_lon <= ? AND r.max_lon >= ? AND r.min_lat <= ? AND r.max_lat >= ?`
      )
      .all(lon, lon, lat, lat);
    const pt = point([lon, lat]);
    const out: LandRestriction[] = [];
    for (const row of rows) {
      const geom = parseGeometry(String(row.geom));
      if (!geom || !booleanPointInPolygon(pt, geom)) continue;
      out.push({
        id: Number(row.id),
        sourceId: String(row.source_id),
        entryId: str(row.entry_id),
        kind: String(row.kind) as LandRestriction['kind'],
        owner: String(row.owner),
        name: String(row.name),
        accessClass: str(row.access_class),
        takeoffBanned: Number(row.takeoff_banned) === 1,
        landingBanned: row.landing_banned === null || row.landing_banned === undefined ? null : Number(row.landing_banned) === 1,
        summary: str(row.summary),
        sourceUrl: str(row.source_url),
        lastVerified: str(row.last_verified),
      });
    }
    return out;
  }

  findAerodrome(nameOrIcao: string, n = 5): GazetteerHit[] {
    const q = nameOrIcao.trim();
    if (!q) return [];
    const toHit = (r: Row): GazetteerHit => ({
      id: Number(r.id),
      name: String(r.name),
      icao: str(r.icao),
      kind: String(r.kind) as GazetteerHit['kind'],
      lon: Number(r.lon),
      lat: Number(r.lat),
      zoneId: r.zone_id === null || r.zone_id === undefined ? null : Number(r.zone_id),
    });
    if (/^[A-Za-z]{4}$/.test(q)) {
      const rows = this.db.prepare('SELECT * FROM gazetteer WHERE icao = ? ORDER BY kind LIMIT ?').all(q.toUpperCase(), n);
      if (rows.length > 0) return rows.map(toHit);
    }
    const terms = q
      .split(/\s+/)
      .map((t) => t.replace(/["'*^]/g, ''))
      .filter((t) => t.length > 0);
    if (terms.length > 0) {
      const match = terms.map((t) => `"${t}"*`).join(' ');
      try {
        const rows = this.db
          .prepare(
            `SELECT g.* FROM gazetteer_fts f JOIN gazetteer g ON g.id = f.rowid
             WHERE gazetteer_fts MATCH ? ORDER BY bm25(gazetteer_fts), g.kind LIMIT ?`
          )
          .all(match, n);
        if (rows.length > 0) return rows.map(toHit);
      } catch {
        // fall through to LIKE
      }
    }
    const rows = this.db
      .prepare(`SELECT * FROM gazetteer WHERE name LIKE ? OR aliases LIKE ? ORDER BY kind, name LIMIT ?`)
      .all(`%${q}%`, `%${q}%`, n);
    return rows.map(toHit);
  }

  zonesByAerodrome(aerodromeName: string): Zone[] {
    const rows = this.db.prepare('SELECT * FROM zones WHERE aerodrome_name = ? ORDER BY raw_type DESC, designator').all(aerodromeName);
    return rows.map((row) => ({ ...zoneFromRow(row, false), geometry: this.zoneGeometry(row) }));
  }

  close(): void {
    this.geomCache.clear();
    this.db.close();
  }
}
