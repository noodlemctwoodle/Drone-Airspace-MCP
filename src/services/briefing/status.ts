import type { LandRestriction, NotamHit, ProwCoverage, Zone, HazardHit } from '../../types.js';
import type { Flyability } from '../weather/assessment.js';
import type { GeomagneticLevel } from '../weather/space-weather.js';
import { restrictionLabel, TYPE_LABEL } from '../airspace/verdict.js';
import { truncate } from '../../formatters/units.js';
import { HAZARD_LABEL } from '../../formatters/hazards.js';

/**
 * Deterministic go / caution / no-go for a pre-flight briefing. Rules run in a
 * fixed order; the worst level seen wins and notes never change the status.
 * A failed live source is a caution, never silently clear.
 */
export type BriefingStatus = 'go' | 'caution' | 'no_go';

export interface BriefingReason {
  level: BriefingStatus | 'note';
  code: string;
  text: string;
}

export interface BriefingInput {
  zones: Zone[];
  restrictions: LandRestriction[];
  frzPermission: boolean;
  /** Null when the NOTAM feed could not be read. */
  notams: { covering: NotamHit[]; nearby: NotamHit[]; unlocated: number } | null;
  /** Null when the forecast is unavailable or the window is outside it. */
  weather: Flyability | null;
  kp: GeomagneticLevel | null;
  hazards: HazardHit[];
  coverage: ProwCoverage | 'scotland_core_paths';
  pathsWithin1km: number;
  droneSubcategory: 'A1' | 'A2' | 'A3' | null;
}

const RANK: Record<BriefingStatus, number> = { go: 0, caution: 1, no_go: 2 };
/** Compared as strings so the prison type works before and after the pack learns it. */
const NO_GO_ZONE_TYPES = new Set<string>(['prohibited', 'prison']);

function title(z: Zone): string {
  return [z.designator, z.name].filter((p): p is string => !!p && p.trim() !== '').join(' ');
}

