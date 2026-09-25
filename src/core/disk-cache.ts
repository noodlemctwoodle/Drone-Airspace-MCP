import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';

import type { CacheEntry, CacheMeta, CacheStore } from './cache-store.js';

export type { CacheEntry, CacheMeta } from './cache-store.js';

/**
 * Small JSON-on-disk cache. Every read and write is defensive: a missing,
 * corrupt or unreadable file is a miss, never an exception.
 */
export class DiskCache implements CacheStore {
  constructor(
    private readonly dir: string,
    private readonly now: () => number = () => Date.now()
  ) {}

  private fileFor(key: string): string {
    const hash = createHash('sha1').update(key).digest('hex');
    return path.join(this.dir, `${hash}.json`);
  }

  async getEntry<T>(key: string): Promise<CacheEntry<T> | undefined> {
    try {
      const raw = await fs.readFile(this.fileFor(key), 'utf8');
      const entry = JSON.parse(raw) as CacheEntry<T>;
      if (!entry || entry.key !== key || typeof entry.storedAt !== 'number') return undefined;
      return entry;
    } catch {
      return undefined;
    }
  }

  /** Returns the value only if it is still within its TTL. */
  async get<T>(key: string): Promise<T | undefined> {
    const entry = await this.getEntry<T>(key);
    if (!entry) return undefined;
    if (this.isFresh(entry)) return entry.value;
    return undefined;
  }

  isFresh(entry: CacheEntry<unknown>): boolean {
    return this.now() - entry.storedAt < entry.ttlSeconds * 1000;
  }

  ageSeconds(entry: CacheEntry<unknown>): number {
    return Math.max(0, Math.floor((this.now() - entry.storedAt) / 1000));
  }

  async set<T>(key: string, value: T, ttlSeconds: number, meta: CacheMeta = {}): Promise<void> {
    const entry: CacheEntry<T> = { key, storedAt: this.now(), ttlSeconds, value, ...meta };
    try {
      await fs.mkdir(this.dir, { recursive: true });
      const file = this.fileFor(key);
      const tmp = `${file}.${process.pid}.tmp`;
      await fs.writeFile(tmp, JSON.stringify(entry), 'utf8');
      await fs.rename(tmp, file);
    } catch {
      // Cache writes are best effort.
    }
  }

  /** Refresh storedAt without changing the value (used after an HTTP 304). */
  async touch(key: string): Promise<void> {
    const entry = await this.getEntry(key);
    if (!entry) return;
    await this.set(key, entry.value, entry.ttlSeconds, { etag: entry.etag, lastModified: entry.lastModified });
  }
}
