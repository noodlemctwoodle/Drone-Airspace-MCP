import type { LandRestriction, Severity, Verdict, Zone, ZoneType } from '../../types.js';
import { truncate } from '../../formatters/units.js';

export const SEVERITY: Record<ZoneType, Severity> = {
  prohibited: 5,
  restricted: 4,
  frz: 3,
  danger: 2,
  other: 1,
  prison: 4,
};

export const TYPE_LABEL: Record<ZoneType, string> = {
  frz: 'FRZ',
  prohibited: 'Prohibited Area',
  restricted: 'Restricted Area',
  danger: 'Danger Area',
  other: 'Other restriction',
  prison: 'Prison restricted area',
};

export function severityOf(zone: Zone): Severity {
  return SEVERITY[zone.zoneType];
}

/** Highest severity first, then by name for stability. */
export function rankZones(zones: Zone[]): Zone[] {
  return [...zones].sort((a, b) => severityOf(b) - severityOf(a) || a.name.localeCompare(b.name));
}

function zoneTitle(zone: Zone): string {
  const parts = [zone.designator, zone.name].filter((p): p is string => !!p && p.trim() !== '');
  if (parts.length === 2 && parts[1].toUpperCase().includes(parts[0].toUpperCase())) return parts[1];
  return parts.join(' ');
}

export function zoneVerdictLine(zone: Zone, verb: 'Inside' | 'Enters'): string {
  const title = zoneTitle(zone);
  const label = TYPE_LABEL[zone.zoneType];
  switch (zone.zoneType) {
    case 'frz':
      return `${verb} ${title} (${label}) - permission from ${zone.contact ? truncate(zone.contact, 120) : 'the aerodrome'} required before flying.`;
    case 'prohibited':
      return `${verb} ${title} (${label}) - drone flying is not permitted.`;
    case 'restricted':
      return `${verb} ${title} (${label}) - flying not permitted without permission from ${zone.contact ? truncate(zone.contact, 120) : 'the controlling authority'}.`;
    case 'danger':
      return `${verb} ${title} (${label}) - check activation before flying${zone.activation ? `: ${truncate(zone.activation, 120)}` : ''}.`;
    case 'prison':
      return `${verb} ${title} (${label}) - it is an offence to fly an unmanned aircraft here (within about 400 m of the prison${/SI 2023\/1101/.test(zone.notes ?? '') ? ', SI 2023/1101' : ''}) unless ${zone.contact && /^HMPPS/i.test(zone.contact) ? truncate(zone.contact, 120) : `HMPPS${zone.contact ? ` (${truncate(zone.contact, 120)})` : ''}`} has granted permission; there is no exemption for recreational flights.`;
    default:
      return `${verb} ${title} (${zone.rawType ? truncate(zone.rawType, 40) : label}) - see notes before flying.`;
  }
}

export const SOURCE_LABEL: Record<string, string> = {
  nt_always_open: 'National Trust (always open land)',
  nt_limited_access: 'National Trust (limited access)',
  byelaws: 'Council byelaw',
};

export function restrictionLabel(r: LandRestriction): string {
  if (SOURCE_LABEL[r.sourceId]) return SOURCE_LABEL[r.sourceId];
  switch (r.kind) {
    case 'byelaw':
      return 'Council byelaw';
    case 'pspo':
      return 'Public Space Protection Order';
    case 'policy':
      return 'Council policy';
    default:
      return r.owner;
  }
}

export function landownerLine(restrictions: LandRestriction[]): string | null {
  const banned = restrictions.filter((r) => r.takeoffBanned);
  const pick = banned[0] ?? restrictions[0];
  if (!pick) return null;
  const sentence = pick.summary ? pick.summary.split(/(?<=[.!?])\s/)[0] : `${pick.owner} land`;
  const extra = restrictions.length > 1 ? ` (+${restrictions.length - 1} further rule${restrictions.length > 2 ? 's' : ''})` : '';
  return `Landowner rule: ${pick.name} (${restrictionLabel(pick)}) - ${truncate(sentence, 200)}${extra}`;
}

export function buildVerdict(relevantZones: Zone[], restrictions: LandRestriction[], verb: 'Inside' | 'Enters' = 'Inside'): Verdict {
  const ranked = rankZones(relevantZones);
  const top = ranked[0];
  const landowner = landownerLine(restrictions);
  if (!top) {
    return {
      severity: 0,
      line: verb === 'Inside' ? 'No permanent airspace restriction at this point.' : 'No permanent airspace restriction along this route.',
      zoneId: null,
      landownerLine: landowner,
    };
  }
  const more = ranked.length - 1;
  const suffix = more > 0 ? ` (+${more} further restriction${more > 1 ? 's' : ''} below)` : '';
  return { severity: severityOf(top), line: `${zoneVerdictLine(top, verb)}${suffix}`, zoneId: top.id, landownerLine: landowner };
}

export function routeVerdict(crossings: Zone[], restrictions: LandRestriction[] = []): Verdict {
  const v = buildVerdict(crossings, restrictions, 'Enters');
  if (v.severity === 0) return v;
  const n = crossings.length;
  return { ...v, line: `Route crosses ${n} restriction${n > 1 ? 's' : ''}; highest: ${v.line}` };
}
