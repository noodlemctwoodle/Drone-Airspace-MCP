import type { HandlerDependencies } from '../handlers/deps.js';
import { metresToDegrees } from '../pack/geometry.js';
import { HAZARD_KINDS } from '../pack/schema.js';
import type { PackRepository } from '../pack/repository.js';
import type { Geometry } from 'geojson';
import type { Hazard } from '../types.js';
import { severityOf, TYPE_LABEL } from '../services/airspace/verdict.js';
import { isRelevantBelow120m } from '../services/airspace/vertical.js';
import type { BBox, LineString, Position } from '../types.js';
import { resolveLocation } from '../services/location-resolver.js';
import { UserFacingError } from '../core/errors.js';
import type { LocationResolution } from '../types.js';
import { assessHour, compassPoint, describeWeatherCode, LIMITS, localHourKey, type Flyability } from '../services/weather/assessment.js';
import { OPEN_METEO_ATTRIBUTION } from '../services/weather/open-meteo.js';
import { assessDroneRules, DRONE_CATALOGUE } from '../services/drones/index.js';
import { SILHOUETTES } from './silhouettes.js';

export interface ViewRequest {
  lat: number;
  lon: number;
  /** Set when the point came from a place name; shown on the marker. */
  name?: string;
  /** Metres around the point to draw rights of way and parking. */
  radiusM?: number;
  /** Optional route to draw and to derive the bbox from. */
  route?: Position[];
  includeNotams?: boolean;
  includeWeather?: boolean;
}

/** Conditions at the centre point for the coming hour, for the map's weather badge. */
export interface ViewWeather {
  time: string;
  flyability: Flyability;
  summary: string;
  reasons: string[];
  windMs: number | null;
  gustMs: number | null;
  /** Wind at 120 m, the open-category ceiling; usually stronger than at 10 m. */
  wind120Ms: number | null;
  windFrom: string;
  /** Meteorological direction the wind blows from, degrees clockwise from north. */
  windDirectionDeg: number | null;
  /** Wind alone rated against the advisory thresholds, for the arrow colour. */
  windLevel: Flyability;
  temperatureC: number | null;
  /** Every forecast hour from now, for the timeline; the same rating rules as the badge. */
  hours: ViewWeatherHour[];
  /** One entry per forecast day: how many daylight hours rate good, caution and poor. */
  days: ViewWeatherDay[];
}

export interface ViewWeatherHour {
  time: string;
  flyability: Flyability;
  summary: string;
  reasons: string[];
  windMs: number | null;
  gustMs: number | null;
  wind120Ms: number | null;
  windFrom: string;
  windDirectionDeg: number | null;
  temperatureC: number | null;
  precipitationProbability: number | null;
}

export interface ViewWeatherDay {
  date: string;
  /** The best rating of any daylight hour (06:00 to 20:00 local). */
  flyability: Flyability;
  good: number;
  caution: number;
  poor: number;
}

const DAYLIGHT = { from: 6, to: 20 };
const RANK: Record<Flyability, number> = { good: 0, caution: 1, poor: 2 };

/** Long features are fetched with a generous cap so a motorway is never dropped; dense point kinds keep the nearest. */
const LINE_HAZARD_KINDS = ['railway', 'motorway', 'trunk_road', 'power_line', 'military'] as const;
const OTHER_HAZARD_KINDS = HAZARD_KINDS.filter((k) => !(LINE_HAZARD_KINDS as readonly string[]).includes(k));
const LINE_HAZARD_LIMIT = 1500;
const POINT_HAZARD_LIMIT = 600;
export async function viewHazards(pack: PackRepository, bbox: BBox, lon: number, lat: number): Promise<Array<Hazard & { geometry: Geometry }>> {
  const lines = await pack.hazardsInBbox(bbox, LINE_HAZARD_LIMIT, LINE_HAZARD_KINDS);
  const others = await pack.hazardsInBbox(bbox, 4000, OTHER_HAZARD_KINDS);
  const nearest = others
    .map((h) => ({ h, d: (h.lon - lon) ** 2 + ((h.lat - lat) * 1.6) ** 2 }))
    .sort((a, b) => a.d - b.d)
    .slice(0, POINT_HAZARD_LIMIT)
    .map((x) => x.h);
  return [...lines, ...nearest];
}

