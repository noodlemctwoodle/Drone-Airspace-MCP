import type { CacheStore } from '../../core/cache-store.js';
import { UpstreamError, UserFacingError } from '../../core/errors.js';
import type { Logger } from '../../core/logger.js';
import { silentLogger } from '../../core/logger.js';
import type { GeocodeResult } from '../../types.js';
import type { GeocodeProvider } from './provider.js';
import { normaliseQuery } from './query-normaliser.js';

export interface GeocoderOptions {
  providers: GeocodeProvider[];
  cache?: CacheStore;
  cacheTtlSeconds?: number;
  emptyTtlSeconds?: number;
  logger?: Logger;
}

const CACHE_VERSION = 'v1';

/**
 * Provider chain: the first provider that can handle the query and returns at
 * least one candidate wins. Later attempts from the query normaliser are only
 * tried when the primary query finds nothing anywhere.
 */
export class Geocoder {
  private readonly providers: GeocodeProvider[];
  private readonly cache?: CacheStore;
  private readonly ttl: number;
  private readonly emptyTtl: number;
  private readonly logger: Logger;

  constructor(opts: GeocoderOptions) {
    this.providers = opts.providers;
    this.cache = opts.cache;
    this.ttl = opts.cacheTtlSeconds ?? 30 * 24 * 3600;
    this.emptyTtl = opts.emptyTtlSeconds ?? 24 * 3600;
    this.logger = opts.logger ?? silentLogger;
  }

  get providerNames(): string[] {
    return this.providers.map((p) => p.name);
  }

  async geocode(rawQuery: string, limit = 5): Promise<GeocodeResult> {
    const { cacheKey, attempts } = normaliseQuery(rawQuery);
    if (attempts.length === 0) {
      return { query: rawQuery, usedQuery: rawQuery, usedFallback: false, candidates: [], providersTried: [] };
    }
    const key = `geocode:${CACHE_VERSION}:${limit}:${cacheKey}`;
    const cached = await this.cache?.get<GeocodeResult>(key);
    if (cached) return cached;

    const providersTried: string[] = [];
    const outages: UpstreamError[] = [];
    for (const [index, attempt] of attempts.entries()) {
      for (const provider of this.providers) {
        if (!provider.canHandle(attempt)) continue;
        providersTried.push(provider.name);
        try {
          const candidates = await provider.search(attempt, limit);
          if (candidates.length > 0) {
            const result: GeocodeResult = {
              query: rawQuery,
              usedQuery: attempt,
              usedFallback: index > 0,
              candidates: candidates.slice(0, limit),
              providersTried,
            };
            await this.cache?.set(key, result, this.ttl);
            return result;
          }
        } catch (error) {
          if (error instanceof UpstreamError) {
            this.logger.warn(`geocoder ${provider.name} failed: ${error.message}`);
            outages.push(error);
            continue;
          }
          throw error;
        }
      }
    }
    const anySucceeded = providersTried.length > outages.length;
    if (!anySucceeded && outages.length > 0) {
      const first = outages[0];
      throw new UserFacingError(`Geocoding is unavailable right now (${first.message}). Give lat/lon instead.`);
    }
    const empty: GeocodeResult = { query: rawQuery, usedQuery: attempts[0], usedFallback: false, candidates: [], providersTried };
    await this.cache?.set(key, empty, this.emptyTtl);
    return empty;
  }
}
