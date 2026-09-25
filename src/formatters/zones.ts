import type { LandRestriction, Zone } from '../types.js';
import { TYPE_LABEL, restrictionLabel } from '../services/airspace/verdict.js';
import { formatLimits, truncate } from './units.js';

export function renderZone(zone: Zone): string {
  const title = [zone.designator, zone.name].filter((p) => p && p.trim() !== '').join(' ');
  const parts = [`${title} (${TYPE_LABEL[zone.zoneType]}) ${formatLimits(zone.lower, zone.upper)}`];
  if (zone.activation) parts.push(`activation: ${truncate(zone.activation, 160)}`);
  if (zone.contact) parts.push(`contact: ${truncate(zone.contact, 160)}`);
  if (zone.notes) parts.push(`notes: ${truncate(zone.notes, 240)}`);
  return parts.join('; ');
}

export function renderRestriction(r: LandRestriction): string {
  const parts = [`${r.name} (${restrictionLabel(r)})`];
  parts.push(r.takeoffBanned ? 'take-off and landing not permitted' : 'see rule');
  if (r.summary) parts.push(truncate(r.summary, 200));
  if (r.lastVerified) parts.push(`verified ${r.lastVerified.slice(0, 10)}`);
  if (r.sourceUrl) parts.push(r.sourceUrl);
  return parts.join('; ');
}

export function zoneToJson(zone: Zone, withGeometry = false) {
  const { geometry, ...rest } = zone;
  return withGeometry ? { ...rest, geometry } : rest;
}