/** Timeline and day summaries from the hours at or after `fromKey`. */
export function weatherTimeline(hourly: Array<Parameters<typeof assessHour>[0]>, fromKey: string): { hours: ViewWeatherHour[]; days: ViewWeatherDay[] } {
  const hours: ViewWeatherHour[] = [];
  const byDay = new Map<string, ViewWeatherDay>();
  for (const h of hourly) {
    if (h.time < fromKey) continue;
    const a = assessHour(h);
    hours.push({
      time: h.time, flyability: a.flyability, summary: describeWeatherCode(h.weatherCode), reasons: a.reasons,
      windMs: h.windMs, gustMs: h.gustMs, wind120Ms: h.wind120Ms, windFrom: compassPoint(h.windDirectionDeg), windDirectionDeg: h.windDirectionDeg,
      temperatureC: h.temperatureC, precipitationProbability: h.precipitationProbability,
    });
    const date = h.time.slice(0, 10);
    const hourOfDay = Number(h.time.slice(11, 13));
    if (hourOfDay < DAYLIGHT.from || hourOfDay >= DAYLIGHT.to) continue;
    const day = byDay.get(date) ?? { date, flyability: 'poor', good: 0, caution: 0, poor: 0 };
    day[a.flyability] += 1;
    if (RANK[a.flyability] < RANK[day.flyability]) day.flyability = a.flyability;
    byDay.set(date, day);
  }
  return { hours, days: [...byDay.values()] };
}

export function windLevelOf(h: { windMs: number | null; gustMs: number | null; wind120Ms: number | null }): Flyability {
  if ((h.gustMs ?? 0) >= LIMITS.gustNoFlyMs || (h.windMs ?? 0) >= LIMITS.windStrongMs) return 'poor';
  if ((h.windMs ?? 0) >= LIMITS.windCautionMs || (h.wind120Ms ?? 0) >= LIMITS.windStrongMs) return 'caution';
  return 'good';
}

/** Everything the map needs, as plain GeoJSON-ish JSON. Kept small: no notes, no attribution text. */
export interface ViewData {
  centre: { lat: number; lon: number; name?: string };
  bbox: BBox;
  route: Position[] | null;
  zones: Array<{ type: 'Feature'; properties: { id: number; designator: string | null; name: string; zoneType: string; label: string; severity: number; relevant: boolean; limits: string }; geometry: unknown }>;
  rightsOfWay: Array<{ type: 'Feature'; properties: { id: number; pathType: string; routeNo: string | null; authority: string; distanceM: number }; geometry: LineString }>;
  landRestrictions: Array<{ type: 'Feature'; properties: { id: number; entryId: string | null; name: string; owner: string; kind: string; takeoffBanned: boolean }; geometry: unknown }>;
  parking: Array<{ lat: number; lon: number; name: string | null; kind: string; fee: string | null; distanceM: number }>;
  hazards: Array<{ type: 'Feature'; properties: { id: number; kind: string; name: string | null; operator: string | null }; geometry: unknown }>;
  notams: Array<{ id: string; lat: number; lon: number; radiusKm: number; itemE: string }>;
  /** Null when the forecast is off or unavailable; the map then shows the radar only. */
  weather: ViewWeather | null;
  attribution: string[];
  generatedAt: string;
}

