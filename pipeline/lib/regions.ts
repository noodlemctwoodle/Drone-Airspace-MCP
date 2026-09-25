import type { BBox } from '../../src/types.js';

export interface Region {
  name: string;
  bbox: BBox;
  /** rowmaps authority codes, or 'all'. */
  authorities: string[] | 'all';
}

export const REGIONS: Record<string, Region> = {
  national: { name: 'national', bbox: [-14, 48, 5, 62.5], authorities: 'all' }, // wide enough for every UK FIR danger area, including offshore ones
  'south-west': {
    name: 'south-west',
    bbox: [-6.5, 49.8, -1.5, 51.8],
    authorities: ['BS', 'BZ', 'CN', 'DN', 'DT', 'GR', 'NS', 'PY', 'SD', 'SG', 'ST', 'TB', 'WT'],
  },
  wales: { name: 'wales', bbox: [-5.4, 51.3, -2.6, 53.5], authorities: 'wales' as unknown as string[] },
  scotland: { name: 'scotland', bbox: [-8.7, 54.6, -0.7, 61], authorities: [] }, // no rowmaps councils; paths come from the core paths source
};

export function resolveRegion(name: string | undefined, bboxArg?: string): Region {
  if (bboxArg) {
    const parts = bboxArg.split(',').map(Number);
    if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n))) throw new Error(`--bbox must be w,s,e,n; got "${bboxArg}"`);
    return { name: name ?? 'custom', bbox: parts as BBox, authorities: 'all' };
  }
  const region = REGIONS[name ?? 'national'];
  if (!region) throw new Error(`unknown region "${name}"; known: ${Object.keys(REGIONS).join(', ')}`);
  return region;
}

export function bboxIntersects(a: BBox, b: BBox): boolean {
  return a[0] <= b[2] && a[2] >= b[0] && a[1] <= b[3] && a[3] >= b[1];
}
