import type { SqliteDriver } from '../../src/pack/driver.js';
import type { PackSource } from '../../src/types.js';
import { encodeLine, geometryBbox, tilePolygon } from '../lib/geometry.js';
import type { NormalisedHazard } from '../sources/osm/hazards.js';
import type { NormalisedAdminArea } from '../sources/lad/ons.js';
import centroid from '@turf/centroid';
import type { NormalisedZone } from '../sources/nats/aixm-parser.js';
import type { NormalisedPath } from '../sources/rowmaps/geojson-parser.js';
import type { NormalisedRestriction } from '../sources/nt/arcgis.js';
import type { CountryPolygon } from '../sources/countries/ons.js';
import type { NormalisedParking } from '../sources/osm/parking.js';
import { bboxOfPositions } from '../../src/pack/geometry.js';
import type { MultiPolygon, Polygon } from '../../src/types.js';

/**
 * One row per polygon part. Point-in-any semantics are unchanged and every
 * row stays under Cloudflare D1's 100 KB statement limit.
 */
export function polygonParts(geom: Polygon | MultiPolygon): Polygon[] {
  const parts: Polygon[] = geom.type === 'Polygon' ? [geom] : geom.coordinates.map((c) => ({ type: 'Polygon', coordinates: c }));
  return parts.flatMap((p) => tilePolygon(p));
}

/** Run `write` for every item in transactions of BATCH rows; returns the row count. */
async function batched<T>(db: SqliteDriver, items: AsyncIterable<T> | Iterable<T>, write: (item: T) => void): Promise<number> {
  let n = 0;
  let batch: T[] = [];
  const flush = () => {
    const rows = batch;
    batch = [];
    db.transaction(() => {
      for (const x of rows) {
        write(x);
        n += 1;
      }
    });
  };
  for await (const x of items as AsyncIterable<T>) {
    batch.push(x);
    if (batch.length >= BATCH) flush();
  }
  if (batch.length > 0) flush();
  return n;
}

const BATCH = 5000;

