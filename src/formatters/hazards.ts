import type { HazardHit } from '../types.js';
import { formatDistance } from './units.js';

export const HAZARD_LABEL: Record<HazardHit['kind'], string> = {
  railway: 'railway',
  motorway: 'motorway',
  trunk_road: 'trunk road',
  power_line: 'power line',
  helipad: 'helipad',
  military: 'military land',
};

export function renderHazard(h: HazardHit): string {
  const who = [h.name, h.ref, h.operator].filter((s): s is string => !!s);
  return `${formatDistance(h.distanceM)}: ${HAZARD_LABEL[h.kind] ?? h.kind}${who.length ? ` (${who.join(', ')})` : ''}`;
}

export function hazardToJson(h: HazardHit) {
  return { id: h.id, kind: h.kind, name: h.name, operator: h.operator, ref: h.ref, lat: h.lat, lon: h.lon, distanceM: h.distanceM };
}
