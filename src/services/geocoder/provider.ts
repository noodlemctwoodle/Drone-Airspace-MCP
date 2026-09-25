import type { GeocodeCandidate } from '../../types.js';

export interface GeocodeProvider {
  readonly name: string;
  /** Whether this provider should be tried for the query at all. */
  canHandle(query: string): boolean;
  search(query: string, limit: number): Promise<GeocodeCandidate[]>;
}

export function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(1, n));
}
