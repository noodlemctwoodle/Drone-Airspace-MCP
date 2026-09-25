import destination from '@turf/destination';
import { point } from '@turf/helpers';
import rewind from '@turf/rewind';
import { polygon as turfPolygon } from '@turf/helpers';
import type { MultiPolygon, Polygon, Position } from '../../src/types.js';
import { bboxOfPositions } from '../../src/pack/geometry.js';

export { encodeLine } from '../../src/pack/geometry.js';

export const NM_KM = 1.852;

export function round6(n: number): number {
  return Math.round(n * 1e6) / 1e6;
}

export function roundCoords(ring: Position[]): Position[] {
  return ring.map(([lon, lat]) => [round6(lon), round6(lat)]);
}

export function radiusToKm(value: number, uom: string | undefined): number {
  const u = (uom ?? '[nmi_i]').toLowerCase();
  if (u.includes('nmi') || u === 'nm') return value * NM_KM;
  if (u === 'km') return value;
  if (u === 'm') return value / 1000;
  if (u.includes('ft')) return value * 0.0003048;
  return value * NM_KM;
}

export function circlePositions(centre: Position, radiusKm: number, steps = 64): Position[] {
  const pts: Position[] = [];
  for (let i = 0; i <= steps; i += 1) {
    const b = (360 * i) / steps;
    pts.push(destination(point(centre), radiusKm, b, { units: 'kilometers' }).geometry.coordinates as Position);
  }
  pts[pts.length - 1] = pts[0];
  return pts;
}

/**
 * GML ArcByCenterPoint as NATS encode it: bearings in degrees clockwise from
 * north; sweep = endAngle - startAngle with its sign giving the direction
 * (positive clockwise, negative anticlockwise), no normalisation. Verified
 * against the NATS KML for 534 of 546 arc-based zones on 2026-09-25.
 */
export function arcPositions(centre: Position, radiusKm: number, startAngle: number, endAngle: number, maxStepDeg = 2): Position[] {
  const sweep = endAngle - startAngle;
  const n = Math.max(8, Math.ceil(Math.abs(sweep) / maxStepDeg));
  const pts: Position[] = [];
  for (let i = 0; i <= n; i += 1) {
    const b = startAngle + (sweep * i) / n;
    pts.push(destination(point(centre), radiusKm, b, { units: 'kilometers' }).geometry.coordinates as Position);
  }
  return pts;
}

export function samePoint(a: Position, b: Position, epsDeg = 0.0005): boolean {
  return Math.abs(a[0] - b[0]) < epsDeg && Math.abs(a[1] - b[1]) < epsDeg;
}

/** Append `next` to `ring`, joining on a shared endpoint and reversing the segment if it fits better that way. */
export function appendSegment(ring: Position[], next: Position[]): { ring: Position[]; reversed: boolean } {
  if (ring.length === 0 || next.length === 0) return { ring: ring.concat(next), reversed: false };
  const last = ring[ring.length - 1];
  const fitsForward = samePoint(last, next[0]);
  const fitsReverse = samePoint(last, next[next.length - 1]);
  if (!fitsForward && fitsReverse) return { ring: ring.concat([...next].reverse().slice(1)), reversed: true };
  return { ring: ring.concat(fitsForward ? next.slice(1) : next), reversed: false };
}

export function closeRing(ring: Position[]): Position[] {
  const out: Position[] = [];
  for (const p of ring) {
    const prev = out[out.length - 1];
    if (!prev || prev[0] !== p[0] || prev[1] !== p[1]) out.push(p);
  }
  if (out.length > 0 && (out[0][0] !== out[out.length - 1][0] || out[0][1] !== out[out.length - 1][1])) out.push(out[0]);
  return out;
}

export function normalisePolygon(rings: Position[][]): Polygon | undefined {
  const cleaned = rings.map(closeRing).filter((r) => r.length >= 4);
  if (cleaned.length === 0) return undefined;
  try {
    const f = rewind(turfPolygon(cleaned), { reverse: false }) as unknown as { geometry?: Polygon; type: string; coordinates?: Position[][] };
    if (f.geometry) return f.geometry;
    if (f.type === 'Polygon' && f.coordinates) return { type: 'Polygon', coordinates: f.coordinates };
    return { type: 'Polygon', coordinates: cleaned };
  } catch {
    return { type: 'Polygon', coordinates: cleaned };
  }
}

export function roundGeometry<T extends Polygon | MultiPolygon>(geom: T): T {
  if (geom.type === 'Polygon') return { ...geom, coordinates: geom.coordinates.map(roundCoords) } as T;
  return { ...geom, coordinates: geom.coordinates.map((poly) => poly.map(roundCoords)) } as T;
}

import simplify from '@turf/simplify';

/**
 * Simplify a polygon until its JSON is under `maxBytes` (Cloudflare D1 caps a
 * statement at 100 KB). Tolerance doubles each pass from ~2 m; gives up after
 * eight passes and returns the smallest result.
 */
export function shrinkPolygon(poly: Polygon, maxBytes = 50_000): Polygon {
  let current = poly;
  let tolerance = 0.00002;
  for (let i = 0; i < 8 && JSON.stringify(current).length > maxBytes; i += 1) {
    try {
      const next = simplify(current, { tolerance, highQuality: false }) as Polygon;
      if (next.coordinates.length > 0 && next.coordinates[0].length >= 4) current = roundGeometry(next);
    } catch {
      break;
    }
    tolerance *= 2;
  }
  return current;
}

export function geometryBbox(geom: Polygon | MultiPolygon) {
  const rings = geom.type === 'Polygon' ? geom.coordinates : geom.coordinates.flat();
  return bboxOfPositions(rings.flat());
}
