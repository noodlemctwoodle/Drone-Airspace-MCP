import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { createHandlers } from '../../src/handlers/index.js';
import { buildTestDeps, testConfig } from '../helpers/build-deps.js';
import { fakeFetch } from '../helpers/fake-fetch.js';

const fx = (name: string) => JSON.parse(readFileSync(new URL(`../fixtures/geocode/${name}`, import.meta.url), 'utf8'));
const pib = readFileSync(new URL('../fixtures/notam/pib-excerpt.xml', import.meta.url), 'utf8');
const weatherRaw = JSON.parse(readFileSync(new URL('../fixtures/weather/open-meteo-durdle.json', import.meta.url), 'utf8'));
const kpRaw = JSON.parse(readFileSync(new URL('../fixtures/space-weather/noaa-kp.json', import.meta.url), 'utf8'));
const LIVE_ROUTES: Parameters<typeof fakeFetch>[0] = [
  { match: 'api.open-meteo.com/v1/forecast', body: weatherRaw },
  { match: 'noaa-planetary-k-index', body: kpRaw },
  { match: 'v1/elevation', handler: (url) => ({ body: { elevation: new URL(url).searchParams.get('latitude')!.split(',').map((la) => 50 + Math.max(0, Number(la) - 50.6) * 4000) } }) },
];

function setup(extra: Parameters<typeof fakeFetch>[0] = [], opts: Parameters<typeof buildTestDeps>[0] = {}) {
  const ff = fakeFetch([
    { match: 'q=Newport', body: fx('nominatim-newport.json') },
    { match: 'q=Tyndale%20Monument', body: fx('nominatim-tyndale.json') },
    { match: 'q=the%20layby', body: [] },
    { match: 'q=Bristol', body: fx('nominatim-bristol.json') },
    { match: 'q=Nowhere', body: [] },
    { match: '/postcodes/BS16QF', body: fx('postcodes-io-bs1.json') },
    { match: '/outcodes/GL11', body: fx('postcodes-io-outcode.json') },
    { match: 'PIB.xml', body: pib, headers: { 'content-type': 'text/xml' } },
    ...extra,
  ]);
  const built = buildTestDeps({ fetchImpl: ff.fetch, ...opts });
  return { ...built, handlers: createHandlers(built.deps), calls: ff.calls };
}
const text = (r: { content: Array<{ text: string }> }) => r.content[0].text;
const json = (r: { content: Array<{ text: string }> }) => JSON.parse(r.content[0].text);

describe('check_location', () => {
  it('returns ambiguity candidates for Newport', async () => {
    const { handlers } = setup();
    const r = json(await handlers.get('check_location')!({ place: 'Newport', format: 'json' }));
    expect(r.status).toBe('ambiguous');
    expect(r.candidates.length).toBe(3);
  });
  it('resolves informal names through the fallback and says so', async () => {
    const { handlers } = setup();
    const r = text(await handlers.get('check_location')!({ place: 'the layby below Tyndale Monument' }));
    expect(r).toContain('results are for "Tyndale Monument"');
    expect(r).toContain('No permanent airspace restriction at this point.');
  });
  it('short-circuits postcodes and outcodes', async () => {
    const { handlers, calls } = setup();
    const r = json(await handlers.get('check_location')!({ place: 'bs1 6qf', format: 'json' }));
    expect(r.location.source).toBe('postcodes.io');
    expect(calls.some((c) => c.url.includes('nominatim'))).toBe(false);
    const o = json(await handlers.get('check_location')!({ place: 'GL11', format: 'json' }));
    expect(o.location.name).toContain('GL11');
  });
  it('reports not found', async () => {
    const { handlers } = setup();
    expect(text(await handlers.get('check_location')!({ place: 'Nowhere' }))).toMatch(/No UK location found/);
  });
  it('lists landowner rules and the verdict for a point inside NT land', async () => {
    const { handlers } = setup();
    const r = text(await handlers.get('check_location')!({ lat: 50.69, lon: -1.97 }));
    expect(r).toContain('Landowner rule: Brownsea Island');
    expect(r).toContain('National Trust Open Data');
  });
  it('states the offence for a prison zone and never calls it an aerodrome', async () => {
    const { handlers } = setup();
    const t = text(await handlers.get('check_location')!({ lat: 50.5487, lon: -2.4327 }));
    expect(t).toContain('Prison restricted area');
    expect(t).toContain('offence');
    expect(t).toContain('HMPPS');
    expect(t).not.toMatch(/permission from the aerodrome/);
    const j = json(await handlers.get('preflight_briefing')!({ lat: 50.5487, lon: -2.4327, format: 'json' }));
    expect(j.status).toBe('no_go');
    expect(j.reasons[0].code).toBe('prison_zone');
  });
  it('fails clearly on a geocoder outage', async () => {
    const { handlers } = setup([], { fetchImpl: async () => new Response('down', { status: 503 }) });
    await expect(handlers.get('check_location')!({ place: 'Anywhere' })).rejects.toThrow(/Geocoding is unavailable/);
  });
  it('explains when the pack is unavailable', async () => {
    const { handlers } = setup([], { noPack: true });
    await expect(handlers.get('check_location')!({ lat: 51, lon: -2 })).rejects.toThrow(/data pack unavailable/i);
  });
});

