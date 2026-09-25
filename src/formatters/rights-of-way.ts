import type { RightOfWayHit } from '../types.js';
import { formatCoord, formatDistance } from './units.js';

const PATH_LABEL: Record<string, string> = {
  footpath: 'Public footpath',
  bridleway: 'Public bridleway',
  restricted_byway: 'Restricted byway',
  boat: 'Byway open to all traffic',
};

export function renderRightOfWay(hit: RightOfWayHit): string {
  const label = PATH_LABEL[hit.pathType] ?? hit.pathType;
  const ref = [hit.routeNo, hit.routeName].filter((p) => p && p.trim() !== '').join(' ');
  const parts = [`${formatDistance(hit.distanceM)} away: ${label}${ref ? ` ${ref}` : ''}`];
  if (hit.parish) parts.push(`parish ${hit.parish}`);
  parts.push(`${hit.authorityName}`);
  parts.push(`nearest point ${formatCoord(hit.nearestPoint[1], hit.nearestPoint[0])}`);
  return parts.join('; ');
}

export function rightOfWayToJson(hit: RightOfWayHit) {
  const { geometry: _geometry, attribution: _attribution, ...rest } = hit;
  return rest;
}
