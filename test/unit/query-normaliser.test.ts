import { describe, expect, it } from 'vitest';
import { normaliseQuery } from '../../src/services/geocoder/query-normaliser.js';

describe('normaliseQuery', () => {
  it('strips locative phrasing to the proper noun', () => {
    const { attempts } = normaliseQuery('the layby below Tyndale Monument');
    expect(attempts[0]).toBe('the layby below Tyndale Monument');
    expect(attempts).toContain('Tyndale Monument');
  });
  it('drops trailing country and collapses whitespace', () => {
    const { cacheKey, attempts } = normaliseQuery('  Durdle   Door, UK ');
    expect(cacheKey).toBe('durdle door');
    expect(attempts[0]).toBe('Durdle Door');
  });
  it('takes the trailing part after near/by', () => {
    const { attempts } = normaliseQuery('car park near Corfe Castle');
    expect(attempts).toContain('Corfe Castle');
  });
  it('never produces duplicates or more than four attempts', () => {
    const { attempts } = normaliseQuery('the the the');
    expect(new Set(attempts.map((a) => a.toLowerCase())).size).toBe(attempts.length);
    expect(attempts.length).toBeLessThanOrEqual(4);
  });
});