describe('get_aerodrome_zone', () => {
  it('finds by ICAO and by name, with geometry on request', async () => {
    const { handlers } = setup();
    const r = json(await handlers.get('get_aerodrome_zone')!({ aerodrome: 'EGGD', format: 'json' }));
    expect(r.matches[0].icao).toBe('EGGD');
    expect(r.matches[0].zone.geometry).toBeUndefined();
    expect(r.matches[0].components.length).toBe(1);
    const g = json(await handlers.get('get_aerodrome_zone')!({ aerodrome: 'bristol', include_geojson: true, format: 'json' }));
    expect(g.matches[0].zone.geometry.type).toBe('Polygon');
    expect(text(await handlers.get('get_aerodrome_zone')!({ aerodrome: 'Atlantis' }))).toMatch(/No aerodrome zone found/);
  });
});

describe('check_notams', () => {
  it('lists covering and unlocated NOTAMs from the bulletin', async () => {
    const { handlers } = setup();
    // Walney / Barrow: many fixture NOTAMs sit around 54.13N 3.27W
    const r = json(await handlers.get('check_notams')!({ lat: 54.13, lon: -3.26, radius_km: 20, date: '2026-09-25T12:00Z', format: 'json' }));
    expect(r.bulletin.count).toBe(20);
    expect(r.covering.length + r.nearby.length).toBeGreaterThan(0);
    expect(r.unlocatedTotal).toBeGreaterThan(0);
    expect(r.attribution.join(' ')).toContain('NATS AIS');
    const t = text(await handlers.get('check_notams')!({ lat: 54.13, lon: -3.26, radius_km: 20 }));
    expect(t).toContain('Covering the point');
    expect(t).toContain('Caveats');
  });
  it('rejects a bad date', async () => {
    const { handlers } = setup();
    await expect(handlers.get('check_notams')!({ lat: 54, lon: -3, date: 'tomorrow' })).rejects.toThrow(/ISO 8601/);
  });
  it('serves a stale bulletin with a caveat when the feed fails', async () => {
    const { handlers, deps } = setup();
    await handlers.get('check_notams')!({ lat: 54.13, lon: -3.26 });
    // second setup sharing the cache dir but with a dead network
    const dead = buildTestDeps({ config: deps.config, fetchImpl: async () => new Response('down', { status: 503 }), now: () => new Date('2026-09-25T13:00:00Z') });
    const h2 = createHandlers(dead.deps);
    const r = json(await h2.get('check_notams')!({ lat: 54.13, lon: -3.26, format: 'json' }));
    expect(r.bulletin.stale).toBe(true);
    expect(r.caveats.join(' ')).toMatch(/cached copy/);
  });
});

