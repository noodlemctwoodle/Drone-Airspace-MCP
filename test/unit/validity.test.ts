import { describe, expect, it } from 'vitest';
import { isInForce, parseNotamTime, parseUserDate } from '../../src/services/notam/validity.js';

describe('parseNotamTime', () => {
  it('parses YYMMDDHHMM as UTC', () => {
    expect(parseNotamTime('2609251200')).toEqual(new Date('2026-09-25T12:00:00Z'));
  });
  it('handles PERM and EST', () => {
    expect(parseNotamTime('PERM')).toBe('PERM');
    expect(parseNotamTime('2612060000 EST')).toEqual(new Date('2026-12-06T00:00:00Z'));
  });
  it('returns undefined for junk', () => {
    expect(parseNotamTime('soon')).toBeUndefined();
  });
});

describe('isInForce', () => {
  const at = new Date('2026-09-25T12:00:00Z');
  it('respects the window', () => {
    expect(isInForce(new Date('2026-09-01T00:00Z'), new Date('2026-09-30T00:00Z'), at)).toBe(true);
    expect(isInForce(new Date('2026-09-26T00:00Z'), new Date('2026-09-30T00:00Z'), at)).toBe(false);
    expect(isInForce(new Date('2026-09-01T00:00Z'), new Date('2026-09-20T00:00Z'), at)).toBe(false);
    expect(isInForce(new Date('2026-09-01T00:00Z'), 'PERM', at)).toBe(true);
  });
});

describe('parseUserDate', () => {
  const now = () => new Date('2026-09-25T12:00:00Z');
  it('defaults to now and treats a bare date as midday', () => {
    expect(parseUserDate(undefined, now)).toEqual(now());
    expect(parseUserDate('2026-10-01', now)).toEqual(new Date('2026-10-01T12:00:00Z'));
  });
  it('assumes UTC without an offset and throws on junk', () => {
    expect(parseUserDate('2026-10-01T14:00', now)).toEqual(new Date('2026-10-01T14:00:00Z'));
    expect(() => parseUserDate('next tuesday', now)).toThrow(/ISO 8601/);
  });
});
