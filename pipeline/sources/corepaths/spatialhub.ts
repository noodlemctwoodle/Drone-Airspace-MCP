import length from '@turf/length';
import { lineString } from '@turf/helpers';
import type { Position } from '../../../src/types.js';
import { roundCoords } from '../../lib/geometry.js';
import type { NormalisedPath } from '../rowmaps/geojson-parser.js';
import type { WfsFeature } from '../wfs/geojson.js';

/**
 * Core paths under the Land Reform (Scotland) Act 2003, aggregated from every
 * Scottish council and National Park authority by the Improvement Service
 * Spatial Hub (OGL v3). The WFS needs an account key; both the endpoint and
 * the layer name are overridable because they are confirmed per account.
 */
export const SPATIALHUB_WFS_URL = 'https://geo.spatialhub.scot/geoserver/sh_cpth/wfs';
export const SPATIALHUB_TYPENAME = 'sh_cpth:pub_cpth';

const LA_KEYS = ['local_authority', 'LOCAL_AUTHORITY', 'la_name', 'council', 'authority'];
const REF_KEYS = ['path_ref', 'core_path_ref', 'ref', 'path_id', 'PATH_REF'];
const NAME_KEYS = ['path_name', 'name', 'PATH_NAME', 'route_name'];

export function scottishAuthorityCode(name: string | null): string {
  if (!name) return 'S-ALL';
  const slug = name
    .toUpperCase()
    .replace(/\bCOUNCIL\b|\bCITY OF\b|\bTHE\b/g, '')
    .replace(/[^A-Z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 24);
  return slug ? `S-${slug}` : 'S-ALL';
}

function firstString(props: Record<string, unknown>, keys: string[]): string | null {
  for (const k of keys) {
    const v = props[k];
    if (typeof v === 'string' && v.trim() !== '') return v.trim();
  }
  return null;
}

/** One WFS feature becomes one path per line part; anything without a usable line is dropped. */
export function normaliseCorePathFeature(f: WfsFeature): Array<NormalisedPath & { authorityName: string }> {
  const props = f.properties ?? {};
  const g = f.geometry;
  if (!g) return [];
  const parts: Position[][] = g.type === 'LineString' ? [g.coordinates as Position[]] : g.type === 'MultiLineString' ? (g.coordinates as Position[][]) : [];
  const la = firstString(props, LA_KEYS);
  const out: Array<NormalisedPath & { authorityName: string }> = [];
  for (const coords of parts) {
    if (!Array.isArray(coords) || coords.length < 2 || coords.some((p) => !Number.isFinite(p[0]) || !Number.isFinite(p[1]))) continue;
    out.push({
      authorityCode: scottishAuthorityCode(la),
      authorityName: la ?? 'Scotland (all councils)',
      sourceRef: f.id === undefined ? null : String(f.id),
      pathType: 'core_path',
      routeNo: firstString(props, REF_KEYS),
      routeName: firstString(props, NAME_KEYS),
      parish: null,
      lengthM: Math.round(length(lineString(coords), { units: 'meters' })),
      coordinates: roundCoords(coords),
    });
  }
  return out;
}
