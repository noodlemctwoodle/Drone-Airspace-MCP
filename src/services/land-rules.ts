import type { AdminArea, LandRestriction } from '../types.js';

/**
 * Land restriction rows mean different things: bans and rules on a site,
 * council-wide policy notes carried on the council boundary, open access
 * land, and advisory designations. Handlers split them with these helpers so
 * a policy note never reads as a district-wide ban and access land never reads
 * as permission.
 */
export const RULE_KINDS = new Set<LandRestriction['kind']>(['landowner', 'byelaw', 'pspo', 'policy']);

export interface LandSplit {
  /** Site-level rules: landowner bans, byelaws, PSPOs, site policies. */
  rules: LandRestriction[];
  /** Council-wide policy notes (scope authority). */
  policies: LandRestriction[];
  accessLand: LandRestriction[];
  designations: LandRestriction[];
}

export function splitLandRestrictions(restrictions: LandRestriction[]): LandSplit {
  const out: LandSplit = { rules: [], policies: [], accessLand: [], designations: [] };
  for (const r of restrictions) {
    if (r.kind === 'access_land') out.accessLand.push(r);
    else if (r.kind === 'designation') out.designations.push(r);
    else if (r.scope === 'authority') out.policies.push(r);
    else out.rules.push(r);
  }
  return out;
}

/** Attribution source ids for a set of land rows. */
export function landSourceIds(split: LandSplit): Array<'landowner' | 'byelaws' | 'forestry' | 'access_land' | 'designations'> {
  const out = new Set<'landowner' | 'byelaws' | 'forestry' | 'access_land' | 'designations'>();
  for (const r of split.rules) {
    if (r.sourceId.startsWith('nt_')) out.add('landowner');
    else if (r.sourceId === 'fe_legal_boundary') out.add('forestry');
    else out.add('byelaws');
  }
  if (split.policies.length > 0) out.add('byelaws');
  if (split.accessLand.length > 0) out.add('access_land');
  if (split.designations.length > 0) out.add('designations');
  return [...out];
}

/** Pack source ids of the land rows present, for precise attribution. */
export function landPackIds(split: LandSplit): string[] {
  return [...new Set([...split.rules, ...split.policies, ...split.accessLand, ...split.designations].map((r) => r.sourceId))];
}

/** Text lines for the "Local authority" section. */
export function localAuthorityLines(area: AdminArea | null, policies: LandRestriction[]): string[] {
  if (!area) return [];
  if (policies.length === 0) return [`${area.name} (${area.code}): no council-wide drone policy in the seed list; check the council's parks byelaws and any site rule above.`];
  return policies.map((p) => `${area.name} (${area.code}): ${p.summary ?? 'policy'}${p.sourceUrl ? ` (${p.sourceUrl}` : ''}${p.lastVerified ? `${p.sourceUrl ? ', ' : ' ('}verified ${p.lastVerified})` : p.sourceUrl ? ')' : ''}`);
}