export function insertSource(db: SqliteDriver, s: PackSource): void {
  db.prepare(
    `INSERT OR REPLACE INTO sources (id, name, url, licence, attribution, fetched_at, effective_from, effective_to, version, feature_count, notes)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(s.id, s.name, s.url, s.licence, s.attribution, s.fetchedAt, s.effectiveFrom, s.effectiveTo, s.version, s.featureCount, s.notes);
}

export function insertMeta(db: SqliteDriver, meta: Record<string, unknown>): void {
  const stmt = db.prepare('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)');
  db.transaction(() => {
    for (const [k, v] of Object.entries(meta)) stmt.run(k, JSON.stringify(v));
  });
}

export async function insertZones(db: SqliteDriver, sourceId: string, zones: AsyncIterable<NormalisedZone> | Iterable<NormalisedZone>): Promise<number> {
  const ins = db.prepare(
    `INSERT INTO zones (source_id, aixm_id, designator, name, zone_type, raw_type, icao, aerodrome_name,
       lower_ft, lower_ref, lower_raw, upper_ft, upper_ref, upper_raw, activation, contact, notes, valid_from, valid_to,
       centroid_lon, centroid_lat, min_lon, max_lon, min_lat, max_lat, geom)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  const rtree = db.prepare('INSERT INTO zones_rtree (id, min_lon, max_lon, min_lat, max_lat) VALUES (?, ?, ?, ?, ?)');
  let n = 0;
  let batch: NormalisedZone[] = [];
  const flush = () => {
    const rows = batch;
    batch = [];
    db.transaction(() => {
      for (const z of rows) {
        const [w, s, e, nn] = geometryBbox(z.geometry);
        const r = ins.run(
          sourceId, z.aixmId, z.designator, z.name, z.zoneType, z.rawType, z.icao, z.aerodromeName,
          z.lowerFt, z.lowerRef, z.lowerRaw, z.upperFt, z.upperRef, z.upperRaw, z.activation, z.contact, z.notes, z.validFrom, z.validTo,
          z.centroid[0], z.centroid[1], w, e, s, nn, JSON.stringify(z.geometry)
        );
        rtree.run(Number(r.lastInsertRowid), w, e, s, nn);
        n += 1;
      }
    });
  };
  for await (const z of zones as AsyncIterable<NormalisedZone>) {
    batch.push(z);
    if (batch.length >= BATCH) flush();
  }
  if (batch.length > 0) flush();
  return n;
}

export function insertAuthority(db: SqliteDriver, a: { code: string; name: string; country: string; attribution: string; fetchedAt: string | null; featureCount: number }): void {
  db.prepare('INSERT OR REPLACE INTO authorities (code, name, country, attribution, fetched_at, feature_count) VALUES (?, ?, ?, ?, ?, ?)').run(
    a.code, a.name, a.country, a.attribution, a.fetchedAt, a.featureCount
  );
}

export async function insertRightsOfWay(db: SqliteDriver, paths: AsyncIterable<NormalisedPath> | Iterable<NormalisedPath>): Promise<number> {
  const ins = db.prepare(
    `INSERT INTO rights_of_way (authority_code, source_ref, path_type, route_no, route_name, parish, length_m, min_lon, max_lon, min_lat, max_lat, geom_fmt, geom)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'polyline6', ?)`
  );
  const rtree = db.prepare('INSERT INTO rights_of_way_rtree (id, min_lon, max_lon, min_lat, max_lat) VALUES (?, ?, ?, ?, ?)');
  let n = 0;
  let batch: NormalisedPath[] = [];
  const flush = () => {
    const rows = batch;
    batch = [];
    db.transaction(() => {
      for (const p of rows) {
        const [w, s, e, nn] = bboxOfPositions(p.coordinates);
        const r = ins.run(p.authorityCode, p.sourceRef, p.pathType, p.routeNo, p.routeName, p.parish, p.lengthM, w, e, s, nn, encodeLine(p.coordinates));
        rtree.run(Number(r.lastInsertRowid), w, e, s, nn);
        n += 1;
      }
    });
  };
  for await (const p of paths as AsyncIterable<NormalisedPath>) {
    batch.push(p);
    if (batch.length >= BATCH) flush();
  }
  if (batch.length > 0) flush();
  return n;
}

export async function insertLandRestrictions(db: SqliteDriver, items: AsyncIterable<NormalisedRestriction> | Iterable<NormalisedRestriction>): Promise<number> {
  const ins = db.prepare(
    `INSERT INTO land_restrictions (source_id, entry_id, kind, owner, name, access_class, takeoff_banned, landing_banned, summary, source_url, last_verified, props, scope, min_lon, max_lon, min_lat, max_lat, geom)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  const rtree = db.prepare('INSERT INTO land_restrictions_rtree (id, min_lon, max_lon, min_lat, max_lat) VALUES (?, ?, ?, ?, ?)');
  let n = 0;
  let batch: NormalisedRestriction[] = [];
  const flush = () => {
    const rows = batch;
    batch = [];
    db.transaction(() => {
      for (const x of rows) {
        const [w, s, e, nn] = geometryBbox(x.geometry);
        const r = ins.run(
          x.sourceId, x.entryId, x.kind, x.owner, x.name, x.accessClass, x.takeoffBanned ? 1 : 0,
          x.landingBanned === null ? null : x.landingBanned ? 1 : 0, x.summary, x.sourceUrl, x.lastVerified,
          x.props ? JSON.stringify(x.props) : null, x.scope ?? 'site', w, e, s, nn, JSON.stringify(x.geometry)
        );
        rtree.run(Number(r.lastInsertRowid), w, e, s, nn);
        n += 1;
      }
    });
  };
  for await (const x of items as AsyncIterable<NormalisedRestriction>) {
    for (const part of polygonParts(x.geometry)) {
      batch.push({ ...x, geometry: part });
      if (batch.length >= BATCH) flush();
    }
  }
  if (batch.length > 0) flush();
  return n;
}

export async function insertParking(db: SqliteDriver, items: AsyncIterable<NormalisedParking> | Iterable<NormalisedParking>): Promise<number> {
  const ins = db.prepare(
    `INSERT INTO parking (osm_id, kind, name, access, fee, capacity, surface, operator, lon, lat, min_lon, max_lon, min_lat, max_lat)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  const rtree = db.prepare('INSERT INTO parking_rtree (id, min_lon, max_lon, min_lat, max_lat) VALUES (?, ?, ?, ?, ?)');
  let n = 0;
  let batch: NormalisedParking[] = [];
  const flush = () => {
    const rows = batch;
    batch = [];
    db.transaction(() => {
      for (const p of rows) {
        const r = ins.run(p.osmId, p.kind, p.name, p.access, p.fee, p.capacity, p.surface, p.operator, p.lon, p.lat, p.lon, p.lon, p.lat, p.lat);
        rtree.run(Number(r.lastInsertRowid), p.lon, p.lon, p.lat, p.lat);
        n += 1;
      }
    });
  };
  for await (const p of items as AsyncIterable<NormalisedParking>) {
    batch.push(p);
    if (batch.length >= BATCH) flush();
  }
  if (batch.length > 0) flush();
  return n;
}

export function insertCoverage(db: SqliteDriver, countries: CountryPolygon[]): number {
  const ins = db.prepare('INSERT INTO coverage (country, min_lon, max_lon, min_lat, max_lat, geom) VALUES (?, ?, ?, ?, ?, ?)');
  const rtree = db.prepare('INSERT INTO coverage_rtree (id, min_lon, max_lon, min_lat, max_lat) VALUES (?, ?, ?, ?, ?)');
  let n = 0;
  db.transaction(() => {
    for (const c of countries) {
      for (const part of polygonParts(c.geometry)) {
        const [w, s, e, nn] = geometryBbox(part);
        const r = ins.run(c.country, w, e, s, nn, JSON.stringify(part));
        rtree.run(Number(r.lastInsertRowid), w, e, s, nn);
        n += 1;
      }
    }
  });
  return n;
}

export async function insertHazards(db: SqliteDriver, sourceId: string, items: AsyncIterable<NormalisedHazard> | Iterable<NormalisedHazard>): Promise<number> {
  const ins = db.prepare(
    `INSERT INTO hazards (source_id, osm_id, kind, name, operator, ref, geom_fmt, lon, lat, min_lon, max_lon, min_lat, max_lat, geom)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  const rtree = db.prepare('INSERT INTO hazards_rtree (id, min_lon, max_lon, min_lat, max_lat) VALUES (?, ?, ?, ?, ?)');
  async function* parts(): AsyncGenerator<NormalisedHazard> {
    for await (const h of items as AsyncIterable<NormalisedHazard>) {
      if (h.geometry.type === 'Polygon' || h.geometry.type === 'MultiPolygon') for (const part of polygonParts(h.geometry)) yield { ...h, geometry: part };
      else yield h;
    }
  }
  return batched(db, parts(), (h) => {
    const g = h.geometry;
    let w: number, s: number, e: number, nn: number, lon: number, lat: number, fmt: string, geom: string;
    if (g.type === 'Point') {
      [lon, lat] = g.coordinates;
      [w, s, e, nn] = [lon, lat, lon, lat];
      fmt = 'geojson';
      geom = JSON.stringify(g);
    } else if (g.type === 'LineString') {
      [w, s, e, nn] = bboxOfPositions(g.coordinates);
      const c = centroid(g).geometry.coordinates;
      [lon, lat] = [Math.round(c[0] * 1e6) / 1e6, Math.round(c[1] * 1e6) / 1e6];
      fmt = 'polyline6';
      geom = encodeLine(g.coordinates);
    } else {
      [w, s, e, nn] = geometryBbox(g as Polygon);
      const c = centroid(g as Polygon).geometry.coordinates;
      [lon, lat] = [Math.round(c[0] * 1e6) / 1e6, Math.round(c[1] * 1e6) / 1e6];
      fmt = 'geojson';
      geom = JSON.stringify(g);
    }
    const r = ins.run(sourceId, h.osmId, h.kind, h.name, h.operator, h.ref, fmt, lon, lat, w, e, s, nn, geom);
    rtree.run(Number(r.lastInsertRowid), w, e, s, nn);
  });
}

export async function insertAdminAreas(db: SqliteDriver, items: AsyncIterable<NormalisedAdminArea> | Iterable<NormalisedAdminArea>): Promise<number> {
  const ins = db.prepare('INSERT INTO admin_areas (code, name, kind, country, min_lon, max_lon, min_lat, max_lat, geom) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)');
  const rtree = db.prepare('INSERT INTO admin_areas_rtree (id, min_lon, max_lon, min_lat, max_lat) VALUES (?, ?, ?, ?, ?)');
  async function* parts(): AsyncGenerator<NormalisedAdminArea & { geometry: Polygon }> {
    for await (const a of items as AsyncIterable<NormalisedAdminArea>) for (const part of polygonParts(a.geometry)) yield { ...a, geometry: part };
  }
  return batched(db, parts(), (a) => {
    const [w, s, e, nn] = geometryBbox(a.geometry);
    const r = ins.run(a.code, a.name, a.kind, a.country, w, e, s, nn, JSON.stringify(a.geometry));
    rtree.run(Number(r.lastInsertRowid), w, e, s, nn);
  });
}
