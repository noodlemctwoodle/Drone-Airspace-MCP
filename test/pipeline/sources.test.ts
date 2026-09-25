import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseRowmapsGeojson, parseRowmapsProps, scrapeAuthorityIndex } from '../../pipeline/sources/rowmaps/geojson-parser.js';
import { fetchAllFeatures, normaliseNtFeature } from '../../pipeline/sources/nt/arcgis.js';
import { loadByelaws } from '../../pipeline/sources/byelaws/loader.js';
import { parseCountries } from '../../pipeline/sources/countries/ons.js';
import { bboxIntersects, resolveRegion } from '../../pipeline/lib/regions.js';
import { encodeLine } from '../../pipeline/lib/geometry.js';
import { decodeLine } from '../../src/pack/geometry.js';

const fx = (p: string) => new URL(`../fixtures/${p}`, import.meta.url);

describe('rowmaps', () => {
  it('parses pipe-delimited properties', () => {
    const p = parseRowmapsProps({ Name: 'BD|Barking and Dagenham|7', Description: 'Fo|BD:19903744|0.151|From Park Lane to Percival Gardens.|0.13|51.57' }, 'Barking and Dagenham');
    expect(p.routeNo).toBe('7');
    expect(p.parish).toBeNull();
    expect(p.sourceRef).toBe('BD:19903744');
    expect(p.prefixType).toBe('footpath');
    expect(p.routeName).toBe('From Park Lane to Percival Gardens.');
    const devon = parseRowmapsProps({ Name: 'DN|Abbots Bickington|1', Description: 'Fo|DN:1|0.523|none|-4.3|50.9' }, 'Devon');
    expect(devon.parish).toBe('Abbots Bickington');
    expect(devon.routeName).toBeNull();
    const cornwall = parseRowmapsProps({ Name: 'CN|318|36/1', Description: 'Fo|CN:1|0.78|St Agnes@Carrick@1250|-5.2|50.3' }, 'Cornwall');
    expect(cornwall.parish).toBe('St Agnes');
    expect(cornwall.routeNo).toBe('36/1');
    const dorset = parseRowmapsProps({ Name: 'DT|W28|13', Description: 'Fo|DT:1|0.125|202|-2.6|50.8' }, 'Dorset');
    expect(dorset.parish).toBe('W28');
    expect(dorset.routeName).toBeNull();
    expect(parseRowmapsProps(null).routeNo).toBeNull();
  });
  it('parses a fixture with MultiLineString split and junk dropped', () => {
    const json = JSON.parse(readFileSync(fx('rowmaps/BD-mutated1.json'), 'utf8'));
    const r = parseRowmapsGeojson(json, 'BD', 'footpath');
    expect(r.paths.length).toBe(5); // 3 lines + 2 parts of the multi
    expect(r.skipped).toBe(1);
    expect(r.attribution).toMatch(/Barking and Dagenham/);
    expect(r.paths[0].lengthM).toBeGreaterThan(50);
    expect(r.paths.filter((p) => p.sourceRef?.includes('#')).length).toBe(2);
    expect(parseRowmapsGeojson('garbage', 'BD', 'footpath').paths).toEqual([]);
  });
  it('scrapes the authority index', () => {
    const list = scrapeAuthorityIndex('<a href="BD/">Barking&nbsp;and&nbsp;Dagenham</a><a href="DT/">Dorset</a><a href="DT/">Dorset</a>');
    expect(list).toEqual([{ code: 'BD', name: 'Barking and Dagenham' }, { code: 'DT', name: 'Dorset' }]);
  });
  it('round-trips polyline6', () => {
    const coords = [[-2.283, 50.621], [-2.277, 50.6215], [-2.271, 50.622]];
    const back = decodeLine(encodeLine(coords)).coordinates;
    back.forEach((c, i) => {
      expect(c[0]).toBeCloseTo(coords[i][0], 5);
      expect(c[1]).toBeCloseTo(coords[i][1], 5);
    });
  });
});

