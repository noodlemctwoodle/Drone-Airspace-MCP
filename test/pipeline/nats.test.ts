import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import area from '@turf/area';
import { parseAixmAirspaces } from '../../pipeline/sources/nats/aixm-parser.js';
import { parseNatsKml } from '../../pipeline/sources/nats/kml-parser.js';
import { crossCheck } from '../../pipeline/sources/nats/crosscheck.js';
import { scrapeNatsIndex } from '../../pipeline/sources/nats/index-page.js';
import { currentCycle, cycleEnd, nextCycle } from '../../pipeline/lib/airac.js';
import { arcPositions } from '../../pipeline/lib/geometry.js';
import { mapZoneType, aerodromeNameOf } from '../../pipeline/sources/nats/zone-types.js';

const xml = readFileSync(new URL('../fixtures/aixm/mini-uas.xml', import.meta.url), 'utf8');
const kml = readFileSync(new URL('../fixtures/aixm/mini-uas.kml', import.meta.url), 'utf8');

describe('AIXM parser', () => {
  const result = parseAixmAirspaces(xml);
  const by = (d: string) => result.zones.find((z) => z.designator === d)!;

  it('parses seven real zones and drops the broken one with a warning', () => {
    expect(result.stats.airspaces).toBe(8);
    expect(result.zones.length).toBe(7);
    expect(result.stats.dropped).toBe(1);
    expect(result.warnings.some((w) => w.includes('EGRBROKEN'))).toBe(true);
  });
  it('densifies a CircleByCenterPoint to a 65-point ring of the right size', () => {
    const z = by('EGR4U010A');
    expect(z.zoneType).toBe('frz');
    expect(z.geometry.type).toBe('Polygon');
    expect((z.geometry as { coordinates: number[][][] }).coordinates[0].length).toBe(65);
    // Topcliffe is a 2 NM radius circle: pi * 3.704^2 km^2 (cross-checked against the NATS KML below)
    expect(area(z.geometry) / 1e6).toBeCloseTo(Math.PI * 3.704 * 3.704, 0);
    expect(z.centroid[1]).toBeCloseTo(54.2056, 3);
  });
  it('handles arcs with the verified sign convention', () => {
    const z = by('EGR3U013A');
    expect(z.name).toBe('LEEDS EAST');
    expect(z.zoneType).toBe('frz');
    expect(z.icao).toBe('EGCM');
    expect(area(z.geometry) / 1e6).toBeGreaterThan(50);
    expect(area(z.geometry) / 1e6).toBeLessThan(140);
  });
  it('normalises limits and types', () => {
    const d = by('EGD710');
    expect(d.zoneType).toBe('danger');
    expect(d.lowerFt).toBe(0);
    expect(d.lowerRef).toBe('sfc');
    expect(d.upperFt).toBe(1500);
    expect(d.upperRef).toBe('amsl');
    expect(d.contact).toMatch(/Range Control|Tel/);
    expect(d.activation).toMatch(/AVBL_FOR_ACTIVATION|NOTAM/);
    const p = by('EGP813');
    expect(p.zoneType).toBe('prohibited');
    const prison = by('EGR4U012');
    expect(prison.zoneType).toBe('prison'); // Isle of Man, by name; not under SI 2023/1101
    expect(prison.upperRef).toBe('unl');
    expect(prison.aerodromeName).toBeNull();
    const hmp = by('EGR1U136');
    expect(hmp.zoneType).toBe('prison'); // an R/FRZ in the feed, detected by name and notes
    expect(hmp.rawType).toBe('R/FRZ');
    expect(hmp.aerodromeName).toBeNull();
    expect(hmp.icao).toBeNull();
    expect(hmp.contact).toBe('HMPPS (drone.RFZapplication@justice.gov.uk)');
    expect(hmp.notes).toContain('SI 2023/1101');
    const rpz = by('EGR1U010E');
    expect(rpz.zoneType).toBe('frz');
    expect(rpz.aerodromeName).toBe('KEMBLE');
    expect(rpz.icao).toBe('EGBP');
  });
  it('cross-checks cleanly against the KML', () => {
    const report = crossCheck(result.zones, parseNatsKml(kml));
    expect(report.matched).toBe(7);
    expect(report.areaOutliers).toEqual([]);
    expect(report.warnings).toEqual([]);
  });
  it('flags a reversed arc convention in the cross-check', () => {
    const wrong = result.zones.map((z) => (z.designator === 'EGR3U013A' ? { ...z, geometry: { type: 'Polygon' as const, coordinates: [arcPositions(z.centroid, 4.63, 0, 90).concat([z.centroid])] } } : z));
    const report = crossCheck(wrong, parseNatsKml(kml));
    expect(report.areaOutliers.map((o) => o.designator)).toContain('EGR3U013A');
  });
  it('degrades on garbage', () => {
    expect(parseAixmAirspaces('<nope').zones).toEqual([]);
    expect(parseAixmAirspaces('').zones).toEqual([]);
  });
});

describe('zone types', () => {
  it('maps NATS conventions', () => {
    expect(mapZoneType('R', 'FRZ', 'BRISTOL')).toBe('frz');
    expect(mapZoneType('R', 'RPZ', 'BRISTOL RWY 27')).toBe('frz');
    expect(mapZoneType('R', 'RPZ', 'HMP DARTMOOR')).toBe('prison');
    expect(mapZoneType('R', 'FRZ', 'HMP BRISTOL')).toBe('prison');
    expect(mapZoneType('R', 'FRZ', 'SOMEWHERE', 'Permission has been granted by HMPPS')).toBe('prison');
    expect(mapZoneType('R', 'RPZ', 'GATWICK RWY 26L')).toBe('frz');
    expect(mapZoneType('R', undefined, 'SPRINGFIELDS')).toBe('restricted');
    expect(mapZoneType('P', undefined, 'X')).toBe('prohibited');
    expect(mapZoneType('D', undefined, 'X')).toBe('danger');
    expect(mapZoneType('OTHER', undefined, 'X')).toBe('other');
    expect(aerodromeNameOf('frz', 'LONDON GATWICK RWY 26L')).toBe('LONDON GATWICK');
    expect(aerodromeNameOf('danger', 'PENDINE')).toBeNull();
  });
});

describe('AIRAC and index page', () => {
  it('computes cycles', () => {
    expect(currentCycle(new Date('2026-09-25T00:00:00Z'))).toBe('2026-09-03');
    expect(nextCycle(new Date('2026-09-25T00:00:00Z'))).toBe('2026-10-01');
    expect(currentCycle(new Date('2026-10-01T00:00:00Z'))).toBe('2026-10-01');
    expect(cycleEnd('2026-09-03')).toBe('2026-09-30');
  });
  it('scrapes dataset links newest first with absolute urls', () => {
    const html = readFileSync(new URL('../fixtures/nats-index.html', import.meta.url), 'utf8');
    const links = scrapeNatsIndex(html);
    expect(links.map((l) => l.date)).toEqual(['20261001', '20260903']);
    expect(links[1].xmlUrl).toMatch(/^https:\/\/nats-uk\.ead-it\.com\/cms-nats\/export/);
    expect(links[1].kmlUrl).toContain('_KML.zip');
    expect(links[0].kmlUrl).toBeNull();
    expect(scrapeNatsIndex('')).toEqual([]);
  });
});
