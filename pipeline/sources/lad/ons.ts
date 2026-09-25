import type { AdminKind, Country, MultiPolygon, Polygon } from '../../../src/types.js';

/** One local authority district boundary from the ONS open geography portal. */
export interface NormalisedAdminArea {
  code: string;
  name: string;
  kind: AdminKind;
  country: Country | null;
  geometry: Polygon | MultiPolygon;
}