export function deriveBriefingStatus(i: BriefingInput): { status: BriefingStatus; reasons: BriefingReason[] } {
  const reasons: BriefingReason[] = [];
  let status: BriefingStatus = 'go';
  const add = (level: BriefingStatus | 'note', code: string, text: string) => {
    reasons.push({ level, code, text });
    if (level !== 'note' && RANK[level] > RANK[status]) status = level;
  };
  for (const z of i.zones) {
    const t = z.zoneType as string;
    if (NO_GO_ZONE_TYPES.has(t)) add('no_go', t === 'prison' ? 'prison_zone' : 'prohibited_zone', `${title(z)} (${TYPE_LABEL[z.zoneType] ?? 'Prison restricted area'}): drone flying is not permitted here.`);
  }
  for (const z of i.zones) {
    if (z.zoneType === 'restricted') add('no_go', 'restricted_zone', `${title(z)} (Restricted Area): not permitted without permission from ${z.contact ? truncate(z.contact, 120) : 'the controlling authority'}.`);
  }
  for (const z of i.zones) {
    if (z.zoneType !== 'frz') continue;
    if (i.frzPermission) add('caution', 'frz_with_permission', `${title(z)} (FRZ): fly exactly as the aerodrome agreed and keep their contact to hand${z.contact ? ` (${truncate(z.contact, 120)})` : ''}.`);
    else add('no_go', 'frz', `${title(z)} (FRZ): permission from ${z.contact ? truncate(z.contact, 120) : 'the aerodrome'} is required before flying; set frz_permission once you have it.`);
  }
  for (const r of i.restrictions) {
    if (r.takeoffBanned) add('no_go', 'landowner_ban', `Take-off banned by landowner rule: ${r.name} (${restrictionLabel(r)}).`);
  }
  if (i.notams === null) add('caution', 'notams_unavailable', 'The NOTAM bulletin could not be read; run check_notams before flying.');
  else if (i.notams.covering.length > 0) {
    const first = i.notams.covering[0];
    add('caution', 'notam_covering', `${i.notams.covering.length} NOTAM${i.notams.covering.length > 1 ? 's' : ''} cover${i.notams.covering.length > 1 ? '' : 's'} the point (${i.notams.covering.slice(0, 3).map((n) => n.id).join(', ')}): ${truncate(first.itemE, 140)}`);
  }
  for (const z of i.zones) {
    if (z.zoneType === 'danger') add('caution', 'danger_area', `${title(z)} (Danger Area): check activation before flying${z.activation ? `: ${truncate(z.activation, 120)}` : ''}.`);
  }
  for (const z of i.zones) {
    if (z.zoneType === 'other') add('caution', 'other_zone', `${title(z)} (${z.rawType ?? 'other restriction'}): see the zone notes before flying.`);
  }
  if (i.weather === 'poor') add('caution', 'weather_poor', 'Weather in the window is rated poor for a small drone.');
  if (i.weather === null) add('caution', 'weather_unavailable', 'Weather forecast unavailable for the window; check conditions yourself.');
  if (i.kp === 'storm') add('caution', 'geomagnetic_storm', 'Geomagnetic storm in progress: GPS position and compass heading may be unreliable.');
  const nearHazard = i.hazards.find((h) => h.distanceM <= 200);
  if (nearHazard) add('caution', 'hazard_near', `${HAZARD_LABEL[nearHazard.kind] ?? nearHazard.kind}${nearHazard.name ? ` (${nearHazard.name})` : ''} ${nearHazard.distanceM} m away.`);
  if (i.weather === 'caution') add('note', 'weather_marginal', 'Weather in the window is marginal in places; see the hourly ratings.');
  if (i.kp === 'active') add('note', 'geomagnetic_active', 'Raised geomagnetic activity: GPS accuracy may be reduced.');
  const rules = i.restrictions.filter((r) => r.kind !== 'access_land' && r.kind !== 'designation');
  const softRule = rules.find((r) => !r.takeoffBanned);
  if (softRule && !rules.some((r) => r.takeoffBanned)) add('note', 'landowner_rule', `Landowner rule applies: ${softRule.name} (${restrictionLabel(softRule)})${softRule.summary ? ` - ${truncate(softRule.summary.split(/(?<=[.!?])\s/)[0], 160)}` : ''}`);
  if (i.notams && i.notams.nearby.length > 0) add('note', 'notam_nearby', `${i.notams.nearby.length} NOTAM${i.notams.nearby.length > 1 ? 's' : ''} in force nearby; see the NOTAM section.`);
  if (i.notams && i.notams.unlocated > 0) add('note', 'notam_unlocated', `${i.notams.unlocated} NOTAM${i.notams.unlocated > 1 ? 's' : ''} without a usable position are in force; check_notams lists them.`);
  if ((i.coverage === 'england_wales' || i.coverage === 'unknown' || i.coverage === 'scotland_core_paths') && i.pathsWithin1km === 0) add('note', 'no_prow', 'No public right of way within 1 km; confirm you have the landowner\'s permission to take off.');
  const access = i.restrictions.filter((r) => r.kind === 'access_land');
  if (access.length > 0) add('note', 'access_land', 'Open access land: the public may walk here off paths; that is not itself permission to take off, so check the landowner rules above.');
  const des = i.restrictions.filter((r) => r.kind === 'designation');
  if (des.length > 0) add('note', 'designation', `${des.map((r) => r.name).slice(0, 2).join(' and ')}: ${des.some((r) => r.accessClass === 'sssi') ? 'protected wildlife, do not disturb it' : 'follow the park authority\'s drone guidance'}.`);
  if (i.droneSubcategory === 'A3') add('note', 'a3_separation', 'Your drone flies in A3: keep 150 m from residential, commercial, industrial and recreational areas; this server has no built-up-area layer to check that for you.');
  if (status === 'go') add('go', 'clear', `No permanent restriction at this point, no NOTAM covering it${i.weather ? `, weather ${i.weather} for the window` : ''}.`);
  return { status, reasons };
}
