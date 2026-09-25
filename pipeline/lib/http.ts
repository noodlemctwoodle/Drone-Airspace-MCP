import { createHash } from 'node:crypto';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { REPO_URL } from '../../src/version.js';

export const BUILD_USER_AGENT = `uk-drone-airspace-pack-builder (+${REPO_URL})`;

export interface FetchCachedOptions {
  cacheDir: string;
  ttlSeconds?: number;
  offline?: boolean;
  fetchImpl?: typeof fetch;
  retries?: number;
  timeoutMs?: number;
  /** Minimum gap between requests to the same host, in ms. */
  politeGapMs?: number;
  binary?: boolean;
}

export interface CachedResponse {
  body: Buffer;
  fromCache: boolean;
  fetchedAt: string;
  etag?: string;
  lastModified?: string;
  status: number;
}

interface CacheMeta {
  url: string;
  fetchedAt: string;
  etag?: string;
  lastModified?: string;
  status: number;
}

const lastRequestByHost = new Map<string, number>();

/**
 * Cache-on-disk fetch for the build pipeline: revalidates with ETag /
 * If-Modified-Since, retries with backoff, throttles per host, and can run
 * fully offline against the cache. Cache files live under build/raw/.
 */
export async function fetchCached(url: string, opts: FetchCachedOptions): Promise<CachedResponse> {
  const key = createHash('sha1').update(url).digest('hex');
  const base = path.join(opts.cacheDir, key);
  const metaPath = `${base}.meta.json`;
  const bodyPath = `${base}.body`;
  let meta: CacheMeta | undefined;
  try {
    meta = JSON.parse(await readFile(metaPath, 'utf8')) as CacheMeta;
  } catch {
    meta = undefined;
  }
  const cachedBody = async () => readFile(bodyPath);
  const ttl = opts.ttlSeconds ?? 0;

  if (meta && (await exists(bodyPath))) {
    const age = (Date.now() - new Date(meta.fetchedAt).getTime()) / 1000;
    if (opts.offline || (ttl > 0 && age < ttl)) {
      return { body: await cachedBody(), fromCache: true, fetchedAt: meta.fetchedAt, etag: meta.etag, lastModified: meta.lastModified, status: meta.status };
    }
  } else if (opts.offline) {
    throw new Error(`offline and no cached copy of ${url}`);
  }

  const fetchImpl = opts.fetchImpl ?? fetch;
  const host = new URL(url).host;
  const gap = opts.politeGapMs ?? 0;
  const retries = opts.retries ?? 3;
  let lastError: unknown;
  for (let attempt = 1; attempt <= retries + 1; attempt += 1) {
    const last = lastRequestByHost.get(host) ?? 0;
    const wait = last + gap - Date.now();
    if (wait > 0) await sleep(wait);
    lastRequestByHost.set(host, Date.now());
    try {
      const headers: Record<string, string> = { 'User-Agent': BUILD_USER_AGENT };
      if (meta?.etag) headers['If-None-Match'] = meta.etag;
      if (meta?.lastModified) headers['If-Modified-Since'] = meta.lastModified;
      const res = await fetchImpl(url, { headers, signal: AbortSignal.timeout(opts.timeoutMs ?? 120_000), redirect: 'follow' });
      if (res.status === 304 && meta) {
        const refreshed: CacheMeta = { ...meta, fetchedAt: new Date().toISOString() };
        await writeFile(metaPath, JSON.stringify(refreshed));
        return { body: await cachedBody(), fromCache: true, fetchedAt: refreshed.fetchedAt, etag: meta.etag, lastModified: meta.lastModified, status: 304 };
      }
      if (res.status === 404) {
        return { body: Buffer.alloc(0), fromCache: false, fetchedAt: new Date().toISOString(), status: 404 };
      }
      if (!res.ok) {
        if ([429, 500, 502, 503, 504].includes(res.status) && attempt <= retries) {
          await sleep(1000 * Math.pow(3, attempt - 1));
          continue;
        }
        throw new Error(`HTTP ${res.status} for ${url}`);
      }
      const body = Buffer.from(await res.arrayBuffer());
      const newMeta: CacheMeta = {
        url,
        fetchedAt: new Date().toISOString(),
        etag: res.headers.get('etag') ?? undefined,
        lastModified: res.headers.get('last-modified') ?? undefined,
        status: res.status,
      };
      await mkdir(opts.cacheDir, { recursive: true });
      await writeFile(bodyPath, body);
      await writeFile(metaPath, JSON.stringify(newMeta));
      return { body, fromCache: false, fetchedAt: newMeta.fetchedAt, etag: newMeta.etag, lastModified: newMeta.lastModified, status: res.status };
    } catch (error) {
      lastError = error;
      if (attempt <= retries) {
        await sleep(1000 * Math.pow(3, attempt - 1));
        continue;
      }
    }
  }
  if (meta && (await exists(bodyPath))) {
    console.error(`[http] WARN using stale cache for ${url}: ${(lastError as Error)?.message}`);
    return { body: await cachedBody(), fromCache: true, fetchedAt: meta.fetchedAt, etag: meta.etag, lastModified: meta.lastModified, status: meta.status };
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

async function exists(p: string): Promise<boolean> {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
