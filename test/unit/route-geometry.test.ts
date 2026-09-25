import { describe, expect, it } from 'vitest';
import { crossingOf, routeLengthKm, toLineString } from '../../src/services/airspace/geometry.js';
import { AirspaceEngine } from '../../src/services/airspace/airspace-engine.js';
import { FakePackRepository, FIXTURE_ZONES } from '../helpers/fake-pack-repository.js';

describe('crossingOf', () => {
  const square = FIXTURE_ZONES[1].geometry; // -3.15..-3.11, 51.19..51.225
  it('finds entry distance and covered length through a square', () => {
    const line = toLineString([[-3.2, 51.207], [-3.05, 51.207]]);
    const c = crossingOf(line, square)!;
    expect(c.startsInside).toBe(false);
    expect(c.entersAtKm).toBeGreaterThan(3);
    expect(c.entersAtKm).toBeLessThan(4);
    expect(c.exitsAtKm).toBeGreaterThan(c.entersAtKm);
    expect(c.coveredKm).toBeCloseTo(2.77, 0);
    expect(c.endsInside).toBe(false);
  });
  it('reports a route that starts inside', () => {
    const line = toLineString([[-3.13, 51.2], [-3.0, 51.2]]);
    const c = crossingOf(line, square)!;
    expect(c.startsInside).toBe(true);
    expect(c.entersAtKm).toBe(0);
  });
  it('returns undefined when the line misses', () => {
    expect(crossingOf(toLineString([[-3.0, 51.0], [-2.9, 51.0]]), square)).toBeUndefined();
  });
  it('measures route length', () => {
    expect(routeLengthKm(toLineString([[-3.0, 51.0], [-3.0, 51.1]]))).toBeCloseTo(11.1, 0);
  });
});

describe('AirspaceEngine', () => {
  const engine = new AirspaceEngine(new FakePackRepository());
  it('dedupes and sorts crossings along a route', async () => {
    const hits = await engine.alongRoute(toLineString([[-3.3, 51.207], [-2.7191, 51.207], [-2.7191, 51.3827]]));
    // starts inside the high-level square (4), then Hinkley (2), then Bristol FRZ (1)
    expect(hits.map((h) => h.zone.id)).toEqual([4, 2, 1]);
    expect(new Set(hits.map((h) => h.zone.id)).size).toBe(hits.length);
  });
  it('describes an aerodrome zone', async () => {
    const [z] = await engine.aerodrome('EGGD');
    expect(z.icao).toBe('EGGD');
    expect(z.primary.radiusKm).toBeCloseTo(4.6, 1);
    expect(z.areaKm2).toBeGreaterThan(60);
  });
});