describe('national trust', () => {
  it('pages through a layer and normalises polygons only', async () => {
    const pages: Record<string, string> = {
      'layer?f=json': readFileSync(fx('nt/layer-info.json'), 'utf8'),
      'resultOffset=0': readFileSync(fx('nt/page-1.json'), 'utf8'),
      'resultOffset=2': readFileSync(fx('nt/page-2.json'), 'utf8'),
    };
    const calls: string[] = [];
    const fetchText = async (url: string) => {
      calls.push(url);
      const key = Object.keys(pages).find((k) => url.includes(k));
      if (!key) throw new Error(`unexpected ${url}`);
      return pages[key];
    };
    const out = [];
    for await (const f of fetchAllFeatures('https://x/layer', { fetchText })) {
      const n = normaliseNtFeature(f, 'nt_always_open', 'always_open', 'https://x/layer', '2026-09-25T00:00:00Z');
      if (n) out.push(n);
    }
    expect(calls.length).toBe(3);
    expect(out.length).toBe(2);
    expect(out[0].name).toBe('Brownsea Island');
    expect(out[0].takeoffBanned).toBe(true);
    expect(out[0].lastVerified).toBe('2023-06-13');
    expect(out[1].geometry.type).toBe('MultiPolygon');
  });
});

describe('byelaws', () => {
  it('loads valid entries, expands circles and files, and reports invalid ones', async () => {
    const r = await loadByelaws(fx('byelaws/seed.yaml').pathname);
    expect(r.validEntries).toBe(2);
    expect(r.restrictions.length).toBe(2);
    expect(r.warnings.length).toBe(1);
    expect(r.warnings[0]).toMatch(/Bad Entry/);
    const circle = r.restrictions.find((x) => x.entryId === 'test-park')!;
    expect((circle.geometry as { coordinates: number[][][] }).coordinates[0].length).toBe(65);
    const file = r.restrictions.find((x) => x.entryId === 'test-commons')!;
    expect(file.geometry.type).toBe('MultiPolygon');
    expect(file.kind).toBe('pspo');
    expect(file.landingBanned).toBe(false);
  });
  it('handles a missing file', async () => {
    const r = await loadByelaws('/nonexistent/seed.yaml');
    expect(r.restrictions).toEqual([]);
    expect(r.warnings[0]).toMatch(/could not read/);
  });
});

describe('countries and regions', () => {
  it('parses the four UK countries', () => {
    const c = parseCountries(JSON.parse(readFileSync(fx('countries/countries-thin.geojson'), 'utf8')));
    expect(c.map((x) => x.country).sort()).toEqual(['england', 'northern_ireland', 'scotland', 'wales']);
  });
  it('resolves regions and bbox filters', () => {
    expect(resolveRegion('south-west').authorities).toContain('DT');
    expect(resolveRegion(undefined).name).toBe('national');
    expect(() => resolveRegion('mars')).toThrow(/unknown region/);
    expect(resolveRegion('x', '-3,50,-2,51').bbox).toEqual([-3, 50, -2, 51]);
    expect(bboxIntersects([-3, 50, -2, 51], [-2.5, 50.5, 0, 52])).toBe(true);
    expect(bboxIntersects([-3, 50, -2, 51], [0, 52, 1, 53])).toBe(false);
  });
});

describe('tilePolygon', () => {
  it('leaves small polygons alone and splits oversize ones into grid pieces that still contain the same points', async () => {
    const { tilePolygon } = await import('../../pipeline/lib/geometry.js');
    const booleanPointInPolygon = (await import('@turf/boolean-point-in-polygon')).default;
    const small = { type: 'Polygon' as const, coordinates: [[[-2.3, 50.6], [-2.2, 50.6], [-2.2, 50.7], [-2.3, 50.7], [-2.3, 50.6]]] };
    expect(tilePolygon(small)).toEqual([small]);
    // A jagged ring of 6000 vertices around a 0.5 degree box: about 130 KB of JSON.
    const ring: number[][] = [];
    const n = 6000;
    for (let i = 0; i < n; i++) {
      const t = (i / n) * Math.PI * 2;
      const r = 0.25 + (i % 2 === 0 ? 0.0004 : 0);
      ring.push([Number((-2.5 + r * Math.cos(t)).toFixed(6)), Number((51 + r * Math.sin(t)).toFixed(6))]);
    }
    ring.push(ring[0]);
    const big = { type: 'Polygon' as const, coordinates: [ring] };
    expect(JSON.stringify(big).length).toBeGreaterThan(50_000);
    const pieces = tilePolygon(big, 50_000, 0.1);
    expect(pieces.length).toBeGreaterThan(4);
    for (const p of pieces) expect(JSON.stringify(p).length).toBeLessThanOrEqual(50_000);
    for (const pt of [[-2.5, 51], [-2.3, 51.1], [-2.7, 50.9]]) expect(pieces.some((p) => booleanPointInPolygon(pt, p))).toBe(true);
    expect(pieces.some((p) => booleanPointInPolygon([-2.5, 51.4], p))).toBe(false);
  });
});
