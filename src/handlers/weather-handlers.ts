import type { OutputFormat } from '../types.js';
import type { HandlerDependencies, ToolHandler } from './deps.js';
import { brief, respond } from './respond.js';
import { locationLine, locationNotes, resolveOrRespond, sourceOfLocation } from './location-handlers.js';
import type { LocationArgs } from '../tools/schemas.js';
import { UserFacingError } from '../core/errors.js';
import { parseUserDate } from '../services/notam/validity.js';
import { assessHour, compassPoint, describeWeatherCode, localHourKey, type Flyability, type HourAssessment } from '../services/weather/assessment.js';
import { renderReport } from '../formatters/report.js';
import { attributionLines, attributionSentence, type SourceId } from '../formatters/attribution.js';

export const CAVEAT_WEATHER = 'Forecast model output, not an observation. Ratings use typical small-drone limits; your aircraft\'s manual and the conditions you see on site take precedence.';

function renderHour(a: HourAssessment): string {
  const h = a.hour;
  const time = h.time.slice(11, 16);
  const wind = h.windMs === null ? 'wind ?' : `wind ${h.windMs.toFixed(0)} m/s ${compassPoint(h.windDirectionDeg)}${h.gustMs !== null ? ` gusting ${h.gustMs.toFixed(0)}` : ''}${h.wind120Ms !== null ? `, ${h.wind120Ms.toFixed(0)} at 120 m` : ''}`;
  const parts = [`${time} ${a.flyability.toUpperCase()}: ${wind}`, describeWeatherCode(h.weatherCode)];
  if (h.precipitationMm !== null) parts.push(`${h.precipitationMm.toFixed(1)} mm${h.precipitationProbability !== null ? ` (${h.precipitationProbability}%)` : ''}`);
  if (h.visibilityM !== null) parts.push(`vis ${(h.visibilityM / 1000).toFixed(h.visibilityM < 5000 ? 1 : 0)} km`);
  if (h.temperatureC !== null) parts.push(`${h.temperatureC.toFixed(0)} °C`);
  if (a.reasons.length > 0) parts.push(a.reasons.join(', '));
  return parts.join('; ');
}

const WORST: Record<Flyability, number> = { good: 0, caution: 1, poor: 2 };

export function createCheckWeatherHandler(deps: HandlerDependencies): ToolHandler {
  return async (args) => {
    const format = (args.format as OutputFormat) ?? 'text';
    const resolved = await resolveOrRespond(deps, 'check_weather', args as LocationArgs, format);
    if ('response' in resolved) return resolved.response;
    const loc = resolved.location;
    const dateArg = typeof args.date === 'string' ? args.date : undefined;
    const bareDate = !!dateArg && /^\d{4}-\d{2}-\d{2}$/.test(dateArg.trim());
    let start: Date;
    try {
      start = parseUserDate(dateArg, deps.now);
    } catch (error) {
      throw new UserFacingError((error as Error).message);
    }
    const hours = typeof args.hours === 'number' ? args.hours : 6;
    const forecast = await deps.weather.forecast(loc.lat, loc.lon);
    if (forecast.hourly.length === 0) throw new UserFacingError('Weather forecast unavailable for this location right now.');

    let window: HourAssessment[];
    if (bareDate) {
      const day = dateArg!.trim();
      const daily = forecast.daily.find((d) => d.date === day);
      const rise = daily?.sunrise?.slice(11, 13);
      const set = daily?.sunset?.slice(11, 13);
      window = forecast.hourly
        .filter((h) => h.time.startsWith(day))
        .filter((h) => !rise || !set || (h.time.slice(11, 13) >= rise && h.time.slice(11, 13) <= set))
        .map(assessHour);
    } else {
      const key = localHourKey(start);
      let idx = forecast.hourly.findIndex((h) => h.time >= key);
      if (idx < 0) idx = forecast.hourly.length;
      window = forecast.hourly.slice(idx, idx + hours).map(assessHour);
    }
    if (window.length === 0) throw new UserFacingError('That time is outside the 7-day forecast range.');

    const worst = window.reduce<Flyability>((acc, a) => (WORST[a.flyability] > WORST[acc] ? a.flyability : acc), 'good');
    const good = window.filter((a) => a.flyability === 'good').length;
    const daily = forecast.daily.find((d) => d.date === window[0].hour.time.slice(0, 10));
    const headline =
      worst === 'good'
        ? `Flyable conditions expected: ${window[0].hour.time.slice(11, 16)} to ${window[window.length - 1].hour.time.slice(11, 16)} on ${window[0].hour.time.slice(0, 10)}.`
        : worst === 'caution'
          ? `Marginal in places: ${good} of ${window.length} hours look good, the rest need caution.`
          : `Poor conditions in the window: ${window.filter((a) => a.flyability === 'poor').length} of ${window.length} hours rated poor.`;
    const used = new Set<SourceId>(['weather']);
    const s = sourceOfLocation(loc);
    if (s) used.add(s);
    const attribution = attributionLines(used, await deps.pack.metaOrNull());
    const caveats = [CAVEAT_WEATHER];
    const data = {
      tool: 'check_weather',
      generatedAt: deps.now().toISOString(),
      location: loc,
      forecast: { fetchedAt: forecast.fetchedAt, fromCache: forecast.fromCache, elevationM: forecast.elevationM, timezone: forecast.timezone },
      daylight: daily ? { sunrise: daily.sunrise, sunset: daily.sunset } : null,
      overall: worst,
      hours: window.map((a) => ({ ...a.hour, flyability: a.flyability, reasons: a.reasons })),
      caveats,
      attribution,
    };
    return respond(
      format,
      data,
      () =>
        renderReport({
          headline,
          notes: [...locationNotes(loc), daily?.sunrise && daily?.sunset ? `Daylight ${daily.sunrise.slice(11, 16)} to ${daily.sunset.slice(11, 16)} local.` : ''].filter(Boolean),
          location: locationLine(loc),
          sections: [{ title: `Hourly forecast (local time, wind in m/s)`, lines: window.map(renderHour) }],
          caveats,
          attribution,
        }),
      () => {
        const first = window[0];
        const worstHour = window.find((a) => a.flyability === worst);
        return brief(
          `Weather near ${loc.name.split(',').slice(0, 2).join(',')}: ${headline}`,
          `Now ${describeWeatherCode(first.hour.weatherCode)}, wind ${first.hour.windMs?.toFixed(0) ?? '?'} metres per second${first.hour.gustMs !== null ? ` gusting ${first.hour.gustMs.toFixed(0)}` : ''}, ${first.hour.temperatureC?.toFixed(0) ?? '?'} degrees`,
          worst !== 'good' && worstHour && worstHour.reasons.length > 0 ? `Watch for ${worstHour.reasons.join(' and ')} around ${worstHour.hour.time.slice(11, 16)}` : null,
          daily?.sunset ? `Sunset is at ${daily.sunset.slice(11, 16)}` : null,
          attributionSentence(used)
        );
      }
    );
  };
}
