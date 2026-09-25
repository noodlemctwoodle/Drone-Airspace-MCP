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
    const v = await verifyPack(file, { region: 'test', sizeBytes: (await stat(file)).size, knownPoints: false });
    expect(v.failures).toEqual([]);
    expect(v.counts.zones).toBe(6);
    expect(v.counts.rights_of_way).toBe(5);
    expect(v.counts.land_restrictions).toBeGreaterThanOrEqual(4); // multipolygons are split into parts
    expect(v.counts.coverage).toBeGreaterThanOrEqual(4);
  });
  it('finds zones at a point via rtree then exact test', async () => {
    const inside = await repo.zonesAt(-1.3816, 54.2056); // Topcliffe centre
    expect(inside.map((z) => z.designator)).toContain('EGR4U010A');
    // Just outside the circle but inside its bbox corner
    const corner = await repo.zonesAt(-1.3816 + 0.069, 54.2056 + 0.041);
    expect(corner.map((z) => z.designator)).not.toContain('EGR4U010A');
    expect(await repo.zonesAt(2.0, 55.0)).toEqual([]);
  });
  it('finds zones along a line and in a bbox', async () => {
    const line = { type: 'LineString' as const, coordinates: [[-1.6, 54.2056], [-1.1, 54.2056]] };
    expect((await repo.zonesAlongLine(line)).map((z) => z.designator)).toContain('EGR4U010A');
    expect((await repo.zonesInBbox([-1.5, 54.1, -1.2, 54.3])).length).toBe(1);
  });
  it('returns nearest rights of way with distances and authority attribution', async () => {
    const hits = await repo.nearestRightsOfWay(0.13011, 51.57307, 500, 3);
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0].distanceM).toBeLessThan(50);
    expect(hits[0].authorityName).toBe('Barking and Dagenham');
    expect(hits[0].attribution).toBe('BD attribution');
    expect(hits[0].geometry.coordinates.length).toBeGreaterThan(2);
    expect(await repo.nearestRightsOfWay(-3, 53, 100, 3)).toEqual([]);
  });
  it('answers coverage and land restrictions', async () => {
    expect(await repo.prowCoverageAt(-1.97, 50.69)).toBe('england_wales');
    expect(await repo.prowCoverageAt(-4.0, 56.5)).toBe('scotland');
    expect(await repo.prowCoverageAt(-6.5, 54.6)).toBe('northern_ireland');
    expect(await repo.prowCoverageAt(2.0, 55.0)).toBe('unknown');
    const nt = await repo.landRestrictionsAt(-1.97, 50.69);
    expect(nt.map((r) => r.name)).toEqual(['Brownsea Island']);
    expect((await repo.landRestrictionsAt(-2.6, 51.455)).map((r) => r.entryId)).toEqual(['test-park']);
    expect((await repo.landRestrictionsAt(-2.29, 51.405))[0].kind).toBe('pspo');
  });
  it('resolves aerodromes by ICAO, name prefix and fuzzy fallback', async () => {
    expect((await repo.findAerodrome('EGCM'))[0].name).toBe('LEEDS EAST');
    expect((await repo.findAerodrome('leeds'))[0].name).toBe('LEEDS EAST');
    expect((await repo.findAerodrome('kemble'))[0].kind).toBe('aerodrome');
    expect((await repo.findAerodrome('dounreay'))[0].kind).toBe('zone');
    expect(await repo.findAerodrome('zzzz')).toEqual([]);
    expect((await repo.zonesByAerodrome('KEMBLE')).map((z) => z.designator)).toEqual(['EGR1U010E']);
  });
  it('finds nearest public parking and includes private on request', async () => {
    const pub = await repo.nearestParking(-2.277, 50.6212, 1000, 5);
    expect(pub.map((p) => p.name)).toEqual(['Durdle Door Car Park']);
    const all = await repo.nearestParking(-2.277, 50.6212, 1000, 5, true);
    expect(all.length).toBe(2);
    expect(all[0].distanceM).toBeLessThanOrEqual(all[1].distanceM);
  });
  it('exposes meta and sources', async () => {
    const m = await repo.meta();
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
