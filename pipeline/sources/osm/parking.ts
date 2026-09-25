import centroid from '@turf/centroid';
import type { Geometry, Position } from 'geojson';
import type { ParkingKind } from '../../../src/types.js';
import { round6 } from '../../lib/geometry.js';

export interface NormalisedParking {
  osmId: string | null;
  kind: ParkingKind;
  name: string | null;
  access: string | null;
  fee: string | null;
  capacity: number | null;
  surface: string | null;
  operator: string | null;
  lon: number;
  lat: number;
}

/**
 * Classify an OSM feature exported by `osmium export` (tags as properties).
 * Returns undefined for features that are not places a driver can leave a car.
 */
export function classifyParking(tags: Record<string, unknown>): ParkingKind | undefined {
  const amenity = String(tags.amenity ?? '');
  const parking = String(tags.parking ?? '');
  const highway = String(tags.highway ?? '');
  if (highway === 'rest_area') return 'rest_area';
  if (amenity !== 'parking') return undefined;
  if (parking === 'layby' || parking === 'lay_by') return 'layby';
  if (parking === 'street_side' || parking === 'lane') return 'street_side';
  return 'car_park';
}

export function normaliseParkingFeature(feature: { geometry?: Geometry | null; properties?: Record<string, unknown> | null }): NormalisedParking | undefined {
  const tags = feature.properties ?? {};
  const kind = classifyParking(tags);
  if (!kind) return undefined;
  // Bicycle and motorcycle parking are tagged separately; skip the odd mis-tag.
  if (tags.bicycle_parking !== undefined || String(tags.parking_space ?? '') === 'bicycle') return undefined;
  const g = feature.geometry;
  if (!g) return undefined;
  let pos: Position | undefined;
  if (g.type === 'Point') pos = g.coordinates;
  else if (g.type === 'Polygon' || g.type === 'MultiPolygon' || g.type === 'LineString') {
    try {
      pos = centroid(g).geometry.coordinates;
    } catch {
      return undefined;
    }
  }
  if (!pos || !Number.isFinite(pos[0]) || !Number.isFinite(pos[1])) return undefined;
  const capacityRaw = Number(String(tags.capacity ?? '').replace(/[^\d]/g, ''));
  const str = (k: string) => {
    const v = tags[k];
    return typeof v === 'string' && v.trim() !== '' ? v.trim().slice(0, 120) : null;
  };
  return {
    osmId: str('@id') ?? str('id'),
    kind,
    name: str('name'),
    access: str('access'),
    fee: str('fee'),
    capacity: Number.isFinite(capacityRaw) && capacityRaw > 0 ? capacityRaw : null,
    surface: str('surface'),
    operator: str('operator'),
    lon: round6(pos[0]),
    lat: round6(pos[1]),
  };
}
