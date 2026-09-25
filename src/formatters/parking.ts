import type { ParkingHit } from '../types.js';
import { formatDistance } from './units.js';

const KIND_LABEL: Record<string, string> = { car_park: 'Car park', layby: 'Layby', rest_area: 'Rest area', street_side: 'Street parking' };

export function parkingLabel(p: ParkingHit): string {
  return `${p.name ?? KIND_LABEL[p.kind] ?? p.kind}${p.name ? ` (${(KIND_LABEL[p.kind] ?? p.kind).toLowerCase()})` : ''}`;
}

export function renderParking(p: ParkingHit): string {
  const parts = [`${formatDistance(p.distanceM)} away: ${parkingLabel(p)}`];
  if (p.fee) parts.push(p.fee === 'yes' ? 'fee' : p.fee === 'no' ? 'free' : `fee ${p.fee}`);
  if (p.access && p.access !== 'yes' && p.access !== 'public') parts.push(`access ${p.access}`);
  if (p.capacity) parts.push(`${p.capacity} spaces`);
  if (p.operator) parts.push(p.operator);
  return parts.join('; ');
}

export function parkingSentence(p: ParkingHit): string {
  return `${parkingLabel(p)} ${formatDistance(p.distanceM)} away${p.fee === 'yes' ? ' (pay to park)' : p.fee === 'no' ? ' (free)' : ''}`;
}