describe('check_route', () => {
  it('reports crossings with entry distances', async () => {
    const { handlers } = setup();
    const r = json(await handlers.get('check_route')!({ waypoints: [[-3.3, 51.207], [-2.7191, 51.207], [-2.7191, 51.3827]], format: 'json' }));
    expect(r.mode).toBe('route');
    expect(r.crossings.map((c: { id: number }) => c.id)).toEqual([2, 1]);
    expect(r.crossings[0].entersAtKm).toBeGreaterThan(0);
    expect(r.zonesAbove120m).toBe(1);
    expect(r.verdict.line).toMatch(/^Route crosses 2 restrictions/);
  });
  it('geocodes place waypoints and surfaces ambiguity with the index', async () => {
    const { handlers } = setup();
    const r = json(await handlers.get('check_route')!({ waypoints: ['Bristol', 'Newport'], format: 'json' }));
    expect(r.status).toBe('ambiguous');
    expect(r.query).toContain('waypoint 2');
  });
  it('checks an area', async () => {
    const { handlers } = setup();
    const r = json(await handlers.get('check_route')!({ area: { bbox: [-3.2, 51.15, -3.0, 51.25] }, format: 'json' }));
    expect(r.mode).toBe('area');
    expect(r.zones.map((z: { id: number }) => z.id)).toEqual([2]);
  });
  it('rejects both or neither inputs and over-long routes', async () => {
    const { handlers } = setup();
    await expect(handlers.get('check_route')!({})).rejects.toThrow(/either waypoints/);
    await expect(handlers.get('check_route')!({ waypoints: [[-5, 50], [1.5, 55.5]] })).rejects.toThrow(/maximum is 500 km/);
  });
});

describe('check_takeoff_site', () => {
  it('lists nearest rights of way with per-authority attribution', async () => {
    const { handlers } = setup();
    const r = json(await handlers.get('check_takeoff_site')!({ lat: 50.6212, lon: -2.277, format: 'json' }));
    expect(r.rightsOfWay[0].pathType).toBe('footpath');
    expect(r.rightsOfWay[0].distanceM).toBeLessThan(100);
    expect(r.coverage).toBe('england_wales');
    expect(r.attribution.join(' ')).toContain('council of Dorset');
    const t = text(await handlers.get('check_takeoff_site')!({ lat: 50.6212, lon: -2.277 }));
    expect(t).toMatch(/^No permanent airspace restriction at this point\.\nNearest public right of way: \d+ m away \(footpath, Dorset\)\./);
    expect(t).toContain('interpretation of each council');
  });
  it('names the local authority and its policy without treating the policy as a ban', async () => {
    const { handlers } = setup();
    const j = json(await handlers.get('check_takeoff_site')!({ lat: 50.6212, lon: -2.277, format: 'json' }));
    expect(j.localAuthority).toMatchObject({ code: 'E06000059', name: 'Dorset' });
    expect(j.localAuthority.policies[0].entryId).toBe('dorset-policy');
    expect(j.takeoffBannedByLandowner).toBe(false);
    expect(j.landownerRules.some((r: { scope: string }) => r.scope === 'authority')).toBe(false);
    const t = text(await handlers.get('check_takeoff_site')!({ lat: 50.6212, lon: -2.277 }));
    expect(t).toContain('Local authority');
    expect(t).toContain('Dorset (E06000059): Dorset Council does not permit');
    expect(t).not.toContain('Take-off restricted by landowner rule');
    const loc = text(await handlers.get('check_location')!({ lat: 56.5, lon: -4.0 }));
    expect(loc).not.toContain('Local authority');
    const b = json(await handlers.get('preflight_briefing')!({ lat: 50.6212, lon: -2.277, format: 'json' }));
    expect(b.reasons.map((r: { code: string }) => r.code)).not.toContain('landowner_ban');
  });
  it('flags landowner bans in the headline', async () => {
    const { handlers } = setup();
    const t = text(await handlers.get('check_takeoff_site')!({ lat: 51.455, lon: -2.6 }));
    expect(t.startsWith('Take-off restricted by landowner rule.')).toBe(true);
    expect(t).toContain('Test Park (Council byelaw)');
  });
  it('says there is no PRoW data in Scotland', async () => {
    const { handlers } = setup();
    const r = json(await handlers.get('check_takeoff_site')!({ lat: 56.5, lon: -4.0, format: 'json' }));
    expect(r.coverage).toBe('no_prow_data');
    expect(r.caveats.join(' ')).toMatch(/Scotland has no definitive map/);
  });
});