export async function buildViewData(deps: HandlerDependencies, req: ViewRequest): Promise<ViewData> {
  const pack = deps.pack.require();
  const radiusM = Math.min(Math.max(req.radiusM ?? 1500, 200), 10_000);
  const { dLat, dLon } = metresToDegrees(radiusM, req.lat);
  let bbox: BBox = [req.lon - dLon, req.lat - dLat, req.lon + dLon, req.lat + dLat];
  if (req.route && req.route.length >= 2) {
    const lons = req.route.map((p) => p[0]);
    const lats = req.route.map((p) => p[1]);
    bbox = [Math.min(...lons) - dLon, Math.min(...lats) - dLat, Math.max(...lons) + dLon, Math.max(...lats) + dLat];
  }
  const [zones, paths, land, parking, hazards, meta] = await Promise.all([
    pack.zonesInBbox(bbox),
    pack.nearestRightsOfWay(req.lon, req.lat, radiusM, 40),
    pack.landRestrictionsInBbox(bbox, 300),
    pack.nearestParking(req.lon, req.lat, Math.max(radiusM, 2000), 15, false),
    viewHazards(pack, bbox, req.lon, req.lat),
    pack.meta(),
  ]);
  let notams: ViewData['notams'] = [];
  if (req.includeNotams !== false) {
    try {
      const q = await deps.notams.nearPoint(req.lon, req.lat, Math.max(radiusM / 1000, 5), deps.now());
      notams = [...q.covering, ...q.nearby].slice(0, 30).map((n) => ({ id: n.id, lat: n.centre![1], lon: n.centre![0], radiusKm: n.radiusKm ?? 0, itemE: n.itemE.slice(0, 160) }));
    } catch {
      notams = [];
    }
  }
  let weather: ViewWeather | null = null;
  if (req.includeWeather !== false) {
    try {
      const forecast = await deps.weather.forecast(req.lat, req.lon);
      const key = localHourKey(deps.now());
      const hour = forecast.hourly.find((h) => h.time >= key) ?? null;
      if (hour) {
        const a = assessHour(hour);
        weather = {
          time: hour.time,
          flyability: a.flyability,
          summary: describeWeatherCode(hour.weatherCode),
          reasons: a.reasons,
          windMs: hour.windMs,
          gustMs: hour.gustMs,
          wind120Ms: hour.wind120Ms,
          windFrom: compassPoint(hour.windDirectionDeg),
          windDirectionDeg: hour.windDirectionDeg,
          windLevel: windLevelOf(hour),
          temperatureC: hour.temperatureC,
          ...weatherTimeline(forecast.hourly, key),
        };
      }
    } catch {
      weather = null;
    }
  }
  const used = new Set<string>(['nats_uas']);
  if (paths.length) used.add('rowmaps');
  for (const l of land) used.add(l.sourceId);
  if (parking.length) used.add('osm_parking');
  if (hazards.length) used.add('osm_hazards');
  return {
    centre: { lat: req.lat, lon: req.lon, ...(req.name ? { name: req.name } : {}) },
    bbox,
    route: req.route ?? null,
    zones: zones.map((z) => ({
      type: 'Feature',
      properties: {
        id: z.id,
        designator: z.designator,
        name: z.name,
        zoneType: z.zoneType,
        label: TYPE_LABEL[z.zoneType],
        severity: severityOf(z),
        relevant: isRelevantBelow120m(z),
        limits: `${z.lower.raw ?? '?'} to ${z.upper.raw ?? '?'}`,
      },
      geometry: z.geometry,
    })),
    rightsOfWay: paths.map((p) => ({ type: 'Feature', properties: { id: p.id, pathType: p.pathType, routeNo: p.routeNo, authority: p.authorityName, distanceM: p.distanceM }, geometry: p.geometry })),
    landRestrictions: land.filter((l) => l.scope !== 'authority').map((l) => ({ type: 'Feature', properties: { id: l.id, entryId: l.entryId, name: l.name, owner: l.owner, kind: l.kind, takeoffBanned: l.takeoffBanned }, geometry: l.geometry })),
    parking: parking.map((p) => ({ lat: p.lat, lon: p.lon, name: p.name, kind: p.kind, fee: p.fee, distanceM: p.distanceM })),
    hazards: hazards.map((h) => ({ type: 'Feature', properties: { id: h.id, kind: h.kind, name: h.name, operator: h.operator }, geometry: h.geometry })),
    notams,
    weather,
    attribution: meta.sources.filter((s) => used.has(s.id)).map((s) => s.attribution).concat(weather ? [OPEN_METEO_ATTRIBUTION] : [], ['Map © OpenStreetMap contributors']),
    generatedAt: deps.now().toISOString(),
  };
}

/**
 * Parse `/api/view` or `/map` query parameters. Accepts lat/lon, or `place`
 * (geocoded), plus `route` (lon,lat pairs) or `waypoints` (names or pairs,
 * geocoded). Returns undefined when nothing usable is given.
 */
export async function resolveViewQuery(params: URLSearchParams, deps: HandlerDependencies): Promise<ViewRequest | undefined> {
  const direct = parseViewQuery(params);
  const waypointsRaw = params.get('waypoints');
  let route: Position[] | undefined = direct?.route;
  let name: string | undefined = direct?.name;
  if (waypointsRaw) {
    const pts: Position[] = [];
    for (const wp of waypointsRaw.split(';').map((s) => s.trim()).filter(Boolean)) {
      const pair = wp.split(',').map(Number);
      if (pair.length === 2 && pair.every(Number.isFinite)) {
        pts.push([pair[0], pair[1]]);
        continue;
      }
      const r = await resolveLocation({ place: wp }, deps.geocoder);
      if (r.status === 'resolved') pts.push([r.location.lon, r.location.lat]);
      else if (r.status === 'ambiguous' && r.candidates[0]) pts.push([r.candidates[0].lon, r.candidates[0].lat]);
    }
    if (pts.length >= 2) route = pts;
  }
  if (direct) return { ...direct, route, name };
  const place = params.get('place')?.trim();
  if (place) {
    const r = await resolveLocation({ place }, deps.geocoder);
    const c = r.status === 'resolved' ? r.location : r.status === 'ambiguous' ? r.candidates[0] : undefined;
    if (c) {
      const radius = Number(params.get('radius'));
      return { lat: c.lat, lon: c.lon, name: c.name, radiusM: Number.isFinite(radius) ? radius : undefined, route, includeNotams: params.get('notams') !== '0', includeWeather: params.get('weather') !== '0' };
    }
  }
  if (route && route.length >= 2) {
    const radius = Number(params.get('radius'));
    return { lat: route[0][1], lon: route[0][0], radiusM: Number.isFinite(radius) ? radius : undefined, route, includeNotams: params.get('notams') !== '0', includeWeather: params.get('weather') !== '0' };
  }
  return undefined;
}

