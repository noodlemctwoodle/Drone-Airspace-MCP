import { describe, expect, it } from 'vitest';
import { assessDroneRules, DRONE_CATALOGUE, findDrone, RULE_DATES } from '../../src/services/drones/index.js';
import { resolveDrone } from '../../src/handlers/drone-handlers.js';

const now = new Date('2026-09-25T12:00:00Z');

describe('drone catalogue', () => {
  it('has unique ids, plausible weights and a verified date on every entry', () => {
    expect(new Set(DRONE_CATALOGUE.map((d) => d.id)).size).toBe(DRONE_CATALOGUE.length);
    for (const d of DRONE_CATALOGUE) {
      expect(d.weightG, d.id).toBeGreaterThan(50);
      expect(d.weightG, d.id).toBeLessThan(5000);
      expect(d.verified, d.id).toMatch(/^\d{4}-\d{2}$/);
      if (d.euClass === 'C0') expect(d.weightG, `${d.id} C0 must be under 250 g`).toBeLessThanOrEqual(250);
      if (d.euClass === 'C1') expect(d.weightG, `${d.id} C1 must be under 900 g`).toBeLessThan(900);
      if (d.euClass === 'C2') expect(d.weightG, `${d.id} C2 must be under 4 kg`).toBeLessThan(4000);
    }
  });
  it('finds models by exact name, alias, or the shortest name containing every word', () => {
    expect(findDrone('DJI Mini 4 Pro')).toMatchObject({ status: 'found', drone: { id: 'dji-mini-4-pro' } });
    expect(findDrone('mini4pro')).toMatchObject({ status: 'found', drone: { id: 'dji-mini-4-pro' } });
    expect(findDrone('mini 3')).toMatchObject({ status: 'found', drone: { id: 'dji-mini-3' } });
    expect(findDrone('Mavic 3')).toMatchObject({ status: 'found', drone: { id: 'dji-mavic-3' } });
    expect(findDrone('air 3s')).toMatchObject({ status: 'found', drone: { id: 'dji-air-3s' } });
    expect(findDrone('EVO Lite+')).toMatchObject({ status: 'found', drone: { id: 'autel-evo-lite-plus' } });
    expect(findDrone('Skydio 2')).toEqual({ status: 'not_found' });
    const pro = findDrone('pro');
    expect(pro.status).toBe('ambiguous');
  });
});

