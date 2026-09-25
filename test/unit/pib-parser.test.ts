import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parsePib } from '../../src/services/notam/pib-parser.js';

const xml = readFileSync(new URL('../fixtures/notam/pib-excerpt.xml', import.meta.url), 'utf8');

describe('parsePib', () => {
  const parsed = parsePib(xml);
  it('parses the fixture with no skips', () => {
    expect(parsed.stats.elements).toBe(20);
    expect(parsed.stats.skipped).toBe(0);
    expect(parsed.notams.length).toBe(20);
    expect(parsed.validFrom).toBeInstanceOf(Date);
  });
  it('decodes Q-line fields and positions', () => {
    const withPos = parsed.notams.filter((n) => n.centre && !n.wholeFir);
    expect(withPos.length).toBeGreaterThan(10);
    const n = withPos[0];
    expect(n.fir).toMatch(/^[A-Z]{4}$/);
    expect(n.qCode).toMatch(/^Q[A-Z]{4}$/);
    expect(n.radiusKm).toBeGreaterThan(0);
    expect(n.validFrom).toBeInstanceOf(Date);
  });
  it('flags whole-FIR NOTAMs, PERM validity, schedules and estimates', () => {
    expect(parsed.notams.some((n) => n.wholeFir)).toBe(true);
    expect(parsed.notams.some((n) => n.validTo === 'PERM')).toBe(true);
    expect(parsed.notams.some((n) => n.schedule)).toBe(true);
    expect(parsed.notams.some((n) => n.estimated)).toBe(true);
  });
  it('prefers a precise item E position when it is tighter than the Q-line', () => {
    const precise = parsed.notams.find((n) => n.centreSource === 'itemE');
    expect(precise).toBeDefined();
    expect(precise!.radiusNm!).toBeLessThanOrEqual(5);
  });
  it('degrades gracefully on garbage', () => {
    expect(parsePib('').notams).toEqual([]);
    expect(parsePib('<nope>').notams).toEqual([]);
    expect(parsePib('<Pib><Notam><ItemE>orphan</ItemE></Notam></Pib>').notams.length).toBe(1);
  });
});
