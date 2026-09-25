import distance from '@turf/distance';
import { point } from '@turf/helpers';
import { UserFacingError } from '../core/errors.js';
import { UK_BBOX, type LocationArgs } from '../tools/schemas.js';
import type { GeocodeCandidate, LocationResolution } from '../types.js';
import type { Geocoder } from './geocoder/index.js';

const CLUSTER_KM = 3;
const CONFIDENT = 0.9;

export function assertInUk(lat: number, lon: number): void {
  if (lat < UK_BBOX.south || lat > UK_BBOX.north || lon < UK_BBOX.west || lon > UK_BBOX.east) {
    throw new UserFacingError('Coordinates are outside the UK.');
  }
}

/**
 * Turn tool arguments into a single point, or report ambiguity / not found.
 * Candidates within 2 km of the best one are treated as the same place.
 */
export async function resolveLocation(args: LocationArgs, geocoder: Geocoder): Promise<LocationResolution> {
  if (typeof args.lat === 'number' && typeof args.lon === 'number') {
    assertInUk(args.lat, args.lon);
    return {
      status: 'resolved',
      location: { name: `${args.lat.toFixed(5)}, ${args.lon.toFixed(5)}`, lat: args.lat, lon: args.lon, source: 'input' },
    };
  }
  const query = (args.place ?? '').trim();
  if (!query) throw new UserFacingError('Give a place name, or both lat and lon.');
  const result = await geocoder.geocode(query, 5);
  if (result.candidates.length === 0) return { status: 'not_found', query };

  const top = result.candidates[0];
  const clusters: GeocodeCandidate[][] = [];
  for (const c of result.candidates) {
    const home = clusters.find((cl) => distance(point([cl[0].lon, cl[0].lat]), point([c.lon, c.lat]), { units: 'kilometers' }) <= CLUSTER_KM);
    if (home) home.push(c);
    else clusters.push([c]);
  }
  const confident = top.confidence >= CONFIDENT && top.name.toLowerCase().startsWith(result.usedQuery.toLowerCase());
  if (clusters.length > 1 && !confident) {
    return { status: 'ambiguous', query, candidates: clusters.map((cl) => cl[0]) };
  }
  const alternatives = clusters.slice(1).map((cl) => cl[0]);
  return {
    status: 'resolved',
    location: {
      name: top.name,
      lat: top.lat,
      lon: top.lon,
      source: top.source,
      ...(result.usedFallback ? { resolvedFrom: { original: query, used: result.usedQuery } } : {}),
      ...(alternatives.length > 0 ? { alternatives } : {}),
    },
  };
}
