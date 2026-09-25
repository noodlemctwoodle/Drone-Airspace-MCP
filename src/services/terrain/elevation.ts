import type { CacheStore } from '../../core/cache-store.js';
import type { HttpClient } from '../../core/http-client.js';

/**
 * Ground elevation from Open-Meteo's elevation endpoint (Copernicus GLO-90,
 * about 90 m cells). Points snap to 0.001 degrees so nearby requests share a
 * cached cell; misses are batched 100 per request.
 */
export interface LatLon {
  lat: number;
  lon: number;
}

export const ELEVATION_BATCH = 100;

export function parseElevations(raw: unknown, expected: number): Array<number | null> {
  const list = raw && typeof raw === 'object' && Array.isArray((raw as { elevation?: unknown }).elevation) ? ((raw as { elevation: unknown[] }).elevation) : [];
  const out: Array<number | null> = [];
  for (let i = 0; i < expected; i++) {
    const v = list[i];
    out.push(typeof v === 'number' && Number.isFinite(v) ? Math.round(v * 10) / 10 : null);
  }
  return out;
}

export class ElevationClient {
  constructor(
    private readonly http: HttpClient,
    private readonly cache: CacheStore,
    private readonly baseUrl: string,
    private readonly ttlSeconds = 30 * 24 * 3600
  ) {}

  private static key(p: LatLon): string {
    return `elevation:openmeteo:v1:${p.lat.toFixed(3)}:${p.lon.toFixed(3)}`;
  }

  async elevations(points: LatLon[]): Promise<Array<number | null>> {
    const keys = points.map((p) => ElevationClient.key(p));
    const found = new Map<string, number | null>();
    const missing: LatLon[] = [];
    const missingKeys: string[] = [];
    for (let i = 0; i < points.length; i++) {
      const k = keys[i];
      if (found.has(k) || missingKeys.includes(k)) continue;
      const cached = await this.cache.getEntry<number | null>(k);
      if (cached && this.cache.isFresh(cached)) found.set(k, cached.value);
      else {
        missing.push(points[i]);
        missingKeys.push(k);
      }
    }
    for (let start = 0; start < missing.length; start += ELEVATION_BATCH) {
      const chunk = missing.slice(start, start + ELEVATION_BATCH);
      const params = new URLSearchParams({ latitude: chunk.map((p) => p.lat.toFixed(3)).join(','), longitude: chunk.map((p) => p.lon.toFixed(3)).join(',') });
      const { data } = await this.http.getJson<unknown>(`${this.baseUrl}?${params.toString()}`, { provider: 'open-meteo-elevation' });
      const values = parseElevations(data, chunk.length);
      for (let i = 0; i < chunk.length; i++) {
        const k = missingKeys[start + i];
        found.set(k, values[i]);
        if (values[i] !== null) await this.cache.set(k, values[i], this.ttlSeconds);
      }
    }
    return keys.map((k) => found.get(k) ?? null);
  }
}
