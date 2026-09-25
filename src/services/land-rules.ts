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

/** Text lines for the "Local authority" section. */
export function localAuthorityLines(area: AdminArea | null, policies: LandRestriction[]): string[] {
  if (!area) return [];
  if (policies.length === 0) return [`${area.name} (${area.code}): no council-wide drone policy in the seed list; check the council's parks byelaws and any site rule above.`];
  return policies.map((p) => `${area.name} (${area.code}): ${p.summary ?? 'policy'}${p.sourceUrl ? ` (${p.sourceUrl}` : ''}${p.lastVerified ? `${p.sourceUrl ? ', ' : ' ('}verified ${p.lastVerified})` : p.sourceUrl ? ')' : ''}`);
}
