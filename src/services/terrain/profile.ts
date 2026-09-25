import type { Position } from '../../types.js';
import { metresToDegrees } from '../../pack/geometry.js';

/**
 * Terrain analysis against the 120 m rule. The limit is measured from the
 * closest point of the surface, so ground that rises towards a fixed-height
 * flight eats into clearance and ground that falls away can put the aircraft
 * more than 120 m above the surface.
 */
export interface TerrainSample {
  /** Along-route distance for route mode, straight-line distance in km for point mode. */
  alongKm: number;
  lat: number;
  lon: number;
  elevationM: number | null;
}

export type TerrainStatus = 'good' | 'caution' | 'poor';

export interface TerrainWarning {
  kind: 'ground_clearance' | 'above_surface_limit';
  alongKm: number;
  lat: number;
  lon: number;
  elevationM: number;
  deltaM: number;
  message: string;
}

export interface TerrainAnalysis {
  takeoffElevationM: number | null;
  minElevationM: number | null;
  maxElevationM: number | null;
  maxRiseM: number;
  maxFallM: number;
  highest: TerrainSample | null;
  lowest: TerrainSample | null;
  status: TerrainStatus;
  warnings: TerrainWarning[];
  headline: string;
  missingSamples: number;
}

export const SURFACE_LIMIT_M = 120;
const CLEARANCE_CAUTION_M = 30;
/** Falling ground only earns a warning once the flight would sit this far above the limit; the DEM is not precise enough for less. */
const SURFACE_LIMIT_MARGIN_M = 30;

export function analyseTerrain(samples: TerrainSample[], flightHeightM: number, mode: 'route' | 'point' = 'route'): TerrainAnalysis {
  const known = samples.filter((s): s is TerrainSample & { elevationM: number } => s.elevationM !== null);
  const missing = samples.length - known.length;
  const takeoff = samples[0]?.elevationM ?? null;
  if (known.length === 0 || takeoff === null) {
    return { takeoffElevationM: takeoff, minElevationM: null, maxElevationM: null, maxRiseM: 0, maxFallM: 0, highest: null, lowest: null, status: 'caution', warnings: [], headline: 'No elevation data for this area; check the ground yourself.', missingSamples: missing };
  }
  let highest = known[0];
  let lowest = known[0];
  for (const s of known) {
    if (s.elevationM > highest.elevationM) highest = s;
    if (s.elevationM < lowest.elevationM) lowest = s;
  }
  const maxRise = Math.max(0, Math.round(highest.elevationM - takeoff));
  const maxFall = Math.max(0, Math.round(takeoff - lowest.elevationM));
  const where = (s: TerrainSample) => (mode === 'route' ? `${s.alongKm.toFixed(1)} km along the route` : `${Math.round(s.alongKm * 1000)} m from the point`);
  const warnings: TerrainWarning[] = [];
  let status: TerrainStatus = 'good';
  let headline: string;
  if (maxRise >= flightHeightM) {
    status = 'poor';
    const first = known.find((s) => s.elevationM - takeoff >= flightHeightM) ?? highest;
    warnings.push({ kind: 'ground_clearance', alongKm: first.alongKm, lat: first.lat, lon: first.lon, elevationM: first.elevationM, deltaM: Math.round(first.elevationM - takeoff), message: `Ground rises ${Math.round(first.elevationM - takeoff)} m above the take-off point ${where(first)}; at ${flightHeightM} m above take-off you would be below the ground there.` });
    headline = `Terrain rises ${maxRise} m above the take-off point, more than the planned ${flightHeightM} m: a fixed height set at take-off would fly into the ground.`;
  } else if (maxRise > flightHeightM - CLEARANCE_CAUTION_M) {
    status = 'caution';
    warnings.push({ kind: 'ground_clearance', alongKm: highest.alongKm, lat: highest.lat, lon: highest.lon, elevationM: highest.elevationM, deltaM: maxRise, message: `Ground rises to within ${flightHeightM - maxRise} m of a flight at ${flightHeightM} m above take-off (${where(highest)}).` });
    headline = `Terrain rises ${maxRise} m above the take-off point, leaving ${flightHeightM - maxRise} m of clearance at ${flightHeightM} m; climb with the ground or lower the plan.`;
  } else {
    headline = `Terrain stays within ${maxRise} m above and ${maxFall} m below the take-off point; flying at ${flightHeightM} m above take-off keeps you clear of the ground.`;
  }
  if (maxFall > 0 && flightHeightM + maxFall > SURFACE_LIMIT_M + SURFACE_LIMIT_MARGIN_M) {
    if (status === 'good') status = 'caution';
    warnings.push({ kind: 'above_surface_limit', alongKm: lowest.alongKm, lat: lowest.lat, lon: lowest.lon, elevationM: lowest.elevationM, deltaM: maxFall, message: `Ground falls ${maxFall} m below take-off ${where(lowest)}; ${flightHeightM} m above take-off is ${flightHeightM + maxFall} m above the surface there, beyond the ${SURFACE_LIMIT_M} m limit unless you stay close to the slope.` });
    if (!headline.includes('below the surface')) headline += ` Ground also falls ${maxFall} m below take-off, so ${flightHeightM} m above take-off would exceed the ${SURFACE_LIMIT_M} m limit over the low ground.`;
  }
  return { takeoffElevationM: takeoff, minElevationM: lowest.elevationM, maxElevationM: highest.elevationM, maxRiseM: maxRise, maxFallM: maxFall, highest, lowest, status, warnings, headline, missingSamples: missing };
}

/** An n by n grid of sample positions around a point; the centre comes first so it is the take-off reference. */
export function gridAround(lon: number, lat: number, radiusM: number, n = 7): Array<{ lat: number; lon: number; distanceKm: number }> {
  const { dLat, dLon } = metresToDegrees(radiusM, lat);
  const out: Array<{ lat: number; lon: number; distanceKm: number }> = [{ lat, lon, distanceKm: 0 }];
  const half = (n - 1) / 2;
  for (let i = -half; i <= half; i++) {
    for (let j = -half; j <= half; j++) {
      if (i === 0 && j === 0) continue;
      const pLat = lat + (i / half) * dLat;
      const pLon = lon + (j / half) * dLon;
      const dx = ((j / half) * radiusM);
      const dy = ((i / half) * radiusM);
      out.push({ lat: Number(pLat.toFixed(5)), lon: Number(pLon.toFixed(5)), distanceKm: Math.round(Math.hypot(dx, dy)) / 1000 });
    }
  }
  return out;
}

/** Initial bearing from a to b in degrees clockwise from north. */
export function bearingDeg(a: Position, b: Position): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLon = toRad(b[0] - a[0]);
  const y = Math.sin(dLon) * Math.cos(toRad(b[1]));
  const x = Math.cos(toRad(a[1])) * Math.sin(toRad(b[1])) - Math.sin(toRad(a[1])) * Math.cos(toRad(b[1])) * Math.cos(dLon);
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}
