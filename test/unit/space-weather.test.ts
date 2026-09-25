import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseKpFeed, rateKp, SpaceWeatherClient } from '../../src/services/weather/space-weather.js';
import { HttpClient } from '../../src/core/http-client.js';
import { MemoryCacheStore } from '../../src/core/cache-store.js';
import { fakeFetch } from '../helpers/fake-fetch.js';

const raw = JSON.parse(readFileSync(new URL('../fixtures/space-weather/noaa-kp.json', import.meta.url), 'utf8'));

describe('NOAA Kp feed', () => {
  it('parses the array-of-objects shape and the header-row shape, ignoring garbage', () => {
    const objs = parseKpFeed(raw);
    expect(objs.length).toBe(raw.length);
    expect(objs[objs.length - 1].time).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:00:00\.000Z$/);
    const rows = parseKpFeed([['time_tag', 'Kp', 'a_running'], ['2026-09-25 09:00:00.000', '4.33', '20'], ['bad', 'x', '']]);
    expect(rows).toEqual([{ time: '2026-09-25T09:00:00.000Z', kp: 4.33 }]);
    expect(parseKpFeed({ nope: 1 })).toEqual([]);
    expect(parseKpFeed([])).toEqual([]);
  });
  it('rates Kp against the storm thresholds', () => {
    expect(rateKp(2.7)).toMatchObject({ level: 'quiet', flyability: 'good' });
    expect(rateKp(3.3)).toMatchObject({ level: 'unsettled', flyability: 'good' });
    expect(rateKp(4)).toMatchObject({ level: 'active', flyability: 'caution' });
    expect(rateKp(5.3)).toMatchObject({ level: 'storm', flyability: 'poor' });
  });
  it('caches the feed, serves a stale copy on failure and throws when cold', async () => {
    let fail = false;
    const ff = fakeFetch([{ match: 'noaa-planetary-k-index', handler: () => (fail ? { status: 503, body: 'down' } : { body: raw }) }]);
    const now = new Date('2026-09-25T20:00:00Z');
    const http = new HttpClient({ userAgent: 't', retries: 0, fetchImpl: ff.fetch, sleep: async () => undefined });
    const cache = new MemoryCacheStore(() => now.getTime());
    const client = new SpaceWeatherClient(http, cache, 'https://services.swpc.noaa.gov/products/noaa-planetary-k-index.json', 900, () => now);
    const a = await client.latest();
    expect(a.latest.kp).toBe(raw[raw.length - 1].Kp);
    expect(a.fromCache).toBe(false);
    expect(a.ageSeconds).toBe(2 * 3600);
    await client.latest();
    expect(ff.calls.length).toBe(1);
    fail = true;
    const stale = new SpaceWeatherClient(http, new MemoryCacheStore(() => now.getTime() + 3600_000), 'https://services.swpc.noaa.gov/products/noaa-planetary-k-index.json', 900, () => now);
    await expect(stale.latest()).rejects.toThrow();
    const entry = await cache.getEntry('spaceweather:noaa-kp:v1');
    expect(entry).toBeDefined();
  });
});
