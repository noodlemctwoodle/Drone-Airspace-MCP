import type { CacheEntry, CacheMeta, CacheStore } from '../core/cache-store.js';
import type { KVLike } from './env.js';

/**
 * CacheStore over Workers KV. Entries are JSON; KV expiry is set to the TTL
 * plus a grace period so stale entries can still be served on upstream errors.
 */
export class KvCacheStore implements CacheStore {
  constructor(
    private readonly kv: KVLike,
    private readonly now: () => number = () => Date.now(),
    private readonly graceSeconds = 6 * 3600
  ) {}

  async getEntry<T>(key: string): Promise<CacheEntry<T> | undefined> {
    try {
      const raw = await this.kv.get(key, 'text');
      if (!raw) return undefined;
      const entry = JSON.parse(raw) as CacheEntry<T>;
      return entry && entry.key === key && typeof entry.storedAt === 'number' ? entry : undefined;
    } catch {
      return undefined;
    }
  }

  async get<T>(key: string): Promise<T | undefined> {
    const e = await this.getEntry<T>(key);
    return e && this.isFresh(e) ? e.value : undefined;
  }

  async set<T>(key: string, value: T, ttlSeconds: number, meta: CacheMeta = {}): Promise<void> {
    const entry: CacheEntry<T> = { key, storedAt: this.now(), ttlSeconds, value, ...meta };
    try {
      await this.kv.put(key, JSON.stringify(entry), { expirationTtl: Math.max(60, ttlSeconds + this.graceSeconds) });
    } catch {
      // best effort
    }
  }

  async touch(key: string): Promise<void> {
    const e = await this.getEntry(key);
    if (e) await this.set(key, e.value, e.ttlSeconds, { etag: e.etag, lastModified: e.lastModified });
  }

  isFresh(entry: CacheEntry<unknown>): boolean {
    return this.now() - entry.storedAt < entry.ttlSeconds * 1000;
  }

  ageSeconds(entry: CacheEntry<unknown>): number {
    return Math.max(0, Math.floor((this.now() - entry.storedAt) / 1000));
  }
}