export function parseViewQuery(params: URLSearchParams): ViewRequest | undefined {
  const lat = Number(params.get('lat'));
  const lon = Number(params.get('lon'));
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || lat < 49 || lat > 62 || lon < -14 || lon > 5) return undefined;
  const radius = Number(params.get('radius'));
  const routeRaw = params.get('route');
  let route: Position[] | undefined;
  if (routeRaw) {
    route = routeRaw
      .split(';')
      .map((pair) => pair.split(',').map(Number))
      .filter((p) => p.length === 2 && p.every(Number.isFinite))
      .map((p) => [p[0], p[1]] as Position);
    if (route.length < 2) route = undefined;
  }
  const name = params.get('name')?.trim().slice(0, 120) || undefined;
  return { lat, lon, name, radiusM: Number.isFinite(radius) ? radius : undefined, route, includeNotams: params.get('notams') !== '0', includeWeather: params.get('weather') !== '0' };
}

/** What the map's search box gets back from `/api/geocode?q=`: never a guess, ambiguity is a list to pick from. */
export type GeocodeResponse =
  | { status: 'resolved'; location: { name: string; lat: number; lon: number } }
  | { status: 'ambiguous'; candidates: Array<{ name: string; lat: number; lon: number }> }
  | { status: 'not_found'; reason?: string };

const COORD_PAIR = /^\s*(-?\d{1,2}(?:\.\d+)?)\s*[,\s]\s*(-?\d{1,3}(?:\.\d+)?)\s*$/;

/** Resolve the search box query; `undefined` when `q` is missing or blank. */
export async function geocodeQuery(params: URLSearchParams, deps: HandlerDependencies): Promise<GeocodeResponse | undefined> {
  const q = params.get('q')?.trim().slice(0, 200);
  if (!q) return undefined;
  const pair = COORD_PAIR.exec(q);
  let r: LocationResolution;
  try {
    r = pair ? await resolveLocation({ lat: Number(pair[1]), lon: Number(pair[2]) }, deps.geocoder) : await resolveLocation({ place: q }, deps.geocoder);
  } catch (error) {
    if (error instanceof UserFacingError) return { status: 'not_found', reason: error.message };
    throw error;
  }
  const slim = (c: { name: string; lat: number; lon: number }) => ({ name: c.name, lat: c.lat, lon: c.lon });
  if (r.status === 'resolved') return { status: 'resolved', location: slim(r.location) };
  if (r.status === 'ambiguous') return { status: 'ambiguous', candidates: r.candidates.slice(0, 6).map(slim) };
  return { status: 'not_found' };
}

export function mapUrl(base: string | undefined, req: { lat: number; lon: number; radiusM?: number; route?: Position[]; drone?: string; spots?: Array<{ lat: number; lon: number }> }): string | null {
  if (!base) return null;
  const q = new URLSearchParams({ lat: req.lat.toFixed(5), lon: req.lon.toFixed(5) });
  if (req.radiusM) q.set('radius', String(Math.round(req.radiusM)));
  if (req.drone) q.set('drone', req.drone);
  if (req.spots && req.spots.length > 0) q.set('spots', req.spots.slice(0, 10).map((s) => `${s.lat.toFixed(5)},${s.lon.toFixed(5)}`).join(';'));
  if (req.route && req.route.length >= 2) q.set('route', req.route.map((p) => `${p[0].toFixed(5)},${p[1].toFixed(5)}`).join(';'));
  return `${base}/map?${q.toString()}`;
}

/** A wind arrow on the map's lattice for the coming hour. */
export interface WindPoint {
  lat: number;
  lon: number;
  windMs: number | null;
  gustMs: number | null;
  wind120Ms: number | null;
  directionDeg: number | null;
  level: Flyability;
}

export interface WindField {
  time: string | null;
  spacingDeg: number;
  points: WindPoint[];
  /** Advisory thresholds so the map can rate arrows it interpolates between lattice points. */
  limits: { windCautionMs: number; windStrongMs: number; gustNoFlyMs: number };
  attribution: string;
}

