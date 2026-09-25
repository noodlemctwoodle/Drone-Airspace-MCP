import type { HazardHit, LandRestriction, NotamHit, Zone } from '../../types.js';
import { TYPE_LABEL } from '../airspace/verdict.js';
import { truncate } from '../../formatters/units.js';

/**
 * Integer scoring of a candidate spot on the data held here. Hard exclusions
 * come first; every applied term appends a plain reason so the answer
 * explains itself. Deterministic by construction.
 */
export interface CandidateFacts {
  zones: Zone[];
  restrictions: LandRestriction[];
  notamCovering: NotamHit[];
  nearestPathM: number | null;
  nearestParkingM: number | null;
  nearestHazard: HazardHit | null;
  onAccessLand: boolean;
  distanceFromCentreM: number;
  radiusM: number;
  a3: boolean;
}

export interface CandidateScore {
  excluded: string | null;
  score: number;
  reasons: string[];
}

const EXCLUDE_ZONE_TYPES = new Set<string>(['prohibited', 'restricted', 'prison', 'frz']);
export const BUILT_UP_KINDS = new Set<string>(['residential', 'built_up', 'industrial', 'commercial', 'retail']);
const RULE_KINDS = new Set<LandRestriction['kind']>(['landowner', 'byelaw', 'pspo', 'policy']);

function zoneTitle(z: Zone): string {
  return [z.designator, z.name].filter((p): p is string => !!p && p.trim() !== '').join(' ');
}

export function scoreCandidate(f: CandidateFacts): CandidateScore {
  const blocking = f.zones.find((z) => EXCLUDE_ZONE_TYPES.has(z.zoneType));
  if (blocking) return { excluded: `inside ${zoneTitle(blocking)} (${TYPE_LABEL[blocking.zoneType]})`, score: 0, reasons: [] };
  const rules = f.restrictions.filter((r) => RULE_KINDS.has(r.kind) && r.scope !== 'authority');
  const ban = rules.find((r) => r.takeoffBanned);
  if (ban) return { excluded: `take-off banned: ${ban.name} (${ban.owner})`, score: 0, reasons: [] };

  let score = 100;
  const reasons: string[] = [];
  const apply = (delta: number, reason: string) => {
    score += delta;
    reasons.push(reason);
  };
  if (f.notamCovering.length > 0) apply(-40, `NOTAM ${f.notamCovering[0].id} covers this point: ${truncate(f.notamCovering[0].itemE, 80)}`);
  for (const z of f.zones) {
    if (z.zoneType === 'danger') apply(-25, `inside ${zoneTitle(z)} (Danger Area), check activation`);
    else if (z.zoneType === 'other') apply(-10, `inside ${zoneTitle(z)}, see the zone notes`);
  }
  const soft = rules.find((r) => !r.takeoffBanned);
  if (soft) apply(-20, `landowner rule applies, check with ${soft.owner}`);
  if (f.nearestHazard) {
    if (f.nearestHazard.distanceM < 100) apply(-30, `${f.nearestHazard.kind.replace('_', ' ')} ${f.nearestHazard.distanceM} m away`);
    else if (f.nearestHazard.distanceM <= 200) apply(-15, `${f.nearestHazard.kind.replace('_', ' ')} ${f.nearestHazard.distanceM} m away`);
    if (f.a3 && BUILT_UP_KINDS.has(f.nearestHazard.kind) && f.nearestHazard.distanceM <= 150) apply(-30, 'A3: built-up area within 150 m');
  }
  if (f.nearestPathM !== null) {
    if (f.nearestPathM <= 25) apply(25, 'on a public right of way');
    else if (f.nearestPathM <= 100) apply(10, `public right of way ${f.nearestPathM} m away`);
  }
  if (f.nearestParkingM !== null) {
    if (f.nearestParkingM <= 300) apply(20, `parking ${f.nearestParkingM} m away`);
    else if (f.nearestParkingM <= 1000) apply(10, `parking ${f.nearestParkingM} m away`);
  }
  if (f.onAccessLand) apply(15, 'open access land');
  const distancePenalty = Math.round((10 * f.distanceFromCentreM) / Math.max(1, f.radiusM));
  if (distancePenalty > 0) score -= distancePenalty;
  return { excluded: null, score, reasons };
}
