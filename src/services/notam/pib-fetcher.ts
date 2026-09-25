import type { CacheStore } from '../../core/cache-store.js';
import { UpstreamError, UserFacingError } from '../../core/errors.js';
import type { HttpClient } from '../../core/http-client.js';
import type { Logger } from '../../core/logger.js';
import { silentLogger } from '../../core/logger.js';

export interface PibDocument {
  xml: string;
  fetchedAt: Date;
  ageSeconds: number;
  stale: boolean;
  lastError: string | null;
  fromCache: boolean;
}

const CACHE_KEY = 'notam:pib:v1';

export class PibFetcher {
  private lastError: string | null = null;

  constructor(
    private readonly http: HttpClient,
    private readonly cache: CacheStore,
    private readonly url: string,
    private readonly ttlSeconds: number,
    private readonly logger: Logger = silentLogger,
    private readonly now: () => Date = () => new Date()
  ) {}

  get status(): { url: string; ttlSeconds: number; lastError: string | null } {
    return { url: this.url, ttlSeconds: this.ttlSeconds, lastError: this.lastError };
  }

  async fetch(): Promise<PibDocument> {
    const entry = await this.cache.getEntry<string>(CACHE_KEY);
    if (entry && this.cache.isFresh(entry)) {
      return { xml: entry.value, fetchedAt: new Date(entry.storedAt), ageSeconds: this.cache.ageSeconds(entry), stale: false, lastError: null, fromCache: true };
    }
    try {
      const res = await this.http.getText(this.url, {
        provider: 'nats-pib',
        etag: entry?.etag,
        lastModified: entry?.lastModified,
        timeoutMs: 30_000,
      });
      this.lastError = null;
      if (res.notModified && entry) {
        await this.cache.touch(CACHE_KEY);
        return { xml: entry.value, fetchedAt: this.now(), ageSeconds: 0, stale: false, lastError: null, fromCache: true };
      }
      if (!res.body.includes('<Pib')) {
        throw new UpstreamError('nats-pib', 'response did not look like a PIB document');
      }
      await this.cache.set(CACHE_KEY, res.body, this.ttlSeconds, { etag: res.etag, lastModified: res.lastModified });
      return { xml: res.body, fetchedAt: this.now(), ageSeconds: 0, stale: false, lastError: null, fromCache: false };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.lastError = message;
      this.logger.warn(`NOTAM bulletin fetch failed: ${message}`);
      if (entry) {
        return { xml: entry.value, fetchedAt: new Date(entry.storedAt), ageSeconds: this.cache.ageSeconds(entry), stale: true, lastError: message, fromCache: true };
      }
      throw new UserFacingError(`NOTAM bulletin unavailable: ${message}`);
    }
  }
}