export const WIND_MAX_POINTS = 64;

/**
 * Lattice points covering a bbox, snapped to a fixed grid whose spacing halves
 * with each zoom level, so panning re-uses cached points. Capped by coarsening
 * the spacing until the view fits in WIND_MAX_POINTS.
 */
export function windLattice(bbox: BBox, zoom: number): { spacingDeg: number; points: Array<{ lat: number; lon: number }> } {
  const z = Math.max(4, Math.min(16, Math.round(zoom)));
  let spacing = 2 ** (7 - z); // 1 degree at zoom 7, ~0.0078 degrees (about 900 m) at zoom 14
  for (;;) {
    const pts: Array<{ lat: number; lon: number }> = [];
    const latSpacing = spacing;
    const lonSpacing = spacing * 1.6; // roughly square on the ground at UK latitudes
    // One ring beyond the bbox on every side, so the grid always encloses the view and interpolation reaches its edges.
    const lat0 = Math.floor(bbox[1] / latSpacing) * latSpacing;
    const lon0 = Math.floor(bbox[0] / lonSpacing) * lonSpacing;
    for (let lat = lat0; lat <= bbox[3] + latSpacing; lat += latSpacing) {
      for (let lon = lon0; lon <= bbox[2] + lonSpacing; lon += lonSpacing) pts.push({ lat: Number(lat.toFixed(4)), lon: Number(lon.toFixed(4)) });
    }
    if (pts.length <= WIND_MAX_POINTS) return { spacingDeg: spacing, points: pts };
    spacing *= 2;
  }
}

export function parseWindQuery(params: URLSearchParams): { bbox: BBox; zoom: number } | undefined {
  const parts = (params.get('bbox') ?? '').split(',').map(Number);
  if (parts.length !== 4 || !parts.every(Number.isFinite)) return undefined;
  const [w, s, e, n] = parts;
  if (w >= e || s >= n || s < 48 || n > 63 || w < -15 || e > 6) return undefined;
  const zoom = Number(params.get('z'));
  return { bbox: [w, s, e, n], zoom: Number.isFinite(zoom) ? zoom : 10 };
}

/** Wind at every lattice point for the hour that is coming up now. */
export async function buildWindField(deps: HandlerDependencies, q: { bbox: BBox; zoom: number }): Promise<WindField> {
  const { spacingDeg, points } = windLattice(q.bbox, q.zoom);
  const key = localHourKey(deps.now());
  const forecasts = points.length ? await deps.weather.windField(points) : [];
  let time: string | null = null;
  const out: WindPoint[] = [];
  for (const f of forecasts) {
    const hour = f.hourly.find((h) => h.time >= key);
    if (!hour) continue;
    time ??= hour.time;
    out.push({ lat: f.latitude, lon: f.longitude, windMs: hour.windMs, gustMs: hour.gustMs, wind120Ms: hour.wind120Ms, directionDeg: hour.windDirectionDeg, level: windLevelOf(hour) });
  }
  return { time, spacingDeg, points: out, limits: { windCautionMs: LIMITS.windCautionMs, windStrongMs: LIMITS.windStrongMs, gustNoFlyMs: LIMITS.gustNoFlyMs }, attribution: OPEN_METEO_ATTRIBUTION };
}

/** Catalogue entries for the map's drone picker, with today's rules summary and the marker drawing. */
export interface DroneIndexEntry {
  id: string;
  make: string;
  model: string;
  weightG: number;
  classMark: string | null;
  silhouette: string;
  subcategory: string;
  effectiveClass: string;
  overflight: string;
  separation: string;
}

export function buildDroneIndex(now: Date): { asOf: string; silhouettes: Record<string, string>; drones: DroneIndexEntry[] } {
  const drones = DRONE_CATALOGUE.map((d) => {
    const a = assessDroneRules({ weightG: d.weightG, euClass: d.euClass, ukClass: d.ukClass, camera: d.camera, remoteId: d.remoteId }, now);
    return {
      id: d.id,
      make: d.make,
      model: d.model,
      weightG: d.weightG,
      classMark: d.ukClass ?? d.euClass,
      silhouette: d.silhouette,
      subcategory: a.subcategoryWithA2Certificate ? `${a.subcategory} (${a.subcategoryWithA2Certificate} with A2 CofC)` : a.subcategory,
      effectiveClass: a.effectiveClass,
      overflight: a.overflight,
      separation: a.separation,
    };
  });
  drones.sort((x, y) => x.make.localeCompare(y.make) || x.model.localeCompare(y.model));
  return { asOf: now.toISOString().slice(0, 10), silhouettes: SILHOUETTES, drones };
}
