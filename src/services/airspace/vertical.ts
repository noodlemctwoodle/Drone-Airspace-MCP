import type { Zone } from '../../types.js';

/** 120 m / 400 ft is the UK open-category ceiling. */
export const DRONE_CEILING_FT = 400;

/**
 * A zone is relevant to a drone if any part of it lies at or below 400 ft.
 * Unknown lower limits are treated as relevant (safer to over-report).
 */
export function isRelevantBelow120m(zone: Zone): boolean {
  const { ft, ref } = zone.lower;
  if (ft === null || ref === null) return true;
  if (ref === 'sfc') return true;
  if (ref === 'fl') return ft <= DRONE_CEILING_FT;
  return ft <= DRONE_CEILING_FT;
}

export function splitByRelevance(zones: Zone[]): { relevant: Zone[]; above: Zone[] } {
  const relevant: Zone[] = [];
  const above: Zone[] = [];
  for (const z of zones) (isRelevantBelow120m(z) ? relevant : above).push(z);
  return { relevant, above };
}
