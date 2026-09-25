import simplify from '@turf/simplify';
import type { Country, MultiPolygon, Polygon } from '../../../src/types.js';
import { roundGeometry } from '../../lib/geometry.js';

export const ONS_COUNTRIES_URL =
  'https://services1.arcgis.com/ESMARspQHYMw9BZ9/arcgis/rest/services/Countries_December_2024_Boundaries_UK_BUC/FeatureServer/0/query?where=1%3D1&outFields=*&outSR=4326&f=geojson';

const NAME_TO_COUNTRY: Record<string, Country> = {
  england: 'england',
  wales: 'wales',
  scotland: 'scotland',
  'northern ireland': 'northern_ireland',
};

export interface CountryPolygon {
  country: Country;
  geometry: Polygon | MultiPolygon;
}

/** ONS "BUC" (ultra-generalised) country boundaries. Any CTRYnnNM field name works. */
export function parseCountries(json: unknown): CountryPolygon[] {
  const out: CountryPolygon[] = [];
  const features = (json as { features?: Array<{ geometry?: Polygon | MultiPolygon; properties?: Record<string, unknown> }> })?.features ?? [];
  for (const f of features) {
    const props = f.properties ?? {};
    const nameKey = Object.keys(props).find((k) => /^CTRY\d{2}NM$/.test(k)) ?? 'CTRY24NM';
    const name = String(props[nameKey] ?? '').trim().toLowerCase();
    const country = NAME_TO_COUNTRY[name];
    if (!country || !f.geometry || (f.geometry.type !== 'Polygon' && f.geometry.type !== 'MultiPolygon')) continue;
    let geometry = f.geometry;
    try {
      geometry = simplify(f.geometry, { tolerance: 0.001, highQuality: false }) as Polygon | MultiPolygon;
    } catch {
      geometry = f.geometry;
    }
    out.push({ country, geometry: roundGeometry(geometry) });
  }
  return out;
}
