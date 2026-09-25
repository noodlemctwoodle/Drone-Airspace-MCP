import centroid from '@turf/centroid';
import type { LandRestriction, MultiPolygon, ParkingHit, Polygon, Position, RightOfWayHit } from '../../types.js';
import { distanceKm, sampleAlongLine } from '../airspace/geometry.js';

/**
 * Candidate take-off spots: points on public rights of way, next to parking,
 * or on open access land. Deterministic: same inputs, same candidates in the
 * same order.
 */
export interface Candidate {
  lat: number;
  lon: number;
  source: 'prow' | 'parking' | 'access_land';
  label: string;
  distanceFromCentreM: number;
}

export const ACCESS_LAND_KINDS = new Set<LandRestriction['kind']>(['access_land']);
const PATH_STEP_M = 250;
const PATH_SAMPLES_MAX = 8;
const GRID_LAT = 0.00045; // about 50 m
const GRID_LON = 0.0007;
export const MAX_CANDIDATES = 60;

function pathLabel(p: RightOfWayHit): string {
  const type = p.pathType === 'core_path' ? 'core path' : p.pathType.replace('_', ' ');
  return `${type}${p.routeNo ? ` ${p.routeNo}` : ''}${p.routeName ? ` (${p.routeName})` : ''}`;
}

export function buildCandidates(centre: { lat: number; lon: number }, radiusM: number, paths: RightOfWayHit[], parking: ParkingHit[], accessLand: Array<LandRestriction & { geometry: Polygon | MultiPolygon }>): Candidate[] {
  const raw: Candidate[] = [];
  const here: Position = [centre.lon, centre.lat];
  const push = (pos: Position, source: Candidate['source'], label: string) => {
    const d = Math.round(distanceKm(here, pos) * 1000);
    if (d <= radiusM) raw.push({ lat: Number(pos[1].toFixed(5)), lon: Number(pos[0].toFixed(5)), source, label, distanceFromCentreM: d });
  };
  for (const p of paths) {
    push(p.nearestPoint, 'prow', pathLabel(p));
    const samples = sampleAlongLine(p.geometry, PATH_STEP_M).slice(0, PATH_SAMPLES_MAX);
    for (const s of samples) push(s.position, 'prow', pathLabel(p));
  }
  for (const p of parking) push([p.lon, p.lat], 'parking', p.name ? `${p.name}` : p.kind === 'layby' ? 'layby' : 'car park');
  for (const a of accessLand) {
    if (!ACCESS_LAND_KINDS.has(a.kind) || a.takeoffBanned) continue;
    try {
      push(centroid(a.geometry).geometry.coordinates as Position, 'access_land', `${a.name.toLowerCase()} (open access land)`);
    } catch {
      // skip a broken polygon
    }
  }
  // De-duplicate on a 50 m grid, nearest to the centre first.
  raw.sort((a, b) => a.distanceFromCentreM - b.distanceFromCentreM || a.lon - b.lon || a.lat - b.lat);
  const seen = new Set<string>();
  const out: Candidate[] = [];
  for (const c of raw) {
    const key = `${Math.round(c.lat / GRID_LAT)},${Math.round(c.lon / GRID_LON)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(c);
    if (out.length >= MAX_CANDIDATES) break;
  }
  return out;
}