describe('find_parking', () => {
  it('lists public parking nearest first and hides private unless asked', async () => {
    const { handlers } = setup();
    const r = json(await handlers.get('find_parking')!({ lat: 50.6212, lon: -2.277, format: 'json' }));
    expect(r.parking.map((p: { name: string | null }) => p.name)).toEqual(['Durdle Door Car Park', null]);
    expect(r.parking[0].distanceM).toBeLessThan(300);
    const all = json(await handlers.get('find_parking')!({ lat: 50.6212, lon: -2.277, include_private: true, format: 'json' }));
    expect(all.parking.length).toBe(3);
    const t = text(await handlers.get('find_parking')!({ lat: 50.6212, lon: -2.277, format: 'brief' }));
    expect(t).toMatch(/^Near .*Nearest parking: Durdle Door Car Park \(car park\) \d+ m away \(pay to park\)\./);
    expect(t).toContain('OpenStreetMap');
  });
  it('adds a map link and view descriptor when a public url is configured', async () => {
    const { handlers } = setup([], { config: testConfig({ PUBLIC_URL: 'https://x.test/' }) });
    const r = await handlers.get('check_takeoff_site')!({ lat: 50.6212, lon: -2.277 });
    expect(r.content[0].text).toMatch(/\nMap: https:\/\/x\.test\/map\?lat=50\.62120&lon=-2\.27700&radius=1000$/);
    expect((r as { structuredContent?: unknown }).structuredContent).toBeUndefined();
    expect(r._meta).toEqual({ ui: { view: { lat: 50.6212, lon: -2.277, radiusM: 1000 } } });
    const plain = await handlers.get('check_takeoff_site')!({ lat: 50.6212, lon: -2.277 });
    const { handlers: noUrl } = setup();
    const p = await noUrl.get('check_takeoff_site')!({ lat: 50.6212, lon: -2.277 });
    expect(p.content[0].text).not.toContain('Map:');
    expect(plain.content[0].text).toContain('Map:');
  });
  it('mentions parking in the take-off report', async () => {
    const { handlers } = setup();
    const t = text(await handlers.get('check_takeoff_site')!({ lat: 50.6212, lon: -2.277 }));
    expect(t).toContain('Nearest parking (public, within 2 km)');
    expect(t).toContain('Durdle Door Car Park');
  });
});

describe('geocode and get_data_status', () => {
  it('geocode returns candidates with attribution', async () => {
    const { handlers } = setup();
    const r = json(await handlers.get('geocode')!({ query: 'Newport', format: 'json' }));
    expect(r.candidates.length).toBe(3);
    expect(r.attribution[0]).toContain('OpenStreetMap');
  });
  it('status reports pack, notam and runtime', async () => {
    const { handlers } = setup();
    const r = json(await handlers.get('get_data_status')!({ format: 'json' }));
    expect(r.pack.status.state).toBe('ready');
    expect(r.pack.meta.packTag).toBe('pack-20260903-test');
    expect(r.server.sqlite.rtree).toBe(true);
    expect(r.geocoding.osNamesEnabled).toBe(false);
    const t = text(await handlers.get('get_data_status')!({}));
    expect(t).toContain('Data pack ready');
  });
  it('status uses OS Names when a key is configured', async () => {
    const { handlers, calls } = setup([{ match: 'api.os.uk', body: fx('os-names-tyndale.json') }], { config: testConfig({ OS_NAMES_API_KEY: 'k' }) });
    const r = json(await handlers.get('geocode')!({ query: 'Tyndale Monument', format: 'json' }));
    expect(r.candidates[0].source).toBe('os_names');
    expect(r.candidates[0].lat).toBeCloseTo(51.66, 1);
    expect(r.candidates[0].lon).toBeCloseTo(-2.37, 1);
    expect(calls.some((c) => c.url.includes('nominatim'))).toBe(false);
  });
});

