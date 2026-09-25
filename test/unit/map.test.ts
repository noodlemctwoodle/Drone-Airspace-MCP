import { describe, expect, it } from 'vitest';
import { buildViewData, mapUrl, parseViewQuery } from '../../src/map/view-data.js';
import { mapHtml } from '../../src/map/html.js';
import { buildTestDeps } from '../helpers/build-deps.js';

describe('map view', () => {
  it('parses query parameters defensively', () => {
    expect(parseViewQuery(new URLSearchParams('lat=51.38&lon=-2.72&radius=900'))).toMatchObject({ lat: 51.38, lon: -2.72, radiusM: 900 });
    expect(parseViewQuery(new URLSearchParams('lat=91&lon=0'))).toBeUndefined();
    expect(parseViewQuery(new URLSearchParams('lon=-2'))).toBeUndefined();
    const r = parseViewQuery(new URLSearchParams('lat=51.4&lon=-2.8&route=-2.85,51.44;-2.72,51.383'))!;
    expect(r.route).toEqual([[-2.85, 51.44], [-2.72, 51.383]]);
  });
  it('builds map urls only when a public base is configured', () => {
    expect(mapUrl(undefined, { lat: 1, lon: 2 })).toBeNull();
    expect(mapUrl('https://x.test', { lat: 51.38271, lon: -2.71914, radiusM: 1500 })).toBe('https://x.test/map?lat=51.38271&lon=-2.71914&radius=1500');
    expect(mapUrl('https://x.test', { lat: 51, lon: -2, route: [[-2.85, 51.44], [-2.72, 51.383]] })).toContain('route=-2.85000%2C51.44000%3B-2.72000%2C51.38300');
  });
  it('assembles zones, paths, parking and land for a point', async () => {
    const { deps } = buildTestDeps();
    const view = await buildViewData(deps, { lat: 50.6212, lon: -2.277, radiusM: 1500, includeNotams: false });
    expect(view.rightsOfWay.length).toBeGreaterThan(0);
    expect(view.parking[0].name).toBe('Durdle Door Car Park');
    expect(view.zones).toEqual([]);
    expect(view.attribution.join(' ')).toContain('OpenStreetMap');
    const bristol = await buildViewData(deps, { lat: 51.3827, lon: -2.7191, includeNotams: false });
    expect(bristol.zones.map((z) => z.properties.zoneType)).toContain('frz');
    expect(bristol.zones.find((z) => z.properties.zoneType === 'restricted')!.properties.relevant).toBe(false);
  });
  it('renders both html modes with the api base baked in', () => {
    const page = mapHtml({ mode: 'page', apiBase: 'https://x.test' });
    expect(page).toContain('var API_BASE = "https://x.test"');
    expect(page).toContain('var MODE = "page"');
    const app = mapHtml({ mode: 'app', apiBase: null });
    expect(app).toContain('ui/initialize');
    expect(app).toContain('ui/notifications/tool-result');
  });
});
