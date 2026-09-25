import type { AdminKind, Country, MultiPolygon, Polygon } from '../../../src/types.js';
import { roundGeometry } from '../../lib/geometry.js';

/** One local authority district boundary from the ONS open geography portal. */
export interface NormalisedAdminArea {
  code: string;
  name: string;
  kind: AdminKind;
  country: Country | null;
  geometry: Polygon | MultiPolygon;
}

/** ONS Local Authority Districts, super-generalised (BSC, about 200 m). The service name carries the vintage. */
export const ONS_LAD_URL = 'https://services1.arcgis.com/ESMARspQHYMw9BZ9/arcgis/rest/services/Local_Authority_Districts_May_2026_Boundaries_UK_BSC/FeatureServer/0';

const PREFIX_TO_COUNTRY: Record<string, Country> = { E: 'england', W: 'wales', S: 'scotland', N: 'northern_ireland' };

/** GeoJSON features from the layer; any LADnnCD / LADnnNM field name works so the annual rename does not break the parser. */
export function parseLadFeature(f: { geometry?: Polygon | MultiPolygon | null; properties?: Record<string, unknown> }): NormalisedAdminArea | undefined {
  const props = f.properties ?? {};
  const codeKey = Object.keys(props).find((k) => /^LAD\d{2}CD$/.test(k));
  const nameKey = Object.keys(props).find((k) => /^LAD\d{2}NM$/.test(k));
  if (!codeKey || !nameKey) return undefined;
  const code = String(props[codeKey] ?? '').trim();
  const name = String(props[nameKey] ?? '').trim();
  if (!/^[ENSW]\d{8}$/.test(code) || name === '' || !f.geometry || (f.geometry.type !== 'Polygon' && f.geometry.type !== 'MultiPolygon')) return undefined;
  return { code, name, kind: 'lad', country: PREFIX_TO_COUNTRY[code[0]] ?? null, geometry: roundGeometry(f.geometry) };
}

export function parseLads(json: unknown): NormalisedAdminArea[] {
  const features = (json as { features?: Array<{ geometry?: Polygon | MultiPolygon | null; properties?: Record<string, unknown> }> })?.features ?? [];
  return features.map(parseLadFeature).filter((a): a is NormalisedAdminArea => a !== undefined);
}
