import { describe, expect, it } from 'vitest';
import { buildDroneIndex, buildViewData, buildWindField, mapUrl, parseViewQuery, parseWindQuery, resolveViewQuery, WIND_MAX_POINTS, windLattice, windLevelOf } from '../../src/map/view-data.js';
import { fakeFetch } from '../helpers/fake-fetch.js';
import { readFileSync } from 'node:fs';
import { BASEMAPS, MAP_CSP, OVERLAYS, RADAR, SECTIONS, mapHtml } from '../../src/map/html.js';
import { SILHOUETTES } from '../../src/map/silhouettes.js';
import { DRONE_CATALOGUE } from '../../src/services/drones/index.js';
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
    expect(view.weather).toBeNull();
    expect(view.attribution.join(' ')).toContain('OpenStreetMap');
    expect(view.attribution.join(' ')).not.toContain('Open-Meteo');
    const bristol = await buildViewData(deps, { lat: 51.3827, lon: -2.7191, includeNotams: false });
    expect(bristol.zones.map((z) => z.properties.zoneType)).toContain('frz');
    expect(bristol.zones.find((z) => z.properties.zoneType === 'restricted')!.properties.relevant).toBe(false);
  });
  it('summarises the coming hour of weather at the centre when the forecast is available', async () => {
    const raw = JSON.parse(readFileSync(new URL('../fixtures/weather/open-meteo-durdle.json', import.meta.url), 'utf8'));
    const ff = fakeFetch([{ match: 'api.open-meteo.com', body: raw }]);
    const { deps } = buildTestDeps({ fetchImpl: ff.fetch, now: () => new Date(`${raw.hourly.time[0].slice(0, 10)}T09:30:00Z`) });
    const view = await buildViewData(deps, { lat: 50.6212, lon: -2.277, includeNotams: false });
    expect(view.weather).not.toBeNull();
    expect(view.weather!.time).toBe(`${raw.hourly.time[0].slice(0, 10)}T10:00`);
    expect(['good', 'caution', 'poor']).toContain(view.weather!.flyability);
    expect(view.weather!.summary).not.toBe('');
    expect(view.attribution.join(' ')).toContain('Open-Meteo');
    expect(typeof view.weather!.windDirectionDeg).toBe('number');
    expect(['good', 'caution', 'poor']).toContain(view.weather!.windLevel);
    expect(windLevelOf({ windMs: 3, gustMs: 5, wind120Ms: 6 })).toBe('good');
    expect(windLevelOf({ windMs: 5, gustMs: 8, wind120Ms: 11 })).toBe('caution');
    expect(windLevelOf({ windMs: 9, gustMs: 13, wind120Ms: 14 })).toBe('poor');
    const off = await buildViewData(deps, { lat: 50.6212, lon: -2.277, includeNotams: false, includeWeather: false });
    expect(off.weather).toBeNull();
    expect(parseViewQuery(new URLSearchParams('lat=51.38&lon=-2.72&weather=0'))!.includeWeather).toBe(false);
  });
  it('snaps the wind lattice to a fixed grid and caps the point count', () => {
    const a = windLattice([-2.75, 51.35, -2.65, 51.42], 13);
    const b = windLattice([-2.74, 51.36, -2.64, 51.43], 13); // panned slightly: shared points keep identical coordinates
    const keys = new Set(a.points.map((p) => `${p.lat},${p.lon}`));
    expect(b.points.some((p) => keys.has(`${p.lat},${p.lon}`))).toBe(true);
    expect(a.points.length).toBeGreaterThan(4);
    // The lattice encloses the bbox with a ring to spare on every side.
    const lats = a.points.map((p) => p.lat), lons = a.points.map((p) => p.lon);
    expect(Math.min(...lats)).toBeLessThanOrEqual(51.35);
    expect(Math.max(...lats)).toBeGreaterThanOrEqual(51.42);
    expect(Math.min(...lons)).toBeLessThanOrEqual(-2.75);
    expect(Math.max(...lons)).toBeGreaterThanOrEqual(-2.65);
    const wide = windLattice([-6, 50, 2, 56], 14);
    expect(wide.points.length).toBeLessThanOrEqual(WIND_MAX_POINTS);
    expect(wide.spacingDeg).toBeGreaterThan(a.spacingDeg);
    expect(parseWindQuery(new URLSearchParams('bbox=-2.75,51.35,-2.65,51.42&z=13'))).toEqual({ bbox: [-2.75, 51.35, -2.65, 51.42], zoom: 13 });
    expect(parseWindQuery(new URLSearchParams('bbox=-2.65,51.35,-2.75,51.42'))).toBeUndefined();
    expect(parseWindQuery(new URLSearchParams('bbox=nope'))).toBeUndefined();
  });
  it('builds a wind field from one multi-point Open-Meteo request and caches per point', async () => {
    const raw = JSON.parse(readFileSync(new URL('../fixtures/weather/open-meteo-durdle.json', import.meta.url), 'utf8'));
    const q = { bbox: [-2.3, 50.6, -2.25, 50.64] as [number, number, number, number], zoom: 13 };
    const n = windLattice(q.bbox, q.zoom).points.length;
    const ff = fakeFetch([{ match: 'api.open-meteo.com', body: Array.from({ length: n }, () => raw) }]);
    const { deps } = buildTestDeps({ fetchImpl: ff.fetch, now: () => new Date(`${raw.hourly.time[0].slice(0, 10)}T09:30:00Z`) });
    const field = await buildWindField(deps, q);
    expect(field.points.length).toBe(n);
    expect(field.time).toBe(`${raw.hourly.time[0].slice(0, 10)}T10:00`);
    expect(field.points[0]).toMatchObject({ level: expect.stringMatching(/good|caution|poor/) });
    expect(typeof field.points[0].directionDeg).toBe('number');
    expect(field.attribution).toContain('Open-Meteo');
    expect(field.limits.gustNoFlyMs).toBeGreaterThan(field.limits.windStrongMs);
    const requested = new URL(ff.calls[0].url).searchParams.get('latitude')!.split(',').length;
    expect(requested).toBe(n);
    const lattice = windLattice(q.bbox, q.zoom).points;
    expect(field.points.map((p) => [p.lat, p.lon])).toEqual(lattice.map((p) => [p.lat, p.lon]));
    const again = await buildWindField(deps, q);
    expect(ff.calls.length).toBe(1);
    // Cached points must keep the requested coordinates, not Open-Meteo's model cell centre.
    expect(again.points.map((p) => [p.lat, p.lon])).toEqual(lattice.map((p) => [p.lat, p.lon]));
  });
  it('indexes the drone catalogue for the picker with a silhouette and a rules summary each', () => {
    const idx = buildDroneIndex(new Date('2026-09-25T12:00:00Z'));
    expect(idx.drones.length).toBe(DRONE_CATALOGUE.length);
    for (const d of idx.drones) {
      expect(SILHOUETTES, `${d.id} silhouette`).toHaveProperty(d.silhouette);
      expect(d.subcategory).toMatch(/^A[123]/);
    }
    const mini = idx.drones.find((d) => d.id === 'dji-mini-4-pro')!;
    expect(mini).toMatchObject({ classMark: 'C0', silhouette: 'mini', subcategory: 'A1', effectiveClass: 'UK0' });
    for (const svg of Object.values(idx.silhouettes)) expect(svg).toContain('currentColor');
    expect(mapUrl('https://x.test', { lat: 51, lon: -2, drone: 'dji-neo' })).toContain('drone=dji-neo');
  });
  it('resolves a place or named waypoints server-side', async () => {
    const bristol = JSON.parse(readFileSync(new URL('../fixtures/geocode/nominatim-bristol.json', import.meta.url), 'utf8'));
    const ff = fakeFetch([{ match: 'q=Bristol', body: bristol }]);
    const { deps } = buildTestDeps({ fetchImpl: ff.fetch });
    const byPlace = await resolveViewQuery(new URLSearchParams('place=Bristol&radius=800'), deps);
    expect(byPlace).toMatchObject({ lat: 51.4545, lon: -2.5879, radiusM: 800 });
    expect(byPlace!.name).toContain('Bristol');
    const byWaypoints = await resolveViewQuery(new URLSearchParams('waypoints=Bristol;-2.72,51.383'), deps);
    expect(byWaypoints!.route).toEqual([[-2.5879, 51.4545], [-2.72, 51.383]]);
    expect(await resolveViewQuery(new URLSearchParams('foo=bar'), deps)).toBeUndefined();
  });
  it('renders both html modes with the api base baked in', () => {
    const page = mapHtml({ mode: 'page', apiBase: 'https://x.test' });
    expect(page).toContain('var API_BASE = "https://x.test"');
    expect(page).toContain('var MODE = "page"');
    const app = mapHtml({ mode: 'app', apiBase: null });
    expect(app).toContain('ui/initialize');
    expect(app).toContain('ui/notifications/tool-result');
    expect(app).toContain('ui/notifications/tool-input');
    expect(app).not.toContain('structuredContent');
  });
  it('offers a satellite basemap whose hosts are allowed by the app CSP', () => {
    const html = mapHtml({ mode: 'page', apiBase: null });
    expect(html).toContain("['satellite', 'Satellite']");
    expect(html).toContain('basemap');
    for (const url of [BASEMAPS.map.url, BASEMAPS.satellite.url, BASEMAPS.satellite.labels]) {
      expect(html).toContain(url);
      const origin = new URL(url).origin;
      expect(MAP_CSP.resourceDomains, `${origin} must be in the CSP`).toContain(origin);
    }
    expect(html).toContain(BASEMAPS.satellite.attribution);
    expect(MAP_CSP.resourceDomains).toContain('https://tilecache.rainviewer.com');
    expect(MAP_CSP.connectDomains).toContain(new URL(RADAR.index).origin);
    expect(RADAR.maxZoom).toBeGreaterThan(RADAR.maxNativeZoom);
  });
  it('makes every overlay a toggle in the layers panel, weather split three ways', () => {
    const html = mapHtml({ mode: 'app', apiBase: 'https://x.test' });
    expect(html).toContain('LayersPanel');
    expect(html).not.toContain('L.control.layers(');
    for (const o of OVERLAYS) expect(html, `${o.key} overlay`).toContain(o.label);
    const sectionKeys = SECTIONS.map((s) => s[0]);
    for (const o of OVERLAYS) expect(sectionKeys, `${o.key} section`).toContain(o.section);
    expect(OVERLAYS.filter((o) => o.section === 'weather').map((o) => o.key)).toEqual(['conditions', 'wind', 'radar']);
    expect(new Set(OVERLAYS.map((o) => o.key)).size).toBe(OVERLAYS.length);
    // Prohibited and restricted airspace and aerodrome FRZs can never be switched off.
    expect(OVERLAYS.filter((o) => 'locked' in o && o.locked).map((o) => o.key)).toEqual(['prohibited', 'frz', 'prison']);
    expect(html).toContain('o.locked || hidden.indexOf(o.key) < 0');
    expect(html).toContain('hiddenOverlays');
    expect(html).toContain('WindCanvas');
    expect(html).toContain('prefers-reduced-motion');
    expect(html).toContain('/api/wind?bbox=');
    expect(html).toContain('function buildGrid(');
    expect(html).toContain("createPane('radar')");
    expect(html).not.toContain('id="legend"');
    expect(html).toContain('id="sources"');
    expect(html).toContain('infoOpen');
    expect(html).toContain('function pinSvg(');
    expect(html).toContain('id="drone-select"');
    expect(html).toContain('/api/drones');
    expect(html).toContain('meta.view.drone');
    expect(html).toContain('attributionControl: false');
    expect(html).toContain('setCounts(counts)');
  });
});
