import { stat } from 'node:fs/promises';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { verifyPack } from '../../pipeline/verify/assertions.js';
import { SqlitePackRepository } from '../../src/pack/repository.js';
import { buildMiniPack } from '../helpers/mini-pack.js';
import { tempDir } from '../helpers/build-deps.js';
import { PackIncompatibleError } from '../../src/core/errors.js';
import { openDatabase } from '../../src/pack/driver.js';

describe('mini pack build and repository queries', () => {
  let file: string;
  let repo: SqlitePackRepository;
  beforeAll(async () => {
    file = await buildMiniPack(tempDir());
    repo = new SqlitePackRepository(file);
  });
  afterAll(() => repo.close());

  it('verifies with the default floors', async () => {
    const v = verifyPack(file, { region: 'test', sizeBytes: (await stat(file)).size, knownPoints: false });
    expect(v.failures).toEqual([]);
    expect(v.counts.zones).toBe(6);
    expect(v.counts.rights_of_way).toBe(5);
    expect(v.counts.land_restrictions).toBe(4);
    expect(v.counts.coverage).toBe(4);
  });
  it('finds zones at a point via rtree then exact test', () => {
    const inside = repo.zonesAt(-1.3816, 54.2056); // Topcliffe centre
    expect(inside.map((z) => z.designator)).toContain('EGR4U010A');
    // Just outside the circle but inside its bbox corner
    const corner = repo.zonesAt(-1.3816 + 0.069, 54.2056 + 0.041);
    expect(corner.map((z) => z.designator)).not.toContain('EGR4U010A');
    expect(repo.zonesAt(2.0, 55.0)).toEqual([]);
  });
  it('finds zones along a line and in a bbox', () => {
    const line = { type: 'LineString' as const, coordinates: [[-1.6, 54.2056], [-1.1, 54.2056]] };
    expect(repo.zonesAlongLine(line).map((z) => z.designator)).toContain('EGR4U010A');
    expect(repo.zonesInBbox([-1.5, 54.1, -1.2, 54.3]).length).toBe(1);
  });
  it('returns nearest rights of way with distances and authority attribution', () => {
    const hits = repo.nearestRightsOfWay(0.13011, 51.57307, 500, 3);
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0].distanceM).toBeLessThan(50);
    expect(hits[0].authorityName).toBe('Barking and Dagenham');
    expect(hits[0].attribution).toBe('BD attribution');
    expect(hits[0].geometry.coordinates.length).toBeGreaterThan(2);
    expect(repo.nearestRightsOfWay(-3, 53, 100, 3)).toEqual([]);
  });
  it('answers coverage and land restrictions', () => {
    expect(repo.prowCoverageAt(-1.97, 50.69)).toBe('england_wales');
    expect(repo.prowCoverageAt(-4.0, 56.5)).toBe('scotland');
    expect(repo.prowCoverageAt(-6.5, 54.6)).toBe('northern_ireland');
    expect(repo.prowCoverageAt(2.0, 55.0)).toBe('unknown');
    const nt = repo.landRestrictionsAt(-1.97, 50.69);
    expect(nt.map((r) => r.name)).toEqual(['Brownsea Island']);
    expect(repo.landRestrictionsAt(-2.6, 51.455).map((r) => r.entryId)).toEqual(['test-park']);
    expect(repo.landRestrictionsAt(-2.29, 51.405)[0].kind).toBe('pspo');
  });
  it('resolves aerodromes by ICAO, name prefix and fuzzy fallback', () => {
    expect(repo.findAerodrome('EGCM')[0].name).toBe('LEEDS EAST');
    expect(repo.findAerodrome('leeds')[0].name).toBe('LEEDS EAST');
    expect(repo.findAerodrome('kemble')[0].kind).toBe('aerodrome');
    expect(repo.findAerodrome('dounreay')[0].kind).toBe('zone');
    expect(repo.findAerodrome('zzzz')).toEqual([]);
    expect(repo.zonesByAerodrome('KEMBLE').map((z) => z.designator)).toEqual(['EGR1U010E']);
  });
  it('exposes meta and sources', () => {
    const m = repo.meta();
    expect(m.packTag).toBe('pack-20260903-test');
    expect(m.airacEffective).toBe('2026-09-03');
    expect(m.sources.map((s) => s.id)).toContain('nats_uas');
  });
  it('refuses a pack with the wrong schema version', async () => {
    const other = path.join(tempDir(), 'bad.sqlite');
    const db = openDatabase(other);
    db.exec('PRAGMA user_version = 99');
    db.close();
    expect(() => new SqlitePackRepository(other)).toThrow(PackIncompatibleError);
  });
});
