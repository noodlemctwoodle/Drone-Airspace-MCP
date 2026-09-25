import polyline from '@mapbox/polyline';
import type { BBox, LineString, MultiPolygon, Polygon, Position } from '../types.js';

const POLYLINE_PRECISION = 6;

/** Decode a polyline6 string into a GeoJSON LineString ([lon, lat] positions). */
export function decodeLine(encoded: string): LineString {
  // @mapbox/polyline works in [lat, lon]; flip once here and nowhere else.
  const latLon = polyline.decode(encoded, POLYLINE_PRECISION);
  return { type: 'LineString', coordinates: latLon.map(([lat, lon]) => [lon, lat]) };
}

/** Encode a LineString's [lon, lat] positions to polyline6. */
export function encodeLine(coordinates: Position[]): string {
  return polyline.encode(
    coordinates.map(([lon, lat]) => [lat, lon]),
    POLYLINE_PRECISION
  );
}

export function parseGeometry(text: string): Polygon | MultiPolygon | undefined {
  try {
    const geom = JSON.parse(text) as Polygon | MultiPolygon;
    if (geom && (geom.type === 'Polygon' || geom.type === 'MultiPolygon') && Array.isArray(geom.coordinates)) {
      return geom;
    }
  } catch {
    // fall through
  }
  return undefined;
}

export function bboxOfPositions(positions: Position[]): BBox {
  let minLon = Infinity;
  let minLat = Infinity;
  let maxLon = -Infinity;
  let maxLat = -Infinity;
  for (const [lon, lat] of positions) {
    if (lon < minLon) minLon = lon;
    if (lon > maxLon) maxLon = lon;
    if (lat < minLat) minLat = lat;
    if (lat > maxLat) maxLat = lat;
  }
  return [minLon, minLat, maxLon, maxLat];
}

export function bboxOfGeometry(geom: Polygon | MultiPolygon | LineString): BBox {
  if (geom.type === 'LineString') return bboxOfPositions(geom.coordinates);
  const rings = geom.type === 'Polygon' ? geom.coordinates : geom.coordinates.flat();
  return bboxOfPositions(rings.flat());
}

/** Degrees of latitude / longitude that cover `metres` at the given latitude. */
export function metresToDegrees(metres: number, lat: number): { dLat: number; dLon: number } {
  const dLat = metres / 111_320;
  const dLon = metres / (111_320 * Math.max(0.05, Math.cos((lat * Math.PI) / 180)));
  return { dLat, dLon };
}

/** Tiny insertion-ordered LRU for decoded geometries. */
export class LruCache<K, V> {
  private readonly map = new Map<K, V>();

  constructor(private readonly max: number) {}

  get(key: K): V | undefined {
    const value = this.map.get(key);
    if (value !== undefined) {
      this.map.delete(key);
      this.map.set(key, value);
    }
    return value;
  }

  set(key: K, value: V): void {
    if (this.map.has(key)) this.map.delete(key);
    this.map.set(key, value);
    if (this.map.size > this.max) {
      const oldest = this.map.keys().next().value;
      if (oldest !== undefined) this.map.delete(oldest);
    }
  }

  clear(): void {
    this.map.clear();
  }
}
