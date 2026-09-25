import { createHash } from 'node:crypto';
import { readFileSync, existsSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import path from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { HttpClient } from '../../src/core/http-client.js';
import { createLogger } from '../../src/core/logger.js';
import { PackManager } from '../../src/pack/loader.js';
import { fetchManifest, parseManifest } from '../../src/pack/manifest.js';
import { fakeFetch, type Route } from '../helpers/fake-fetch.js';
import { tempDir, testConfig } from '../helpers/build-deps.js';
import { buildMiniPack } from '../helpers/mini-pack.js';
import { UpstreamError } from '../../src/core/errors.js';
import { SCHEMA_VERSION } from '../../src/pack/schema.js';

const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex');

function manifestFor(tag: string, sqlite: Buffer, gz: Buffer, schema = SCHEMA_VERSION) {
  return {
    kind: 'uk-drone-airspace-pack',
    manifest_version: 1,
    schema_version: schema,
    tag,
    built_at: '2026-09-25T06:00:00Z',
    build_commit: 'abc',
    region: 'test',
    asset: { name: `${tag}.sqlite.gz`, url: `https://example.test/releases/download/${tag}/${tag}.sqlite.gz`, size_gz: gz.length, size_sqlite: sqlite.length, sha256_gz: sha(gz), sha256_sqlite: sha(sqlite) },
    airac: { effective_from: '2026-09-03', effective_to: '2026-09-30' },
    sources: [],
    counts: {},
  };
}

describe('pack manifest and loader', () => {
  let sqlite: Buffer;
  let gz: Buffer;
  beforeAll(async () => {
    sqlite = readFileSync(await buildMiniPack(tempDir()));
    gz = gzipSync(sqlite);
  });

  const routes = (tag: string, extra: Route[] = []): Route[] => [
    { match: 'manifest.json', body: manifestFor(tag, sqlite, gz) },
    { match: `${tag}.sqlite.gz`, handler: () => ({ status: 200, body: gz.toString('latin1'), headers: { 'content-type': 'application/gzip' } }) },
    ...extra,
  ];

  // Response bodies from fakeFetch are strings; wrap to hand bytes back untouched.
  const binaryFetch = (ff: ReturnType<typeof fakeFetch>) => async (url: string, init?: RequestInit) => {
    if (url.endsWith('.sqlite.gz')) return new Response(new Uint8Array(gz), { status: 200 });
    return ff.fetch(url, init);
  };

  it('validates a manifest and rejects the wrong kind', () => {
    expect(parseManifest(manifestFor('pack-1', sqlite, gz)).tag).toBe('pack-1');
    expect(() => parseManifest({ ...manifestFor('pack-1', sqlite, gz), kind: 'other' })).toThrow();
  });

  it('falls back to the releases list when the latest manifest is incompatible', async () => {
    const ff = fakeFetch([
      { match: 'releases/latest/download/manifest.json', body: manifestFor('code-1', sqlite, gz, 99) },
      { match: 'api.github.com', body: [{ tag_name: 'v0.1.0', draft: false, assets: [] }, { tag_name: 'pack-20260903-7', draft: false, assets: [{ name: 'manifest.json', browser_download_url: 'https://example.test/p7/manifest.json' }] }] },
      { match: 'p7/manifest.json', body: manifestFor('pack-20260903-7', sqlite, gz) },
    ]);
    const http = new HttpClient({ userAgent: 't', fetchImpl: ff.fetch, retries: 0 });
    const m = await fetchManifest(http, 'https://example.test/releases/latest/download/manifest.json', 'https://github.com/o/r');
    expect(m.tag).toBe('pack-20260903-7');
    await expect(fetchManifest(new HttpClient({ userAgent: 't', fetchImpl: async () => new Response('x', { status: 500 }), retries: 0 }), 'https://x/m.json', 'https://github.com/o/r')).rejects.toBeInstanceOf(UpstreamError);
  });

  it('downloads, verifies and installs a pack on first run, then reuses it', async () => {
    const dir = tempDir();
    const config = testConfig({ DRONE_AIRSPACE_CACHE_DIR: dir, PACK_MANIFEST_URL: 'https://example.test/manifest.json' });
    const ff = fakeFetch(routes('pack-20260903-1'));
    const http = new HttpClient({ userAgent: 't', fetchImpl: ff.fetch, retries: 0 });
    const pm = new PackManager({ config, http, logger: createLogger('silent'), fetchImpl: binaryFetch(ff) });
    expect(await pm.init()).toBe(false);
    expect(pm.status().state).toBe('downloading');
    const repo = await pm.ready(10_000);
    expect((await repo.meta()).packTag).toBe('pack-20260903-test');
    expect(pm.status()).toMatchObject({ state: 'ready', tag: 'pack-20260903-1' });
    expect(existsSync(path.join(dir, 'pack.sqlite'))).toBe(true);
    expect(JSON.parse(readFileSync(path.join(dir, 'installed.json'), 'utf8')).tag).toBe('pack-20260903-1');
    pm.close();

    const ff2 = fakeFetch([]);
    const pm2 = new PackManager({ config, http: new HttpClient({ userAgent: 't', fetchImpl: ff2.fetch, retries: 0 }), logger: createLogger('silent'), fetchImpl: ff2.fetch });
    expect(await pm2.init()).toBe(true);
    expect((await pm2.require().meta()).packTag).toBe('pack-20260903-test');
    expect(ff2.calls.length).toBe(0);
    pm2.close();
  });

  it('rejects a hash mismatch and leaves no pack behind', async () => {
    const dir = tempDir();
    const config = testConfig({ DRONE_AIRSPACE_CACHE_DIR: dir, PACK_MANIFEST_URL: 'https://example.test/manifest.json' });
    const bad = { ...manifestFor('pack-bad', sqlite, gz), asset: { ...manifestFor('pack-bad', sqlite, gz).asset, sha256_sqlite: 'f'.repeat(64) } };
    const ff = fakeFetch([{ match: 'manifest.json', body: bad }]);
    const pm = new PackManager({ config, http: new HttpClient({ userAgent: 't', fetchImpl: ff.fetch, retries: 0 }), logger: createLogger('silent'), fetchImpl: binaryFetch(ff) });
    await pm.init();
    await expect(pm.ready(10_000)).rejects.toThrow(/download failed/);
    expect(existsSync(path.join(dir, 'pack.sqlite'))).toBe(false);
    expect(existsSync(path.join(dir, 'pack.sqlite.part'))).toBe(false);
  });

  it('hot-swaps to a newer pack on a stale check', async () => {
    const dir = tempDir();
    const config = testConfig({ DRONE_AIRSPACE_CACHE_DIR: dir, PACK_MANIFEST_URL: 'https://example.test/manifest.json', PACK_STALE_HOURS: '1' });
    let tag = 'pack-20260903-1';
    const ff = fakeFetch([{ match: 'manifest.json', handler: () => ({ body: manifestFor(tag, sqlite, gz) }) }]);
    const now = { t: new Date('2026-09-25T12:00:00Z') };
    const pm = new PackManager({ config, http: new HttpClient({ userAgent: 't', fetchImpl: ff.fetch, retries: 0 }), logger: createLogger('silent'), fetchImpl: binaryFetch(ff), now: () => now.t });
    await pm.init();
    await pm.ready(10_000);
    tag = 'pack-20261001-2';
    now.t = new Date('2026-09-26T12:00:00Z');
    await pm.checkForUpdate();
    expect(pm.status()).toMatchObject({ state: 'ready', tag: 'pack-20261001-2' });
    pm.close();
  });

  it('honours PACK_PATH and reports a missing file clearly', async () => {
    const good = await buildMiniPack(tempDir());
    const pm = new PackManager({ config: testConfig({ PACK_PATH: good }), http: new HttpClient({ userAgent: 't', retries: 0 }), logger: createLogger('silent') });
    expect(await pm.init()).toBe(true);
    pm.close();
    const bad = new PackManager({ config: testConfig({ PACK_PATH: '/nonexistent/pack.sqlite' }), http: new HttpClient({ userAgent: 't', retries: 0 }), logger: createLogger('silent') });
    expect(await bad.init()).toBe(false);
    expect(bad.status()).toMatchObject({ state: 'unavailable' });
    expect(() => bad.require()).toThrow(/PACK_PATH/);
  });
});
