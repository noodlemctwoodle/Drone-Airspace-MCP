import bbox from '@turf/bbox';
import bboxPolygon from '@turf/bbox-polygon';
import booleanPointInPolygon from '@turf/boolean-point-in-polygon';
import distance from '@turf/distance';
import { lineString, point, polygon } from '@turf/helpers';
import length from '@turf/length';
import lineIntersect from '@turf/line-intersect';
import lineSlice from '@turf/line-slice';
import type { Feature, LineString as GjLineString, Polygon as GjPolygon } from 'geojson';
import type { BBox, LineString, MultiPolygon, Polygon, Position } from '../../types.js';

export function toLineString(positions: Position[]): LineString {
  return { type: 'LineString', coordinates: positions };
}

export function bboxOfLine(line: LineString): BBox {
  return bbox(lineString(line.coordinates)) as BBox;
}

export function bboxToPolygon(box: BBox): Polygon {
  return bboxPolygon(box).geometry;
}

export function routeLengthKm(line: LineString): number {
  return length(lineString(line.coordinates), { units: 'kilometers' });
}

export function distanceKm(a: Position, b: Position): number {
  return distance(point(a), point(b), { units: 'kilometers' });
}

export interface Crossing {
  entersAtKm: number;
  entersAt: Position;
  exitsAtKm: number | null;
  coveredKm: number;
  startsInside: boolean;
  endsInside: boolean;
}

function polygonsOf(geom: Polygon | MultiPolygon): GjPolygon[] {
  return geom.type === 'Polygon' ? [geom] : geom.coordinates.map((c) => ({ type: 'Polygon', coordinates: c }));
}

/**
 * Where along `line` a zone is first entered and how much of the route lies
 * inside it. Approximate: works from crossing points sorted by along-route distance.
 */
export function crossingOf(line: LineString, geom: Polygon | MultiPolygon): Crossing | undefined {
  const feature: Feature<GjLineString> = lineString(line.coordinates);
  const start = line.coordinates[0];
  const end = line.coordinates[line.coordinates.length - 1];
  const total = length(feature, { units: 'kilometers' });
  const startsInside = polygonsOf(geom).some((p) => booleanPointInPolygon(point(start), p));
  const endsInside = polygonsOf(geom).some((p) => booleanPointInPolygon(point(end), p));

  const crossingsKm: number[] = [];
  let firstPoint: Position | undefined;
  let firstKm = Infinity;
  for (const poly of polygonsOf(geom)) {
    let pts;
    try {
      pts = lineIntersect(feature, polygon(poly.coordinates));
    } catch {
      continue;
    }
    for (const p of pts.features) {
      const coord = p.geometry.coordinates as Position;
      let km: number;
      try {
        km = length(lineSlice(point(start), point(coord), feature), { units: 'kilometers' });
      } catch {
        continue;
      }
      crossingsKm.push(km);
      if (km < firstKm) {
        firstKm = km;
        firstPoint = coord;
      }
    }
  }
  crossingsKm.sort((a, b) => a - b);

  if (!startsInside && crossingsKm.length === 0) return undefined;

  // Walk the sorted crossings, toggling inside/outside from the start state.
  let inside = startsInside;
  let prev = 0;
  let covered = 0;
  let exitsAtKm: number | null = null;
  for (const km of crossingsKm) {
    if (inside) {
      covered += km - prev;
      if (exitsAtKm === null) exitsAtKm = km;
    }
    inside = !inside;
    prev = km;
  }
  if (inside) covered += total - prev;

  return {
    entersAtKm: startsInside ? 0 : firstKm,
    entersAt: startsInside ? start : (firstPoint ?? start),
    exitsAtKm,
    coveredKm: Math.max(0, covered),
    startsInside,
    endsInside,
  };
}
