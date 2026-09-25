import type { HttpClient } from '../../core/http-client.js';
import type { TokenBucket } from '../../core/rate-limiter.js';
import type { GeocodeCandidate } from '../../types.js';
import { clamp01, type GeocodeProvider } from './provider.js';

interface NominatimResult {
  lat?: string;
  lon?: string;
  display_name?: string;
  importance?: number;
  boundingbox?: [string, string, string, string];
  type?: string;
  class?: string;
}

export class NominatimProvider implements GeocodeProvider {
  readonly name = 'nominatim';

  constructor(
    private readonly http: HttpClient,
    private readonly baseUrl: string,
    private readonly bucket: TokenBucket
  ) {}

  canHandle(): boolean {
    return true;
  }

  async search(query: string, limit: number): Promise<GeocodeCandidate[]> {
    await this.bucket.acquire();
    const url = `${this.baseUrl}?format=jsonv2&countrycodes=gb&limit=${Math.min(10, Math.max(1, limit))}&q=${encodeURIComponent(query)}`;
    const { data } = await this.http.getJson<NominatimResult[]>(url, {
      provider: this.name,
      headers: { 'Accept-Language': 'en-GB' },
    });
    if (!Array.isArray(data)) return [];
    const out: GeocodeCandidate[] = [];
    for (const r of data) {
      const lat = Number(r?.lat);
      const lon = Number(r?.lon);
      if (!Number.isFinite(lat) || !Number.isFinite(lon) || !r.display_name) continue;
      const candidate: GeocodeCandidate = {
        name: r.display_name,
        lat,
        lon,
        source: 'nominatim',
        confidence: clamp01(typeof r.importance === 'number' ? r.importance : 0.3),
        type: [r.class, r.type].filter(Boolean).join('/') || undefined,
      };
      if (Array.isArray(r.boundingbox) && r.boundingbox.length === 4) {
        const [s, n, w, e] = r.boundingbox.map(Number);
        if ([s, n, w, e].every(Number.isFinite)) candidate.bbox = [w, s, e, n];
      }
      out.push(candidate);
    }
    return out;
  }
}
