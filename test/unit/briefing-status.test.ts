import { describe, expect, it } from 'vitest';
import { deriveBriefingStatus, type BriefingInput } from '../../src/services/briefing/status.js';
import { FIXTURE_RESTRICTIONS, FIXTURE_ZONES } from '../helpers/fake-pack-repository.js';

const base: BriefingInput = { zones: [], restrictions: [], frzPermission: false, notams: { covering: [], nearby: [], unlocated: 0 }, weather: 'good', kp: 'quiet', hazards: [], coverage: 'england_wales', pathsWithin1km: 2, droneSubcategory: null };
const frz = FIXTURE_ZONES[0];
const prohibited = FIXTURE_ZONES[1];
const danger = FIXTURE_ZONES[2];
const codes = (i: Partial<BriefingInput>) => deriveBriefingStatus({ ...base, ...i }).reasons.map((r) => r.code);

describe('briefing status', () => {
  it('is go with a clear reason when nothing applies', () => {
    const r = deriveBriefingStatus(base);
    expect(r.status).toBe('go');
    expect(r.reasons).toEqual([{ level: 'go', code: 'clear', text: expect.stringContaining('weather good') }]);
  });
  it('is no-go for prohibited, prison, restricted, FRZ without permission and landowner bans', () => {
    expect(deriveBriefingStatus({ ...base, zones: [prohibited] })).toMatchObject({ status: 'no_go' });
    expect(codes({ zones: [{ ...prohibited, zoneType: 'prison' as never }] })).toContain('prison_zone');
    expect(codes({ zones: [{ ...prohibited, zoneType: 'restricted' }] })).toContain('restricted_zone');
    expect(deriveBriefingStatus({ ...base, zones: [frz] })).toMatchObject({ status: 'no_go', reasons: [expect.objectContaining({ code: 'frz', text: expect.stringContaining('Bristol ATC') })] });
    expect(deriveBriefingStatus({ ...base, restrictions: [FIXTURE_RESTRICTIONS[0]] })).toMatchObject({ status: 'no_go', reasons: [expect.objectContaining({ code: 'landowner_ban' })] });
  });
  it('downgrades an FRZ to caution once permission is held', () => {
    const r = deriveBriefingStatus({ ...base, zones: [frz], frzPermission: true });
    expect(r.status).toBe('caution');
    expect(r.reasons[0].code).toBe('frz_with_permission');
  });
  it('is caution for outages, covering NOTAMs, danger areas, poor weather, storms and near hazards', () => {
    expect(deriveBriefingStatus({ ...base, notams: null })).toMatchObject({ status: 'caution', reasons: [expect.objectContaining({ code: 'notams_unavailable' })] });
    expect(codes({ notams: { covering: [{ id: 'H1234/26', itemE: 'Parachuting' } as never], nearby: [], unlocated: 0 } })).toContain('notam_covering');
    expect(codes({ zones: [danger] })).toContain('danger_area');
    expect(codes({ zones: [{ ...danger, zoneType: 'other' }] })).toContain('other_zone');
    expect(codes({ weather: 'poor' })).toContain('weather_poor');
    expect(codes({ weather: null })).toContain('weather_unavailable');
    expect(codes({ kp: 'storm' })).toContain('geomagnetic_storm');
    const line = { id: 1, osmId: null, kind: 'power_line' as const, name: null, operator: null, ref: null, lon: -2, lat: 50 };
    expect(codes({ hazards: [{ ...line, distanceM: 120 }] })).toContain('hazard_near');
    expect(codes({ hazards: [{ ...line, distanceM: 400 }] })).not.toContain('hazard_near');
    const school = { ...line, kind: 'school' as const, name: 'Test Primary School', distanceM: 90 };
    expect(codes({ hazards: [school] })).not.toContain('hazard_near');
    expect(codes({ hazards: [school] })).toContain('site_near');
    expect(deriveBriefingStatus({ ...base, hazards: [school] }).status).toBe('go');
    expect(deriveBriefingStatus({ ...base, hazards: [school], droneSubcategory: 'A3' }).reasons.find((r) => r.code === 'site_near')?.text).toContain('A3 flights must keep 150 m');
  });
  it('adds notes that never change the status', () => {
    const r = deriveBriefingStatus({ ...base, weather: 'caution', kp: 'active', restrictions: [{ ...FIXTURE_RESTRICTIONS[0], takeoffBanned: false }], notams: { covering: [], nearby: [{ id: 'A' } as never], unlocated: 2 }, pathsWithin1km: 0, droneSubcategory: 'A3' });
    expect(r.status).toBe('go');
    expect(r.reasons.map((x) => x.code)).toEqual(['weather_marginal', 'geomagnetic_active', 'landowner_rule', 'notam_nearby', 'notam_unlocated', 'no_prow', 'a3_separation', 'clear']);
  });
  it('orders reasons with the worst first and the worst level wins', () => {
    const r = deriveBriefingStatus({ ...base, zones: [danger, prohibited], notams: null });
    expect(r.status).toBe('no_go');
    expect(r.reasons[0].code).toBe('prohibited_zone');
    expect(r.reasons.map((x) => x.level)).toEqual(['no_go', 'caution', 'caution']);
  });
});
