import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseForecast } from '../../src/services/weather/open-meteo.js';
import { assessHour, compassPoint, describeWeatherCode } from '../../src/services/weather/assessment.js';
import { createHandlers } from '../../src/handlers/index.js';
import { buildTestDeps } from '../helpers/build-deps.js';
import { fakeFetch } from '../helpers/fake-fetch.js';

const raw = JSON.parse(readFileSync(new URL('../fixtures/weather/open-meteo-durdle.json', import.meta.url), 'utf8'));
const firstDay = String(raw.hourly.time[0]).slice(0, 10);

describe('open-meteo parsing and assessment', () => {
  it('parses a real response and tolerates garbage', () => {
    const f = parseForecast(raw, '2026-09-25T12:00:00Z');
    expect(f.hourly.length).toBe(72);
    expect(f.hourly[0].windMs).not.toBeNull();
    expect(f.daily[0].sunrise).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/);
    expect(parseForecast(null, 'x').hourly).toEqual([]);
    expect(parseForecast({ hourly: { time: ['2026-01-01T00:00'] } }, 'x').hourly[0].windMs).toBeNull();
  });
  it('rates hours against small-drone limits', () => {
    const base = { time: '2026-09-26T10:00', temperatureC: 15, windMs: 3, gustMs: 5, windDirectionDeg: 225, wind120Ms: 6, precipitationMm: 0, precipitationProbability: 5, visibilityM: 20000, cloudCoverPct: 30, lowCloudPct: 10, weatherCode: 1 };
    expect(assessHour(base).flyability).toBe('good');
    expect(assessHour({ ...base, windMs: 9 }).flyability).toBe('caution');
    expect(assessHour({ ...base, gustMs: 14 })).toMatchObject({ flyability: 'poor', reasons: ['gusts 14 m/s'] });
    expect(assessHour({ ...base, precipitationMm: 1.2 }).flyability).toBe('poor');
    expect(assessHour({ ...base, visibilityM: 800 }).flyability).toBe('poor');
    expect(assessHour({ ...base, temperatureC: -2 }).reasons[0]).toContain('battery');
    expect(assessHour({ ...base, wind120Ms: 12 }).reasons[0]).toContain('120 m');
    expect(compassPoint(225)).toBe('SW');
    expect(describeWeatherCode(61)).toBe('light rain');
  });
});

describe('check_weather', () => {
  const setup = () => {
    const ff = fakeFetch([{ match: 'api.open-meteo.com', body: raw }, { match: 'q=Durdle', body: [{ lat: '50.6212', lon: '-2.277', display_name: 'Durdle Door, West Lulworth, Dorset', importance: 0.5 }] }]);
    const built = buildTestDeps({ fetchImpl: ff.fetch, now: () => new Date(`${firstDay}T09:30:00Z`) });
    return { handlers: createHandlers(built.deps), calls: ff.calls };
  };
  it('reports the next hours with a rating and caches the forecast', async () => {
    const { handlers, calls } = setup();
    const r = await handlers.get('check_weather')!({ lat: 50.6212, lon: -2.277, hours: 4, format: 'json' });
    const j = JSON.parse(r.content[0].text);
    expect(j.hours.length).toBe(4);
    expect(['good', 'caution', 'poor']).toContain(j.overall);
    expect(j.hours[0].time.startsWith(firstDay)).toBe(true);
    expect(j.attribution.join(' ')).toContain('Open-Meteo');
    await handlers.get('check_weather')!({ lat: 50.6212, lon: -2.277, hours: 2 });
    expect(calls.filter((c) => c.url.includes('open-meteo')).length).toBe(1);
  });
  it('reports daylight hours for a bare date and speaks briefly', async () => {
    const { handlers } = setup();
    const text = (await handlers.get('check_weather')!({ place: 'Durdle Door', date: firstDay })).content[0].text;
    expect(text).toMatch(/Daylight \d{2}:\d{2} to \d{2}:\d{2} local/);
    expect(text).toContain('Hourly forecast');
    const b = (await handlers.get('check_weather')!({ place: 'Durdle Door', format: 'brief' })).content[0].text;
    expect(b).toMatch(/^Weather near Durdle Door/);
    expect(b).toContain('Sources: Open-Meteo');
  });
  it('rejects a date outside the forecast', async () => {
    const { handlers } = setup();
    await expect(handlers.get('check_weather')!({ lat: 50.6, lon: -2.3, date: '2030-01-01T10:00Z' })).rejects.toThrow(/outside the 7-day/);
  });
});
