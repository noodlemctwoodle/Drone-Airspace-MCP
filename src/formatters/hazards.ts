import type { HazardHit, HazardKind } from '../types.js';
import { formatDistance } from './units.js';

export const HAZARD_LABEL: Record<HazardKind, string> = {
  railway: 'railway',
  motorway: 'motorway',
  trunk_road: 'trunk road',
  power_line: 'power line',
  minor_power_line: 'minor power line',
  pylon: 'pylon',
  substation: 'substation',
  power_generator: 'power generator',
  helipad: 'helipad',
  tower: 'mast or tower',
  military: 'military land',
  school: 'school',
  kindergarten: 'nursery',
  hospital: 'hospital',
  fire_station: 'fire station',
  fuel_station: 'fuel station',
  park: 'park',
  cemetery: 'cemetery',
};

/** Map and key grouping: one toggle row per group. */
export type HazardGroup = 'power' | 'transport' | 'aviation' | 'sites';
export const HAZARD_GROUP: Record<HazardKind, HazardGroup> = {
  power_line: 'power', minor_power_line: 'power', pylon: 'power', substation: 'power', power_generator: 'power',
  railway: 'transport', motorway: 'transport', trunk_road: 'transport',
  helipad: 'aviation', tower: 'aviation', military: 'aviation',
  school: 'sites', kindergarten: 'sites', hospital: 'sites', fire_station: 'sites', fuel_station: 'sites', park: 'sites', cemetery: 'sites',
};

/**
 * Physical hazards to the aircraft or to third parties on the ground: a
 * briefing treats one within 200 m as a caution and the spot finder marks a
 * candidate down for it.
 */
export const DANGER_KINDS = new Set<HazardKind>(['railway', 'motorway', 'trunk_road', 'power_line', 'minor_power_line', 'pylon', 'substation', 'power_generator', 'helipad', 'tower', 'military', 'fuel_station']);
/**
 * Places where people gather: the Drone Code's A3 separation (150 m from
 * residential, commercial, industrial and recreational areas) and the general
 * rule about crowds apply. Advisory for A1 and A2 aircraft.
 */
export const SITE_KINDS = new Set<HazardKind>(['school', 'kindergarten', 'hospital', 'fire_station', 'park', 'cemetery']);

export function isDangerHazard(h: { kind: HazardKind }): boolean {
  return DANGER_KINDS.has(h.kind);
}
export function isSiteHazard(h: { kind: HazardKind }): boolean {
  return SITE_KINDS.has(h.kind);
}

export function renderHazard(h: HazardHit): string {
  const who = [h.name, h.ref, h.operator].filter((s): s is string => !!s);
  return `${formatDistance(h.distanceM)}: ${HAZARD_LABEL[h.kind] ?? h.kind}${who.length ? ` (${who.join(', ')})` : ''}`;
}

export function hazardToJson(h: HazardHit) {
  return { id: h.id, kind: h.kind, group: HAZARD_GROUP[h.kind] ?? 'sites', name: h.name, operator: h.operator, ref: h.ref, lat: h.lat, lon: h.lon, distanceM: h.distanceM };
}
