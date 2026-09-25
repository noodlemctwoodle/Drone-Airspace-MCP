export interface CacheEntry<T> {
  key: string;
  storedAt: number;
  ttlSeconds: number;
  etag?: string;
  lastModified?: string;
  value: T;
}

export interface CacheMeta {
  etag?: string;
  lastModified?: string;
}

/**
 * Key/value cache with TTL used for geocodes and the NOTAM bulletin.
 * Implementations: DiskCache (node), KvCacheStore (Cloudflare Workers KV),
 * MemoryCacheStore (tests). Every read and write must be defensive.
 */
export interface CacheStore {
  getEntry<T>(key: string): Promise<CacheEntry<T> | undefined>;
  get<T>(key: string): Promise<T | undefined>;
  set<T>(key: string, value: T, ttlSeconds: number, meta?: CacheMeta): Promise<void>;
  touch(key: string): Promise<void>;
  isFresh(entry: CacheEntry<unknown>): boolean;
  ageSeconds(entry: CacheEntry<unknown>): number;
}

export class MemoryCacheStore implements CacheStore {
  private readonly map = new Map<string, CacheEntry<unknown>>();
  constructor(private readonly now: () => number = () => Date.now()) {}
  async getEntry<T>(key: string): Promise<CacheEntry<T> | undefined> {
    return this.map.get(key) as CacheEntry<T> | undefined;
  }
  async get<T>(key: string): Promise<T | undefined> {
    const e = await this.getEntry<T>(key);
    return e && this.isFresh(e) ? e.value : undefined;
  }
  async set<T>(key: string, value: T, ttlSeconds: number, meta: CacheMeta = {}): Promise<void> {
    this.map.set(key, { key, storedAt: this.now(), ttlSeconds, value, ...meta });
  }
  async touch(key: string): Promise<void> {
    const e = this.map.get(key);
    if (e) e.storedAt = this.now();
  }
  isFresh(entry: CacheEntry<unknown>): boolean {
    return this.now() - entry.storedAt < entry.ttlSeconds * 1000;
  }
  ageSeconds(entry: CacheEntry<unknown>): number {
    return Math.max(0, Math.floor((this.now() - entry.storedAt) / 1000));
  }
}
