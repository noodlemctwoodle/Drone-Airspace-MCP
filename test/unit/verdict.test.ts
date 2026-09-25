import { describe, expect, it } from 'vitest';
import { buildVerdict, rankZones, routeVerdict } from '../../src/services/airspace/verdict.js';
import { isRelevantBelow120m, splitByRelevance } from '../../src/services/airspace/vertical.js';
import { FIXTURE_RESTRICTIONS, FIXTURE_ZONES } from '../helpers/fake-pack-repository.js';

const [frz, prohibited, danger, high] = FIXTURE_ZONES;

describe('verdict', () => {
  it('orders prohibited above frz above danger', () => {
    expect(rankZones([danger, frz, prohibited]).map((z) => z.zoneType)).toEqual(['prohibited', 'frz', 'danger']);
  });
  it('uses the exact wording per type', () => {
    expect(buildVerdict([frz], []).line).toBe('Inside EGGD BRISTOL FRZ (FRZ) - permission from Bristol ATC 01275 473 500 required before flying.');
    expect(buildVerdict([prohibited], []).line).toBe('Inside EG P106 HINKLEY POINT (Prohibited Area) - drone flying is not permitted.');
    expect(buildVerdict([danger], []).line).toBe('Inside EG D118 PENDINE (Danger Area) - check activation before flying: By NOTAM.');
    expect(buildVerdict([], []).line).toBe('No permanent airspace restriction at this point.');
  });
  it('appends the count of further restrictions', () => {
    expect(buildVerdict([frz, danger], []).line).toMatch(/\(\+1 further restriction below\)$/);
  });
  it('adds a landowner line', () => {
    const v = buildVerdict([], [FIXTURE_RESTRICTIONS[0]]);
    expect(v.landownerLine).toContain('Landowner rule: Brownsea Island (National Trust (always open land))');
  });
  it('route verdict counts crossings', () => {
    expect(routeVerdict([frz, danger]).line).toMatch(/^Route crosses 2 restrictions; highest: Enters EGGD/);
    expect(routeVerdict([]).line).toBe('No permanent airspace restriction along this route.');
  });
});

describe('vertical relevance', () => {
  it('keeps SFC zones and drops high-level ones', () => {
    expect(isRelevantBelow120m(frz)).toBe(true);
    expect(isRelevantBelow120m(high)).toBe(false);
    const { relevant, above } = splitByRelevance(FIXTURE_ZONES);
    expect(relevant.map((z) => z.id)).toEqual([1, 2, 3]);
    expect(above.map((z) => z.id)).toEqual([4]);
  });
});
