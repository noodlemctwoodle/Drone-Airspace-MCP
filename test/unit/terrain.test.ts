import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ElevationClient, parseElevations } from '../../src/services/terrain/elevation.js';
import { analyseTerrain, bearingDeg, gridAround } from '../../src/services/terrain/profile.js';
import { sampleAlongLine, toLineString } from '../../src/services/airspace/geometry.js';
import { HttpClient } from '../../src/core/http-client.js';
import { MemoryCacheStore } from '../../src/core/cache-store.js';
import { fakeFetch } from '../helpers/fake-fetch.js';

const raw = JSON.parse(readFileSync(new URL('../fixtures/elevation/open-meteo-elevation.json', import.meta.url), 'utf8'));

describe('elevation client', () => {
  it('parses a real response and pads or nulls bad values', () => {
    expect(parseElevations(raw, 3)).toEqual([0, 0, 108]);
    expect(parseElevations(raw, 4)[3]).toBeNull();
    expect(parseElevations({ elevation: ['x', 5] }, 2)).toEqual([null, 5]);
    expect(parseElevations('nope', 2)).toEqual([null, null]);
  });
  it('batches 100 points per request and caches per cell', async () => {
    const ff = fakeFetch([{ match: 'v1/elevation', handler: (url) => ({ body: { elevation: new URL(url).searchParams.get('latitude')!.split(',').map((la) => Number(la) * 10) } }) }]);
    const http = new HttpClient({ userAgent: 't', retries: 0, fetchImpl: ff.fetch, sleep: async () => undefined });
    const client = new ElevationClient(http, new MemoryCacheStore(), 'https://api.open-meteo.com/v1/elevation');
    const pts = Array.from({ length: 150 }, (_, i) => ({ lat: 50 + i * 0.01, lon: -2 }));
    const a = await client.elevations(pts);
    expect(a.length).toBe(150);
    expect(a[10]).toBeCloseTo(501, 0);
    expect(ff.calls.length).toBe(2);
    await client.elevations(pts.slice(0, 20));
    expect(ff.calls.length).toBe(2);
  });
});

describe('line sampling', () => {
  it('samples every step and always includes the final vertex', () => {
    const line = toLineString([[-2, 50], [-2, 50.09]]); // about 10 km north
    const s = sampleAlongLine(line, 1000);
    expect([11, 12]).toContain(s.length); // a final vertex is appended when the length is not an exact multiple
    expect(s[0].alongKm).toBe(0);
    expect(s[s.length - 1].position).toEqual([-2, 50.09]);
    for (let i = 1; i < 11; i++) expect(s[i].alongKm - s[i - 1].alongKm).toBeCloseTo(1, 5);
  });
});

describe('terrain analysis', () => {
  const sample = (km: number, e: number | null) => ({ alongKm: km, lat: 50 + km / 100, lon: -2, elevationM: e });
  it('is good when the ground stays well within the flight height', () => {
    const a = analyseTerrain([sample(0, 50), sample(1, 80), sample(2, 40)], 120);
    expect(a.status).toBe('good');
    expect(a).toMatchObject({ maxRiseM: 30, maxFallM: 10, warnings: [] });
  });
  it('cautions when clearance drops under 30 m and is poor when the ground exceeds the flight height', () => {
    const c = analyseTerrain([sample(0, 50), sample(1, 145)], 120);
    expect(c.status).toBe('caution');
    expect(c.warnings[0].kind).toBe('ground_clearance');
    const p = analyseTerrain([sample(0, 50), sample(1.2, 180)], 120);
    expect(p.status).toBe('poor');
    expect(p.warnings[0].message).toContain('below the ground');
  });
  it('cautions when falling ground puts a fixed height above the 120 m surface limit', () => {
    const a = analyseTerrain([sample(0, 200), sample(1, 140)], 120); // 60 m fall: 180 m above the surface
    expect(a.status).toBe('caution');
    expect(a.warnings.some((w) => w.kind === 'above_surface_limit')).toBe(true);
    expect(analyseTerrain([sample(0, 200), sample(1, 140)], 20).warnings.some((w) => w.kind === 'above_surface_limit')).toBe(false);
    expect(analyseTerrain([sample(0, 60), sample(1, 40)], 120).status).toBe('good'); // a 20 m dip is within the margin
  });
  it('copes with missing elevations', () => {
    expect(analyseTerrain([sample(0, null), sample(1, null)], 120).status).toBe('caution');
    expect(analyseTerrain([sample(0, 10), sample(1, null), sample(2, 20)], 120).missingSamples).toBe(1);
  });
  it('builds a centred grid and bearings', () => {
    const g = gridAround(-2, 50, 500, 5);
    expect(g.length).toBe(25);
    expect(g[0]).toEqual({ lat: 50, lon: -2, distanceKm: 0 });
    expect(Math.round(bearingDeg([-2, 50], [-2, 51]))).toBe(0);
    expect(Math.round(bearingDeg([-2, 50], [-1, 50]))).toBe(90);
  });
});