describe('check_drone_rules', () => {
  it('reports the rules for a catalogue model in text, brief and json', async () => {
    const { handlers } = setup([], { now: () => new Date('2026-09-25T12:00:00Z') });
    const h = handlers.get('check_drone_rules')!;
    const t = text(await h({ model: 'DJI Mini 4 Pro' }));
    expect(t).toContain('DJI Mini 4 Pro (249 g, C0, flies as UK0): open category A1.');
    expect(t).toContain('Flyer ID');
    expect(t).toContain('2028-01-01');
    expect(t).toContain('Attribution:');
    expect(t).toContain('CAA');
    const b = text(await h({ model: 'Mavic 3 Pro', a2_certificate: true, format: 'brief' }));
    expect(b).toContain('A2');
    expect(b).toContain('Sources: the CAA Drone Code.');
    const j = json(await h({ weight_g: 907, class_mark: 'none', format: 'json' }));
    expect(j.assessment).toMatchObject({ effectiveClass: 'legacy', subcategory: 'A3', subcategoryWithA2Certificate: 'A2' });
    expect(j.drone).toBeNull();
  });
  it('lists candidates for an ambiguous model and errors on an unknown one', async () => {
    const { handlers } = setup();
    const h = handlers.get('check_drone_rules')!;
    expect(text(await h({ model: 'pro' }))).toContain('Several models match');
    await expect(h({ model: 'Skydio 2' })).rejects.toThrow(/not in the drone catalogue/);
  });
});

describe('check_takeoff_site with a drone', () => {
  it('adds a Your drone section and the CAA attribution', async () => {
    const { handlers } = setup([], { now: () => new Date('2026-09-25T12:00:00Z') });
    const t = text(await handlers.get('check_takeoff_site')!({ lat: 50.6212, lon: -2.277, drone: 'Mini 4 Pro' }));
    expect(t).toContain('Your drone');
    expect(t).toContain('open category A1');
    expect(t).toContain('CAA');
    const r = await handlers.get('check_takeoff_site')!({ lat: 50.6212, lon: -2.277, drone: 'Mini 4 Pro', format: 'json' });
    const j = JSON.parse(r.content[0].text);
    expect(j.drone.assessment.subcategory).toBe('A1');
    expect(r._meta).toMatchObject({ ui: { view: { drone: 'dji-mini-4-pro' } } });
  });
});

describe('preflight_briefing', () => {
  const at = '2026-09-25T10:00Z';
  it('gives a go status with every section, live sources and attribution for Durdle Door', async () => {
    const { handlers } = setup(LIVE_ROUTES);
    const r = await handlers.get('preflight_briefing')!({ lat: 50.6212, lon: -2.277, date: at, drone: 'Mini 4 Pro', format: 'json' });
    const j = JSON.parse(r.content[0].text);
    expect(j.status).toBe('go');
    expect(j.outages).toEqual([]);
    expect(j.weather.hours.length).toBe(3);
    expect(j.spaceWeather.kp).toBe(kpRaw[kpRaw.length - 1].Kp);
    expect(j.notams.covering).toEqual([]);
    expect(j.access.rightsOfWay.length).toBeGreaterThan(0);
    expect(j.drone.assessment.subcategory).toBe('A1');
    expect(j.attribution.join(' ')).toContain('Open-Meteo');
    expect(j.attribution.join(' ')).toContain('NOAA');
    expect(r._meta).toEqual({ ui: { view: { lat: 50.6212, lon: -2.277, radiusM: 1500, drone: 'dji-mini-4-pro' } } });
    const t = text(await handlers.get('preflight_briefing')!({ lat: 50.6212, lon: -2.277, date: at }));
    expect(t.startsWith('GO for 50.62120')).toBe(true);
    for (const title of ['Findings', '[go] No permanent restriction', 'Weather 2026-09-25', 'Access', 'Attribution:']) expect(t).toContain(title);
    expect(t).toContain('Geomagnetic activity Kp');
    const b = text(await handlers.get('preflight_briefing')!({ lat: 50.6212, lon: -2.277, date: at, format: 'brief' }));
    expect(b.startsWith('Preflight for')).toBe(true);
    expect(b).toContain('Sources:');
  });
  it('is no-go inside the Bristol FRZ and caution once permission is held', async () => {
    const { handlers } = setup(LIVE_ROUTES);
    const t = text(await handlers.get('preflight_briefing')!({ lat: 51.3827, lon: -2.7191, date: at }));
    expect(t.startsWith('NO-GO')).toBe(true);
    expect(t).toContain('BRISTOL FRZ');
    const j = json(await handlers.get('preflight_briefing')!({ lat: 51.3827, lon: -2.7191, date: at, frz_permission: true, format: 'json' }));
    expect(j.status).toBe('caution');
    expect(j.reasons[0].code).toBe('frz_with_permission');
  });
  it('is no-go on a landowner ban', async () => {
    const { handlers } = setup(LIVE_ROUTES);
    const j = json(await handlers.get('preflight_briefing')!({ lat: 50.69, lon: -1.97, date: at, format: 'json' }));
    expect(j.status).toBe('no_go');
    expect(j.reasons.map((r: { code: string }) => r.code)).toContain('landowner_ban');
  });
  it('turns live outages into caution and caveats rather than failing', async () => {
    const built = buildTestDeps({ now: () => new Date(at) });
    const h = createHandlers(built.deps).get('preflight_briefing')!;
    const j = json(await h({ lat: 50.6212, lon: -2.277, format: 'json' }));
    expect(j.status).toBe('caution');
    expect(j.outages.length).toBe(3);
    expect(j.reasons.map((r: { code: string }) => r.code)).toEqual(expect.arrayContaining(['notams_unavailable', 'weather_unavailable']));
    expect(j.caveats.join(' ')).toContain('check_notams');
    expect(j.notams).toBeNull();
    expect(j.weather).toBeNull();
  });
  it('needs the pack and a valid date', async () => {
    const { handlers } = setup([], { noPack: true });
    await expect(handlers.get('preflight_briefing')!({ lat: 50.6, lon: -2.3 })).rejects.toThrow(/data pack unavailable/i);
    const { handlers: h2 } = setup(LIVE_ROUTES);
    await expect(h2.get('preflight_briefing')!({ lat: 50.6, lon: -2.3, date: 'tomorrow' })).rejects.toThrow(/ISO 8601/);
  });
});