describe('UK open category rules', () => {
  it('rates a C0 sub-250 g camera drone as A1 with registration and Remote ID from 2028', () => {
    const a = assessDroneRules({ weightG: 249, euClass: 'C0', camera: true, remoteId: 'broadcast' }, now);
    expect(a.effectiveClass).toBe('UK0');
    expect(a.basis).toBe('eu_class_transition');
    expect(a.subcategory).toBe('A1');
    expect(a.overflight).toContain('over uninvolved people');
    expect(a.registration).toMatchObject({ flyerId: true, operatorId: true });
    expect(a.remoteId).toMatchObject({ required: false, from: RULE_DATES.remoteIdLegacy });
  });
  it('drops the registration threshold from 250 g to 100 g on 1 January 2026', () => {
    const neo = { weightG: 135, euClass: 'C0' as const, camera: true };
    expect(assessDroneRules(neo, new Date('2025-06-01T12:00:00Z')).registration).toMatchObject({ flyerId: false, operatorId: true });
    expect(assessDroneRules(neo, now).registration).toMatchObject({ flyerId: true, operatorId: true });
    expect(assessDroneRules({ weightG: 80, camera: false }, now).registration).toMatchObject({ flyerId: false, operatorId: false });
  });
  it('treats a C1 drone as UK1 (A1, avoid overflight) with Remote ID required now', () => {
    const a = assessDroneRules({ weightG: 720, euClass: 'C1', camera: true, remoteId: 'broadcast' }, now);
    expect(a.effectiveClass).toBe('UK1');
    expect(a.subcategory).toBe('A1');
    expect(a.overflight).toContain('Avoid');
    expect(a.remoteId).toMatchObject({ required: true, from: RULE_DATES.ukClassMarks });
  });
  it('gives a C2 drone A2 at 30 m / 5 m only with an A2 CofC, otherwise A3', () => {
    const without = assessDroneRules({ weightG: 958, euClass: 'C2', camera: true }, now);
    expect(without.subcategory).toBe('A3');
    expect(without.subcategoryWithA2Certificate).toBe('A2');
    expect(without.separation).toContain('150 m');
    const with_ = assessDroneRules({ weightG: 958, euClass: 'C2', camera: true, a2Certificate: true }, now);
    expect(with_.subcategory).toBe('A2');
    expect(with_.separation).toContain('30 m');
    expect(with_.separation).toContain('5 m');
  });
  it('judges legacy aircraft on weight: under 250 g A1, under 2 kg A2 at 50 m with a CofC, else A3', () => {
    expect(assessDroneRules({ weightG: 249, camera: true }, now)).toMatchObject({ effectiveClass: 'legacy', subcategory: 'A1' });
    const mavic2 = assessDroneRules({ weightG: 907, camera: true, a2Certificate: true }, now);
    expect(mavic2).toMatchObject({ effectiveClass: 'legacy', subcategory: 'A2' });
    expect(mavic2.separation).toContain('50 m');
    expect(assessDroneRules({ weightG: 907, camera: true }, now)).toMatchObject({ subcategory: 'A3', subcategoryWithA2Certificate: 'A2' });
    expect(assessDroneRules({ weightG: 3500, camera: true, a2Certificate: true }, now)).toMatchObject({ subcategory: 'A3', subcategoryWithA2Certificate: null });
  });
  it('stops recognising EU C-class labels after 31 December 2027', () => {
    const before = assessDroneRules({ weightG: 720, euClass: 'C1', camera: true }, new Date('2027-12-31T12:00:00Z'));
    expect(before.effectiveClass).toBe('UK1');
    const after = assessDroneRules({ weightG: 720, euClass: 'C1', camera: true }, new Date('2028-01-01T12:00:00Z'));
    expect(after.effectiveClass).toBe('legacy');
    expect(after.subcategory).toBe('A3');
    expect(after.basisNote).toContain('2027-12-31');
    expect(after.remoteId).toMatchObject({ required: true, from: RULE_DATES.remoteIdLegacy });
  });
  it('prefers a UK class mark over an EU label and flags aircraft outside the open category', () => {
    expect(assessDroneRules({ weightG: 700, euClass: 'C1', ukClass: 'UK2', camera: true }, now)).toMatchObject({ effectiveClass: 'UK2', basis: 'uk_class' });
    const heavy = assessDroneRules({ weightG: 25_000, camera: true }, now);
    expect(heavy.outsideOpenCategory).toBe(true);
    expect(heavy.always[0]).toContain('operational authorisation');
  });
  it('notes when a model cannot broadcast Remote ID itself', () => {
    const a = assessDroneRules({ weightG: 249, camera: true, remoteId: 'none' }, now);
    expect(a.remoteId.note).toContain('add-on module');
  });
});

describe('resolveDrone', () => {
  it('uses the catalogue, lets explicit arguments override it, and validates class marks', () => {
    const r = resolveDrone({ model: 'Mini 4 Pro' });
    expect('resolved' in r && r.resolved).toMatchObject({ weightG: 249, euClass: 'C0', camera: true, label: 'DJI Mini 4 Pro' });
    const heavier = resolveDrone({ model: 'Mini 4 Pro', weight_g: 290 });
    expect('resolved' in heavier && heavier.resolved.weightG).toBe(290);
    const marked = resolveDrone({ weight_g: 900, class_mark: 'uk2' });
    expect('resolved' in marked && marked.resolved).toMatchObject({ ukClass: 'UK2', euClass: null, drone: null });
    expect(resolveDrone({ weight_g: 900, class_mark: 'C9' })).toHaveProperty('error');
    expect(resolveDrone({ model: 'Skydio 2' })).toHaveProperty('error');
    expect(resolveDrone({})).toHaveProperty('error');
    expect(resolveDrone({ model: 'pro' })).toHaveProperty('ambiguous');
  });
});
