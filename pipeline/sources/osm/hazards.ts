import type { HazardKind, LineString, MultiPolygon, Polygon } from '../../../src/types.js';
import type { Point } from 'geojson';

/** One ground hazard as extracted from OpenStreetMap; polygons are split into parts at insert time. */
export interface NormalisedHazard {
  osmId: string | null;
  kind: HazardKind;
  name: string | null;
  operator: string | null;
  ref: string | null;
  geometry: Point | LineString | Polygon | MultiPolygon;
}
