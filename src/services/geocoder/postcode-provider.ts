import type { HttpClient } from '../../core/http-client.js';
import { UpstreamError } from '../../core/errors.js';
import type { GeocodeCandidate } from '../../types.js';
import type { GeocodeProvider } from './provider.js';

export const FULL_POSTCODE = /^[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}$/i;
export const OUTCODE = /^[A-Z]{1,2}\d[A-Z\d]?$/i;

interface PostcodeResult {
  postcode?: string;
  outcode?: string;
  latitude: number | null;
  longitude: number | null;
  admin_district?: string | null;
  region?: string | null;
  country?: string | null;
  admin_ward?: string | null;
}

export class PostcodeProvider implements GeocodeProvider {
  readonly name = 'postcodes.io';

  constructor(
    private readonly http: HttpClient,
    private readonly baseUrl: string
  ) {}

  canHandle(query: string): boolean {
    const q = query.trim();
    return FULL_POSTCODE.test(q) || OUTCODE.test(q);
  }

  async search(query: string): Promise<GeocodeCandidate[]> {
    const q = query.trim().toUpperCase();
    const isFull = FULL_POSTCODE.test(q);
    const path = isFull ? `/postcodes/${encodeURIComponent(q.replace(/\s+/g, ''))}` : `/outcodes/${encodeURIComponent(q)}`;
    let data: { status?: number; result?: PostcodeResult | null } | undefined;
    try {
      data = (await this.http.getJson<{ status?: number; result?: PostcodeResult | null }>(`${this.baseUrl}${path}`, { provider: this.name })).data;
    } catch (error) {
      if (error instanceof UpstreamError && error.status === 404) return [];
      throw error;
    }
    const r = data?.result;
    if (!r || typeof r.latitude !== 'number' || typeof r.longitude !== 'number') return [];
    const first = (v: unknown): string | undefined => (Array.isArray(v) ? first(v[0]) : typeof v === 'string' && v.trim() !== '' ? v : undefined);
    const nameParts = [first(r.postcode ?? r.outcode), first(r.admin_district) ?? first(r.admin_ward), first(r.region) ?? first(r.country)].filter(
      (p): p is string => typeof p === 'string'
    );
    return [
      {
        name: nameParts.join(', '),
        lat: r.latitude,
        lon: r.longitude,
        source: 'postcodes.io',
        confidence: isFull ? 1 : 0.6,
        type: isFull ? 'postcode' : 'outcode centroid',
      },
    ];
  }
}
