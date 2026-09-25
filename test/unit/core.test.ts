import { describe, expect, it } from 'vitest';
import { loadConfig, parseCliArgs } from '../../src/core/config.js';
import { DiskCache } from '../../src/core/disk-cache.js';
import { HttpClient } from '../../src/core/http-client.js';
import { TokenBucket } from '../../src/core/rate-limiter.js';
import { UpstreamError } from '../../src/core/errors.js';
import { fakeFetch } from '../helpers/fake-fetch.js';
import { tempDir } from '../helpers/build-deps.js';
import { formatDistance, formatLimit, formatLimits } from '../../src/formatters/units.js';
import { renderReport } from '../../src/formatters/report.js';

describe('config', () => {
  it('applies defaults and cli overrides', () => {
    const c = loadConfig({}, { transport: 'http', port: 9090 });
    expect(c.transport).toBe('http');
    expect(c.port).toBe(9090);
    expect(c.notamCacheTtlSeconds).toBe(1800);
    expect(c.packManifestUrl).toContain('releases/latest/download/manifest.json');
    expect(c.osNamesApiKey).toBeUndefined();
  });
  it('names the offending variable', () => {
    expect(() => loadConfig({ NOTAM_CACHE_TTL_SECONDS: 'abc' })).toThrow(/NOTAM_CACHE_TTL_SECONDS/);
    expect(() => loadConfig({ MCP_TRANSPORT: 'carrier-pigeon' })).toThrow(/MCP_TRANSPORT/);
  });
  it('parses cli args', () => {
    expect(parseCliArgs(['--transport', 'http', '--port', '8081'])).toMatchObject({ transport: 'http', port: 8081 });
    expect(() => parseCliArgs(['--transport', 'sse'])).toThrow(/--transport/);
    expect(() => parseCliArgs(['--port', 'x'])).toThrow(/--port/);
  });
});

describe('TokenBucket', () => {
  it('spaces requests at the configured rate', async () => {
    let t = 0;
    const slept: number[] = [];
    const bucket = new TokenBucket(1, 1, () => t, async (ms) => {
      slept.push(ms);
      t += ms;
    });
    await bucket.acquire();
    await bucket.acquire();
    await bucket.acquire();
    expect(slept.length).toBe(2);
    expect(slept[0]).toBeGreaterThanOrEqual(999);
  });
});

describe('DiskCache', () => {
  it('round-trips, honours ttl, and treats corruption as a miss', async () => {
    let now = 1_000_000;
    const cache = new DiskCache(tempDir(), () => now);
    await cache.set('k', { a: 1 }, 60);
    expect(await cache.get('k')).toEqual({ a: 1 });
    now += 61_000;
    expect(await cache.get('k')).toBeUndefined();
    expect((await cache.getEntry('k'))?.value).toEqual({ a: 1 });
    expect(await cache.get('missing')).toBeUndefined();
  });
});

describe('HttpClient', () => {
  it('sets the user agent, retries on 503 and surfaces 404 as UpstreamError', async () => {
    let n = 0;
    const ff = fakeFetch([
      { match: 'flaky', handler: () => (++n < 2 ? { status: 503, body: 'busy' } : { status: 200, body: { ok: true } }) },
      { match: 'gone', status: 404, body: 'nope' },
    ]);
    const http = new HttpClient({ userAgent: 'ua/1', fetchImpl: ff.fetch, retries: 2, sleep: async () => undefined });
    const { data } = await http.getJson<{ ok: boolean }>('https://x/flaky');
    expect(data.ok).toBe(true);
    expect((ff.calls[0].init?.headers as Record<string, string>)['User-Agent']).toBe('ua/1');
    await expect(http.getText('https://x/gone')).rejects.toBeInstanceOf(UpstreamError);
  });
  it('passes conditional headers and reports 304', async () => {
    const ff = fakeFetch([{ match: 'etag', status: 304, body: '' }]);
    const http = new HttpClient({ userAgent: 'ua', fetchImpl: ff.fetch, retries: 0 });
    const res = await http.getText('https://x/etag', { etag: '"abc"' });
    expect(res.notModified).toBe(true);
    expect((ff.calls[0].init?.headers as Record<string, string>)['If-None-Match']).toBe('"abc"');
  });
});

describe('formatters', () => {
  it('formats distances and limits', () => {
    expect(formatDistance(350)).toBe('350 m');
    expect(formatDistance(1440)).toBe('1.4 km');
    expect(formatLimit({ ft: 0, ref: 'sfc', raw: 'SFC' })).toBe('SFC');
    expect(formatLimit({ ft: 5500, ref: 'fl', raw: 'FL55' })).toBe('FL 55');
    expect(formatLimits({ ft: 0, ref: 'sfc', raw: null }, { ft: 2000, ref: 'amsl', raw: null })).toBe('SFC to 2,000 ft AMSL');
    expect(formatLimit({ ft: null, ref: null, raw: null })).toBe('unknown');
  });
  it('renders a report and omits empty sections', () => {
    const text = renderReport({ headline: 'H', sections: [{ title: 'Empty', lines: [] }, { title: 'S', lines: ['a'] }], caveats: ['c'], attribution: ['x'] });
    expect(text).toBe('H\n\nS\n  a\n\nCaveats\n  - c\n\nAttribution: x');
  });
});
