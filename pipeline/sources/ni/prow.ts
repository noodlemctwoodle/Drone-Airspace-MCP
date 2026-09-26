import length from '@turf/length';
import { lineString } from '@turf/helpers';
import type { Geometry } from 'geojson';
import type { Position } from '../../../src/types.js';
import { roundCoords } from '../../lib/geometry.js';
import type { NormalisedPath } from '../rowmaps/geojson-parser.js';
import type { ArcgisFeature } from '../nt/arcgis.js';

/**
 * Public rights of way in Northern Ireland are asserted by each council under
 * the Access to the Countryside (Northern Ireland) Order 1983; there is no
 * definitive map and few councils publish what they have. Mid Ulster does, as
 * an ArcGIS layer under the Open Government Licence. Authority codes are the
 * ONS local government district codes.
 */
export const MID_ULSTER_PROW_URL = 'https://services1.arcgis.com/IBPnlgK2X1Ngocds/arcgis/rest/services/PROW/FeatureServer/0';

export interface NiProwAuthority {
  code: string;
  name: string;
  url: string;
}

export const NI_PROW_AUTHORITIES: NiProwAuthority[] = [
  { code: 'N09000010', name: 'Mid Ulster District Council', url: process.env.MID_ULSTER_PROW_URL ?? MID_ULSTER_PROW_URL },
];

function str(props: Record<string, unknown>, key: string): string | null {
  const v = props[key];
  return typeof v === 'string' && v.trim() !== '' ? v.trim() : null;
}

function titleCase(s: string): string {
  return s.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
}

/** One ArcGIS polyline becomes one path per line part; unasserted or broken rows are dropped. */
export function normaliseNiProwFeature(f: ArcgisFeature, authorityCode: string): NormalisedPath[] {
  const props = f.properties ?? {};
  const g = f.geometry as Geometry | null | undefined; // the NT-shaped type says polygon, this layer is polylines
  if (!g) return [];
  const asserted = str(props, 'ASSERTED');
  if (asserted && !/^y/i.test(asserted)) return [];
  const parts: Position[][] = g.type === 'LineString' ? [g.coordinates as Position[]] : g.type === 'MultiLineString' ? (g.coordinates as Position[][]) : [];
  const workbank = str(props, 'WORKBANK_I');
  const routeNo = workbank ? workbank.split(',')[0].trim() : props.OBJECTID === undefined ? null : `PROW ${String(props.OBJECTID)}`;
  const location = str(props, 'LOCATION');
  const council = str(props, 'COUNCIL');
  const out: NormalisedPath[] = [];
  for (const coords of parts) {
    if (!Array.isArray(coords) || coords.length < 2 || coords.some((p) => !Number.isFinite(p[0]) || !Number.isFinite(p[1]))) continue;
    out.push({
      authorityCode,
      sourceRef: props.OBJECTID === undefined || props.OBJECTID === null ? null : String(props.OBJECTID),
      pathType: 'footpath',
      routeNo,
      routeName: location ? titleCase(location) : null,
      parish: council ? titleCase(council) : null,
      lengthM: Math.round(length(lineString(coords), { units: 'meters' })),
      coordinates: roundCoords(coords),
    });
  }
  return out;
}
