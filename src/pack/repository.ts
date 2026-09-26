import booleanPointInPolygon from '@turf/boolean-point-in-polygon';
import booleanIntersects from '@turf/boolean-intersects';
import bboxPolygon from '@turf/bbox-polygon';
import { lineString, point } from '@turf/helpers';
import pointToLineDistance from '@turf/point-to-line-distance';
import nearestPointOnLine from '@turf/nearest-point-on-line';
import distance from '@turf/distance';
import type {
  BBox,
  GazetteerHit,
  MultiPolygon,
  Polygon,
  LandRestriction,
  LineString,
  PackMeta,
  Parking,
  ParkingHit,
  PackSource,
  Position,
  ProwCoverage,
  RightOfWay,
  RightOfWayHit,
  Zone,
  ZoneType,
  Hazard,
  HazardHit,
  AdminArea,
  Geometry,
} from '../types.js';
import { openDatabase, type Row, type SqliteDriver } from './driver.js';
import { PackIncompatibleError } from '../core/errors.js';
import { SCHEMA_VERSION } from './schema.js';
import { LruCache, bboxOfGeometry, decodeLine, metresToDegrees, parseGeometry } from './geometry.js';
import type { AsyncQuery, SqlValue } from './query.js';

export interface ZonesAtOptions {
  types?: ZoneType[];
}

/**
 * Everything the tools need from the data pack. All methods are async so the
 * same interface serves node:sqlite (npx, the desktop extension) and
 * Cloudflare D1 (the hosted Worker). `FakePackRepository` in the tests
 * implements it over fixtures.
 */
export interface PackRepository {
  meta(): Promise<PackMeta>;
  zonesAt(lon: number, lat: number, opts?: ZonesAtOptions): Promise<Zone[]>;
  zonesInBbox(bbox: BBox): Promise<Zone[]>;
  zonesAlongLine(line: LineString): Promise<Zone[]>;
  zoneById(id: number): Promise<Zone | undefined>;
  nearestRightsOfWay(lon: number, lat: number, limitMetres?: number, n?: number): Promise<RightOfWayHit[]>;
  prowCoverageAt(lon: number, lat: number): Promise<ProwCoverage>;
  landRestrictionsAt(lon: number, lat: number): Promise<LandRestriction[]>;
  findAerodrome(nameOrIcao: string, n?: number): Promise<GazetteerHit[]>;
  /** Every zone component (FRZ circle plus runway protection zones) for an aerodrome name. */
  zonesByAerodrome(aerodromeName: string): Promise<Zone[]>;
  /** Land restrictions intersecting a bbox, with geometry (map rendering). */
  landRestrictionsInBbox(bbox: BBox, limit?: number): Promise<Array<LandRestriction & { geometry: Polygon | MultiPolygon }>>;
  /** Ground hazards near a point, nearest first, at most three per kind. */
  hazardsNear(lon: number, lat: number, limitMetres?: number, n?: number): Promise<HazardHit[]>;
  /** Hazards whose bbox touches the box, with geometry, for the map. */
  hazardsInBbox(bbox: BBox, limit?: number, kinds?: readonly string[], nearestTo?: [number, number]): Promise<Array<Hazard & { geometry: Geometry }>>;
  /** The local authority containing a point, if the pack knows it. */
  adminAreaAt(lon: number, lat: number): Promise<AdminArea | null>;
  /** Car parks, laybys and rest areas within `limitMetres`, nearest first. Private ones are excluded unless asked for. */
  nearestParking(lon: number, lat: number, limitMetres?: number, n?: number, includePrivate?: boolean): Promise<ParkingHit[]>;
  close(): void;
}

const ROW_CANDIDATE_CAP = 2000;
/** Generalised council boundaries stop at the coastline; points this close to one still get the council. */
const COAST_TOLERANCE_M = 1000;

function str(v: unknown): string | null {
  return v === null || v === undefined ? null : String(v);
}
function num(v: unknown): number | null {
  return v === null || v === undefined ? null : Number(v);
}

export function zoneFromRow(row: Row, geometry: Zone['geometry']): Zone {
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
    geometry,
  };
}

export function restrictionFromRow(row: Row): LandRestriction {
  return {
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
    scope: (str(row.scope) ?? 'site') as LandRestriction['scope'],
  };
}