describe('check_terrain', () => {
  it('profiles a route against a synthetic hill and warns when the ground exceeds the flight height', async () => {
    const { handlers } = setup(LIVE_ROUTES);
    const j = json(await handlers.get('check_terrain')!({ waypoints: [[-2.277, 50.6212], [-2.277, 50.66]], format: 'json' }));
    expect(j.mode).toBe('route');
    expect(j.status).toBe('poor');
    expect(j.summary.maxRiseM).toBeGreaterThan(120);
    expect(j.warnings[0].kind).toBe('ground_clearance');
    expect(j.samples.length).toBeGreaterThan(10);
    expect(j.attribution.join(' ')).toContain('Copernicus');
    const t = text(await handlers.get('check_terrain')!({ waypoints: [[-2.277, 50.6212], [-2.277, 50.66]] }));
    expect(t.startsWith('POOR:')).toBe(true);
    expect(t).toContain('Elevation profile');
    const b = text(await handlers.get('check_terrain')!({ waypoints: [[-2.277, 50.6212], [-2.277, 50.66]], format: 'brief' }));
    expect(b).toMatch(/^Terrain along your route rises up to \d+ metres/);
  });
  it('samples a grid around a point and reports the highest ground with a bearing', async () => {
    const { handlers } = setup(LIVE_ROUTES);
    const j = json(await handlers.get('check_terrain')!({ lat: 50.6212, lon: -2.277, radius_m: 500, format: 'json' }));
    expect(j.mode).toBe('point');
    expect(j.samples.length).toBe(49);
    expect(j.summary.highest.where).toMatch(/m to the N/);
    expect(j.status).toBe('good');
  });
  it('rejects mixed inputs, missing inputs and over-long routes', async () => {
    const { handlers } = setup(LIVE_ROUTES);
    const h = handlers.get('check_terrain')!;
    await expect(h({ waypoints: [[-2, 50], [-2, 50.1]], lat: 50, lon: -2 })).rejects.toThrow(/not both/);
    await expect(h({})).rejects.toThrow(/waypoints/);
    await expect(h({ waypoints: [[-2, 50], [-2, 51.5]] })).rejects.toThrow(/maximum for a terrain profile/);
  });
});
