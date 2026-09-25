import { describe, expect, it } from 'vitest';
import { buildCandidates, MAX_CANDIDATES } from '../../src/services/spots/candidates.js';
import { scoreCandidate, type CandidateFacts } from '../../src/services/spots/scoring.js';
import { FIXTURE_ACCESS, FIXTURE_PARKING, FIXTURE_PROW, FIXTURE_RESTRICTIONS, FIXTURE_ZONES } from '../helpers/fake-pack-repository.js';
import type { RightOfWayHit } from '../../src/types.js';

const base: CandidateFacts = { zones: [], restrictions: [], notamCovering: [], nearestPathM: null, nearestParkingM: null, nearestHazard: null, onAccessLand: false, distanceFromCentreM: 0, radiusM: 3000, a3: false };
const line = { id: 1, osmId: null, kind: 'power_line' as const, name: null, operator: null, ref: null, lon: -2, lat: 50 };

describe('spot scoring', () => {
  it('excludes controlled airspace and take-off bans outright', () => {
    expect(scoreCandidate({ ...base, zones: [FIXTURE_ZONES[0]] }).excluded).toMatch(/BRISTOL FRZ \(FRZ\)/);
    expect(scoreCandidate({ ...base, zones: [FIXTURE_ZONES[1]] }).excluded).toMatch(/Prohibited Area/);
    expect(scoreCandidate({ ...base, zones: [FIXTURE_ZONES[4]] }).excluded).toMatch(/Prison/);
    expect(scoreCandidate({ ...base, restrictions: [FIXTURE_RESTRICTIONS[0]] }).excluded).toMatch(/take-off banned: Brownsea Island/);
    expect(scoreCandidate({ ...base, restrictions: FIXTURE_ACCESS }).excluded).toBeNull();
  });
  it('applies every term with a reason and stays deterministic', () => {
    const clean = scoreCandidate(base);
    expect(clean).toEqual({ excluded: null, score: 100, reasons: [] });
    const good = scoreCandidate({ ...base, nearestPathM: 10, nearestParkingM: 200, onAccessLand: true, distanceFromCentreM: 300 });
    expect(good.score).toBe(100 + 25 + 20 + 15 - 1);
    expect(good.reasons).toEqual(['on a public right of way', 'parking 200 m away', 'open access land']);
    const bad = scoreCandidate({ ...base, notamCovering: [{ id: 'H1/26', itemE: 'Parachuting' } as never], zones: [FIXTURE_ZONES[2]], restrictions: [{ ...FIXTURE_RESTRICTIONS[0], takeoffBanned: false }], nearestHazard: { ...line, distanceM: 80 } });
    expect(bad.score).toBe(100 - 40 - 25 - 20 - 30);
    expect(bad.reasons[0]).toContain('NOTAM H1/26');
    expect(scoreCandidate({ ...base, nearestHazard: { ...line, distanceM: 150 } }).score).toBe(85);
    expect(scoreCandidate({ ...base, nearestHazard: { ...line, distanceM: 300 } }).score).toBe(100);
    expect(scoreCandidate({ ...base, a3: true, nearestHazard: { ...line, kind: 'residential' as never, distanceM: 100 } }).reasons).toContain('A3: built-up area within 150 m');
  });
});

describe('spot candidates', () => {
  const hits: RightOfWayHit[] = FIXTURE_PROW.map((p) => ({ ...p, distanceM: 50, nearestPoint: p.geometry.coordinates[1] }));
  const parking = FIXTURE_PARKING.map((p) => ({ ...p, distanceM: 100 }));
  it('samples paths, adds parking and access land, de-duplicates on a 50 m grid and orders by distance', () => {
    const c = buildCandidates({ lat: 50.6212, lon: -2.277 }, 3000, hits, parking, FIXTURE_ACCESS);
    expect(c.length).toBeGreaterThan(4);
    expect(c.length).toBeLessThanOrEqual(MAX_CANDIDATES);
    expect(c[0].distanceFromCentreM).toBeLessThanOrEqual(c[1].distanceFromCentreM);
    expect(c.some((x) => x.source === 'prow' && x.label.startsWith('footpath FP 12'))).toBe(true);
    expect(c.some((x) => x.source === 'parking')).toBe(true);
    expect(c.some((x) => x.source === 'access_land')).toBe(true);
    const keys = new Set(c.map((x) => `${Math.round(x.lat / 0.00045)},${Math.round(x.lon / 0.0007)}`));
    expect(keys.size).toBe(c.length);
    expect(buildCandidates({ lat: 50.6212, lon: -2.277 }, 3000, hits, parking, FIXTURE_ACCESS)).toEqual(c);
    expect(buildCandidates({ lat: 55, lon: -3 }, 500, hits, parking, FIXTURE_ACCESS)).toEqual([]);
  });
});
