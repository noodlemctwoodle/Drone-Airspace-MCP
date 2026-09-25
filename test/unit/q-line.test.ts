import { describe, expect, it } from 'vitest';
import { parseCoordinates, parseItemEPosition, parseQLineText } from '../../src/services/notam/q-line.js';

describe('parseCoordinates', () => {
  it('decodes DDMMNDDDMMW', () => {
    const c = parseCoordinates('5408N00316W')!;
    expect(c[1]).toBeCloseTo(54.1333, 3);
    expect(c[0]).toBeCloseTo(-3.2667, 3);
  });
  it('rejects garbage', () => {
    expect(parseCoordinates('nope')).toBeUndefined();
    expect(parseCoordinates('')).toBeUndefined();
  });
});

describe('parseQLineText', () => {
  it('parses a textual Q line', () => {
    const q = parseQLineText('Q) EGTT/QRTCA/IV/BO/W/000/020/5130N00030W005')!;
    expect(q.fir).toBe('EGTT');
    expect(q.qCode).toBe('QRTCA');
    expect(q.radiusNm).toBe(5);
    expect(q.upperFl).toBe(20);
    expect(q.centre?.[1]).toBeCloseTo(51.5, 3);
  });
});

describe('parseItemEPosition', () => {
  it('prefers the precise position in item E', () => {
    const p = parseItemEPosition('TEMP CRANE OPR WI 0.1NM RADIUS OF 540831.88N 0031356.82W (BARROW).')!;
    expect(p.radiusNm).toBeCloseTo(0.1);
    expect(p.centre[1]).toBeCloseTo(54.1422, 3);
    expect(p.centre[0]).toBeCloseTo(-3.2325, 3);
  });
  it('handles whole minutes and km', () => {
    const p = parseItemEPosition('RESTRICTED AREA WI 4NM RADIUS OF 540301N 0031407W.')!;
    expect(p.radiusNm).toBe(4);
    const k = parseItemEPosition('WI 2KM RADIUS OF 540301N 0031407W')!;
    expect(k.radiusNm).toBeCloseTo(1.08, 2);
  });
  it('returns undefined when absent', () => {
    expect(parseItemEPosition('RWY 09/27 CLOSED')).toBeUndefined();
  });
});
