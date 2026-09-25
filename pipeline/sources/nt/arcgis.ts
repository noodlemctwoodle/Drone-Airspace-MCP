import simplify from '@turf/simplify';
import booleanValid from '@turf/boolean-valid';
import type { BBox, MultiPolygon, Polygon } from '../../../src/types.js';
import { roundGeometry } from '../../lib/geometry.js';

export interface ArcgisFeature {
  type: 'Feature';
  id?: number | string;
  geometry: Polygon | MultiPolygon | null;
  properties: Record<string, unknown>;
}

interface LayerInfo {
  maxRecordCount?: number;
  objectIdField?: string;
  editingInfo?: { lastEditDate?: number; dataLastEditDate?: number };
  advancedQueryCapabilities?: { supportsPagination?: boolean };
  name?: string;
}

export interface FetchFeaturesOptions {
  pageSize?: number;
  bbox?: BBox;
  fetchText: (url: string) => Promise<string>;
}

export async function layerInfo(layerUrl: string, fetchText: (url: string) => Promise<string>): Promise<LayerInfo> {
  return JSON.parse(await fetchText(`${layerUrl}?f=json`)) as LayerInfo;
}

/** Page through an ArcGIS FeatureServer layer as GeoJSON in WGS84. */
export async function* fetchAllFeatures(layerUrl: string, opts: FetchFeaturesOptions): AsyncGenerator<ArcgisFeature> {
  const info = await layerInfo(layerUrl, opts.fetchText);
  const pageSize = Math.min(opts.pageSize ?? 1000, info.maxRecordCount ?? 1000);
  let offset = 0;
  for (;;) {
    const params = new URLSearchParams({
      where: '1=1',
      outFields: '*',
      outSR: '4326',
      f: 'geojson',
      // Stable paging needs an order; the id field is OBJECTID on most layers but FID on ONS ones.
      orderByFields: info.objectIdField ?? 'OBJECTID',
      resultOffset: String(offset),
      resultRecordCount: String(pageSize),
    });
    if (opts.bbox) {
      params.set('geometry', opts.bbox.join(','));
      params.set('geometryType', 'esriGeometryEnvelope');
      params.set('inSR', '4326');
      params.set('spatialRel', 'esriSpatialRelIntersects');
    }
    const text = await opts.fetchText(`${layerUrl}/query?${params.toString()}`);
    const page = JSON.parse(text) as { features?: ArcgisFeature[]; properties?: { exceededTransferLimit?: boolean }; error?: { message?: string } };
    if (page.error) throw new Error(`ArcGIS error: ${page.error.message ?? 'unknown'}`);
    const features = Array.isArray(page.features) ? page.features : [];
    for (const f of features) yield f;
    if (features.length < pageSize && !page.properties?.exceededTransferLimit) break;
    if (features.length === 0) break;
    offset += features.length;
  }
}

export interface NormalisedRestriction {
  /** Defaults to 'site'; 'authority' marks a council-wide policy note carried on the council boundary. */
  scope?: 'site' | 'authority';
  sourceId: string;
  entryId: string | null;
  kind: 'landowner' | 'byelaw' | 'pspo' | 'policy';
  owner: string;
  name: string;
  accessClass: string | null;
  takeoffBanned: boolean;
  landingBanned: boolean | null;
  summary: string | null;
  sourceUrl: string | null;
  lastVerified: string | null;
  props: Record<string, unknown> | null;
  geometry: Polygon | MultiPolygon;
}

const NAME_KEYS = ['Name', 'NAME', 'name', 'Property', 'PROPERTY', 'SiteName', 'Site_Name', 'Title'];
export const NT_SUMMARY = 'National Trust byelaws prohibit taking off or landing unmanned aircraft on Trust land without the Trust\'s permission.';
export const NT_POLICY_URL = 'https://www.nationaltrust.org.uk/who-we-are/about-us/flying-drones-at-our-places';

export function normaliseNtFeature(f: ArcgisFeature, sourceId: string, accessClass: 'always_open' | 'limited_access', layerUrl: string, fetchedAt: string): NormalisedRestriction | undefined {
  const g = f.geometry;
  if (!g || (g.type !== 'Polygon' && g.type !== 'MultiPolygon')) return undefined;
  let geometry: Polygon | MultiPolygon = g;
  try {
    const simplified = simplify(g, { tolerance: 0.000018, highQuality: false }) as Polygon | MultiPolygon;
    if (booleanValid(simplified)) geometry = simplified;
  } catch {
    geometry = g;
  }
  geometry = roundGeometry(geometry);
  const props = f.properties ?? {};
  let name = 'National Trust land';
  for (const k of NAME_KEYS) {
    const v = props[k];
    if (typeof v === 'string' && v.trim() !== '') {
      name = v.trim();
      break;
    }
  }
  const idValue = props.OBJECTID ?? props.FID ?? props.ID ?? f.id;
  const lastUpdated = typeof props.LastUpdated === 'number' ? new Date(props.LastUpdated).toISOString().slice(0, 10) : fetchedAt.slice(0, 10);
  return {
    sourceId,
    entryId: idValue === undefined || idValue === null ? null : String(idValue),
    kind: 'landowner',
    owner: 'National Trust',
    name,
    accessClass,
    takeoffBanned: true,
    landingBanned: true,
    summary: NT_SUMMARY,
    sourceUrl: NT_POLICY_URL,
    lastVerified: lastUpdated,
    props: { layer: layerUrl, ...props },
    geometry,
  };
}
