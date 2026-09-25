import type { BBox } from '../../../src/types.js';

/** A GeoJSON feature as GeoServer returns it. */
export interface WfsFeature {
  type: 'Feature';
  id?: string | number;
  geometry: { type: string; coordinates: unknown } | null;
  properties: Record<string, unknown>;
}

export interface WfsOptions {
  fetchText: (url: string) => Promise<string>;
  pageSize?: number;
  bbox?: BBox;
  /** Extra query parameters, for example an auth key. */
  extra?: Record<string, string>;
}

/**
 * Page through a GeoServer WFS 2.0 layer as GeoJSON in WGS84 using
 * `count` and `startIndex`. Stops when a page comes back short or empty.
 * Defensive: a malformed page ends the iteration rather than throwing.
 */
export async function* fetchAllWfsFeatures(baseUrl: string, typeName: string, opts: WfsOptions): AsyncGenerator<WfsFeature> {
  const pageSize = opts.pageSize ?? 1000;
  let start = 0;
  for (;;) {
    const params = new URLSearchParams({
      service: 'WFS',
      version: '2.0.0',
      request: 'GetFeature',
      typeNames: typeName,
      outputFormat: 'application/json',
      srsName: 'EPSG:4326',
      count: String(pageSize),
      startIndex: String(start),
      ...(opts.bbox ? { bbox: `${opts.bbox[1]},${opts.bbox[0]},${opts.bbox[3]},${opts.bbox[2]},EPSG:4326` } : {}),
      ...(opts.extra ?? {}),
    });
    const sep = baseUrl.includes('?') ? '&' : '?';
    let page: { features?: unknown[] };
    try {
      page = JSON.parse(await opts.fetchText(`${baseUrl}${sep}${params.toString()}`)) as { features?: unknown[] };
    } catch {
      return;
    }
    const features = Array.isArray(page.features) ? (page.features as WfsFeature[]) : [];
    for (const f of features) if (f && typeof f === 'object' && 'properties' in f) yield f;
    if (features.length < pageSize) return;
    start += pageSize;
  }
}