/**
 * Repository logic shared by every backend: rtree bbox prefilter in SQL, exact
 * geometry tests with turf in JS.
 */
export class QueryPackRepository implements PackRepository {
  private readonly geomCache = new LruCache<string, Zone['geometry']>(500);
  private metaCache: PackMeta | undefined;

  constructor(protected readonly q: AsyncQuery) {}

  async meta(): Promise<PackMeta> {
    if (this.metaCache) return this.metaCache;
    const rows = await this.q.all('SELECT key, value FROM meta');
    const kv: Record<string, unknown> = {};
    for (const r of rows) {
      try {
        kv[String(r.key)] = JSON.parse(String(r.value));
      } catch {
        kv[String(r.key)] = String(r.value);
      }
    }
    const sources: PackSource[] = (await this.q.all('SELECT * FROM sources ORDER BY id')).map((r) => ({
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

  private zonesInBox(bbox: BBox): Promise<Row[]> {
    return this.q.all(
      `SELECT z.* FROM zones_rtree r JOIN zones z ON z.id = r.id
       WHERE r.min_lon <= ? AND r.max_lon >= ? AND r.min_lat <= ? AND r.max_lat >= ?`,
      [bbox[2], bbox[0], bbox[3], bbox[1]]
    );
  }

  async zonesAt(lon: number, lat: number, opts: ZonesAtOptions = {}): Promise<Zone[]> {
    const pt = point([lon, lat]);
    const out: Zone[] = [];
    for (const row of await this.zonesInBox([lon, lat, lon, lat])) {
      if (opts.types && !opts.types.includes(String(row.zone_type) as ZoneType)) continue;
      const geometry = this.zoneGeometry(row);
      if (geometry.coordinates.length === 0) continue;
      if (booleanPointInPolygon(pt, geometry)) out.push(zoneFromRow(row, geometry));
    }
    return out;
  }

  async zonesInBbox(bbox: BBox): Promise<Zone[]> {
    const poly = bboxPolygon(bbox);
    const out: Zone[] = [];
    for (const row of await this.zonesInBox(bbox)) {
      const geometry = this.zoneGeometry(row);
      if (geometry.coordinates.length === 0) continue;
      if (booleanIntersects(poly, geometry)) out.push(zoneFromRow(row, geometry));
    }
    return out;
  }

  async zonesAlongLine(line: LineString): Promise<Zone[]> {
    const feature = lineString(line.coordinates);
    const out: Zone[] = [];
    for (const row of await this.zonesInBox(bboxOfGeometry(line))) {
      const geometry = this.zoneGeometry(row);
      if (geometry.coordinates.length === 0) continue;
      if (booleanIntersects(feature, geometry)) out.push(zoneFromRow(row, geometry));
    }
    return out;
  }

  async zoneById(id: number): Promise<Zone | undefined> {
    const row = await this.q.get('SELECT * FROM zones WHERE id = ?', [id]);
    return row ? zoneFromRow(row, this.zoneGeometry(row)) : undefined;
  }

  async zonesByAerodrome(aerodromeName: string): Promise<Zone[]> {
    const rows = await this.q.all('SELECT * FROM zones WHERE aerodrome_name = ? ORDER BY raw_type DESC, designator', [aerodromeName]);
    return rows.map((row) => zoneFromRow(row, this.zoneGeometry(row)));
  }

  async nearestRightsOfWay(lon: number, lat: number, limitMetres = 500, n = 5): Promise<RightOfWayHit[]> {
    const { dLat, dLon } = metresToDegrees(limitMetres, lat);
    const rows = await this.q.all(
      `SELECT p.*, a.name AS authority_name, a.attribution AS attribution
       FROM rights_of_way_rtree r
       JOIN rights_of_way p ON p.id = r.id
       JOIN authorities a ON a.code = p.authority_code
       WHERE r.min_lon <= ? AND r.max_lon >= ? AND r.min_lat <= ? AND r.max_lat >= ?
       LIMIT ?`,
      [lon + dLon, lon - dLon, lat + dLat, lat - dLat, ROW_CANDIDATE_CAP]
    );
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

  async prowCoverageAt(lon: number, lat: number): Promise<ProwCoverage> {
    const rows = await this.q.all(
      `SELECT c.country, c.geom FROM coverage_rtree r JOIN coverage c ON c.id = r.id
       WHERE r.min_lon <= ? AND r.max_lon >= ? AND r.min_lat <= ? AND r.max_lat >= ?`,
      [lon, lon, lat, lat]
    );
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

  async landRestrictionsAt(lon: number, lat: number): Promise<LandRestriction[]> {
    const rows = await this.q.all(
      `SELECT l.* FROM land_restrictions_rtree r JOIN land_restrictions l ON l.id = r.id
       WHERE r.min_lon <= ? AND r.max_lon >= ? AND r.min_lat <= ? AND r.max_lat >= ?`,
      [lon, lon, lat, lat]
    );
    const pt = point([lon, lat]);
    const out: LandRestriction[] = [];
    for (const row of rows) {
      const geom = parseGeometry(String(row.geom));
      if (geom && booleanPointInPolygon(pt, geom)) out.push(restrictionFromRow(row));
    }
    return out;
  }

  async landRestrictionsInBbox(bbox: BBox, limit = 200): Promise<Array<LandRestriction & { geometry: Polygon | MultiPolygon }>> {
    const rows = await this.q.all(
      `SELECT l.* FROM land_restrictions_rtree r JOIN land_restrictions l ON l.id = r.id
       WHERE r.min_lon <= ? AND r.max_lon >= ? AND r.min_lat <= ? AND r.max_lat >= ? LIMIT ?`,
      [bbox[2], bbox[0], bbox[3], bbox[1], limit]
    );
    const out: Array<LandRestriction & { geometry: Polygon | MultiPolygon }> = [];
    for (const row of rows) {
      const geometry = parseGeometry(String(row.geom));
      if (geometry) out.push({ ...restrictionFromRow(row), geometry });
    }
    return out;
  }

  async nearestParking(lon: number, lat: number, limitMetres = 2000, n = 5, includePrivate = false): Promise<ParkingHit[]> {
    const { dLat, dLon } = metresToDegrees(limitMetres, lat);
    const rows = await this.q.all(
      `SELECT p.* FROM parking_rtree r JOIN parking p ON p.id = r.id
       WHERE r.min_lon <= ? AND r.max_lon >= ? AND r.min_lat <= ? AND r.max_lat >= ?
       LIMIT ?`,
      [lon + dLon, lon - dLon, lat + dLat, lat - dLat, ROW_CANDIDATE_CAP]
    );
    const here = point([lon, lat]);
    const hits: ParkingHit[] = [];
    for (const row of rows) {
      const access = str(row.access);
      if (!includePrivate && access && /^(private|no|customers|permit|employees|residents|delivery|military)$/i.test(access)) continue;
      const p: Parking = {
        id: Number(row.id),
        osmId: str(row.osm_id),
        kind: String(row.kind) as Parking['kind'],
        name: str(row.name),
        access,
        fee: str(row.fee),
        capacity: num(row.capacity),
        surface: str(row.surface),
        operator: str(row.operator),
        lon: Number(row.lon),
        lat: Number(row.lat),
      };
      const distanceM = distance(here, point([p.lon, p.lat]), { units: 'meters' });
      if (distanceM > limitMetres) continue;
      hits.push({ ...p, distanceM: Math.round(distanceM) });
    }
    hits.sort((a, b) => a.distanceM - b.distanceM);
    // OSM often maps one car park as several polygons; keep the nearest of same-named neighbours.
    const deduped: ParkingHit[] = [];
    for (const h of hits) {
      const near = (d: ParkingHit, m: number) => distance(point([d.lon, d.lat]), point([h.lon, h.lat]), { units: 'meters' }) < m;
      if (h.name ? deduped.some((d) => d.name === h.name && near(d, 400)) : deduped.some((d) => !d.name && d.kind === h.kind && near(d, 150))) continue;
      deduped.push(h);
      if (deduped.length >= n) break;
    }
    return deduped;
  }

  private hazardFromRow(row: Row): Hazard {
    return {
      id: Number(row.id),
      osmId: str(row.osm_id),
      kind: String(row.kind) as Hazard['kind'],
      name: str(row.name),
      operator: str(row.operator),
      ref: str(row.ref),
      lon: Number(row.lon),
      lat: Number(row.lat),
    };
  }

  private hazardGeometry(row: Row): Geometry | undefined {
    if (String(row.geom_fmt) === 'polyline6') return decodeLine(String(row.geom));
    try {
      return JSON.parse(String(row.geom)) as Geometry;
    } catch {
      return undefined;
    }
  }

  async hazardsNear(lon: number, lat: number, limitMetres = 500, n = 12): Promise<HazardHit[]> {
    const { dLat, dLon } = metresToDegrees(limitMetres, lat);
    const rows = await this.q.all(
      `SELECT h.* FROM hazards_rtree r JOIN hazards h ON h.id = r.id
       WHERE r.min_lon <= ? AND r.max_lon >= ? AND r.min_lat <= ? AND r.max_lat >= ?
       LIMIT ?`,
      [lon + dLon, lon - dLon, lat + dLat, lat - dLat, ROW_CANDIDATE_CAP]
    );
    const here = point([lon, lat]);
    const hits: HazardHit[] = [];
    for (const row of rows) {
      const g = this.hazardGeometry(row);
      let d: number;
      if (!g || g.type === 'Point') d = distance(here, point([Number(row.lon), Number(row.lat)]), { units: 'meters' });
      else if (g.type === 'LineString') d = pointToLineDistance(here, lineString(g.coordinates), { units: 'meters' });
      else if (g.type === 'Polygon') d = booleanPointInPolygon(here, g) ? 0 : pointToLineDistance(here, lineString(g.coordinates[0]), { units: 'meters' });
      else d = distance(here, point([Number(row.lon), Number(row.lat)]), { units: 'meters' });
      if (d > limitMetres) continue;
      hits.push({ ...this.hazardFromRow(row), distanceM: Math.round(d) });
    }
    hits.sort((a, b) => a.distanceM - b.distanceM);
    // Polygons are stored in parts and OSM often maps a site as both a node and an
    // area, so the same named feature can come back more than once: keep the nearest.
    const perKind = new Map<string, number>();
    const seen = new Set<string>();
    const out: HazardHit[] = [];
    for (const h of hits) {
      const key = h.name || h.ref ? `${h.kind}|${h.name ?? ''}|${h.ref ?? ''}|${h.operator ?? ''}` : null;
      if (key) {
        if (seen.has(key)) continue;
        seen.add(key);
      }
      const k = perKind.get(h.kind) ?? 0;
      if (k >= 3) continue;
      perKind.set(h.kind, k + 1);
      out.push(h);
      if (out.length >= n) break;
    }
    return out;
  }

  async hazardsInBbox(bbox: BBox, limit = 300, kinds?: readonly string[], nearestTo?: [number, number]): Promise<Array<Hazard & { geometry: Geometry }>> {
    const kindFilter = kinds && kinds.length > 0 ? ` AND h.kind IN (${kinds.map(() => '?').join(',')})` : '';
    // Nearest first is decided in SQL so only `limit` rows, geometry included, leave the database.
    const order = nearestTo ? ' ORDER BY (h.lon - ?) * (h.lon - ?) + (h.lat - ?) * (h.lat - ?) * 2.6' : '';
    const orderParams = nearestTo ? [nearestTo[0], nearestTo[0], nearestTo[1], nearestTo[1]] : [];
    // CROSS JOIN pins the join order: with a kind filter SQLite would otherwise walk the kind index and probe
    // the rtree once per row, which on D1 meant reading a million rows for a 700-candidate box.
    const rows = await this.q.all(
      `SELECT h.* FROM hazards_rtree r CROSS JOIN hazards h ON h.id = r.id
       WHERE r.min_lon <= ? AND r.max_lon >= ? AND r.min_lat <= ? AND r.max_lat >= ?${kindFilter}${order} LIMIT ?`,
      [bbox[2], bbox[0], bbox[3], bbox[1], ...(kinds && kinds.length > 0 ? kinds : []), ...orderParams, limit]
    );
    const out: Array<Hazard & { geometry: Geometry }> = [];
    for (const row of rows) {
      const geometry = this.hazardGeometry(row);
      if (geometry) out.push({ ...this.hazardFromRow(row), geometry });
    }
    return out;
  }

  /**
   * The council containing the point. Boundaries are generalised and clipped
   * to the coastline, so a clifftop or beach can fall just outside every
   * polygon; within `COAST_TOLERANCE_M` the nearest boundary wins instead.
   */
  async adminAreaAt(lon: number, lat: number): Promise<AdminArea | null> {
    const { dLat, dLon } = metresToDegrees(COAST_TOLERANCE_M, lat);
    const rows = await this.q.all(
      `SELECT a.* FROM admin_areas_rtree r JOIN admin_areas a ON a.id = r.id
       WHERE r.min_lon <= ? AND r.max_lon >= ? AND r.min_lat <= ? AND r.max_lat >= ? LIMIT 50`,
      [lon + dLon, lon - dLon, lat + dLat, lat - dLat]
    );
    const here = point([lon, lat]);
    const toArea = (row: Row): AdminArea => ({ id: Number(row.id), code: String(row.code), name: String(row.name), kind: String(row.kind) as AdminArea['kind'], country: (str(row.country) as AdminArea['country']) ?? null });
    let nearest: { row: Row; d: number } | null = null;
    for (const row of rows) {
      const g = parseGeometry(String(row.geom));
      if (!g) continue;
      if (booleanPointInPolygon(here, g)) return toArea(row);
      const rings = g.type === 'Polygon' ? g.coordinates : g.coordinates.flat();
      for (const ring of rings) {
        const d = pointToLineDistance(here, lineString(ring), { units: 'meters' });
        if (d <= COAST_TOLERANCE_M && (!nearest || d < nearest.d)) nearest = { row, d };
      }
    }
    return nearest ? toArea(nearest.row) : null;
  }

  async findAerodrome(nameOrIcao: string, n = 5): Promise<GazetteerHit[]> {
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
      const rows = await this.q.all('SELECT * FROM gazetteer WHERE icao = ? ORDER BY kind LIMIT ?', [q.toUpperCase(), n]);
      if (rows.length > 0) return rows.map(toHit);
    }
    const terms = q
      .split(/\s+/)
      .map((t) => t.replace(/["'*^]/g, ''))
      .filter((t) => t.length > 0);
    if (terms.length > 0) {
      const match = terms.map((t) => `"${t}"*`).join(' ');
      try {
        const rows = await this.q.all(
          `SELECT g.* FROM gazetteer_fts f JOIN gazetteer g ON g.id = f.rowid
           WHERE gazetteer_fts MATCH ? ORDER BY bm25(gazetteer_fts), g.kind LIMIT ?`,
          [match, n]
        );
        if (rows.length > 0) return rows.map(toHit);
      } catch {
        // fall through to LIKE
      }
    }
    const rows = await this.q.all(`SELECT * FROM gazetteer WHERE name LIKE ? OR aliases LIKE ? ORDER BY kind, name LIMIT ?`, [`%${q}%`, `%${q}%`, n]);
    return rows.map(toHit);
  }

  close(): void {
    this.geomCache.clear();
    this.q.close();
  }
}

/** node:sqlite adapter: synchronous underneath, async on the surface. */
export class SqliteQuery implements AsyncQuery {
  constructor(private readonly db: SqliteDriver) {}
  async all(sql: string, params: SqlValue[] = []): Promise<Row[]> {
    return this.db.prepare(sql).all(...(params as never[]));
  }
  async get(sql: string, params: SqlValue[] = []): Promise<Row | undefined> {
    return this.db.prepare(sql).get(...(params as never[]));
  }
  close(): void {
    this.db.close();
  }
}

export class SqlitePackRepository extends QueryPackRepository {
  readonly path: string;

  constructor(pathOrDriver: string | SqliteDriver) {
    const db = typeof pathOrDriver === 'string' ? openDatabase(pathOrDriver, { readonly: true }) : pathOrDriver;
    const version = Number(db.pragma('user_version') ?? 0);
    if (version !== SCHEMA_VERSION) {
      db.close();
      throw new PackIncompatibleError(version, SCHEMA_VERSION);
    }
    try {
      db.exec('PRAGMA query_only = 1');
    } catch {
      // read-only connections already enforce this
    }
    super(new SqliteQuery(db));
    this.path = db.path;
  }
}
