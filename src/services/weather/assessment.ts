import type { HourlyWeather } from './open-meteo.js';

/**
 * Advisory thresholds for small drones (sub-2 kg). Manufacturers' limits vary;
 * DJI Mini-class aircraft are typically rated to about 10.7 m/s and many
 * pilots treat gusts above 12 m/s as a no-fly.
 */
export const LIMITS = {
  windCautionMs: 8,
  windStrongMs: 10.7,
  gustNoFlyMs: 12,
  rainMm: 0.2,
  visibilityPoorM: 5000,
  visibilityBadM: 1500,
  coldC: 0,
};

export type Flyability = 'good' | 'caution' | 'poor';

export interface HourAssessment {
  hour: HourlyWeather;
  flyability: Flyability;
  reasons: string[];
}

export function assessHour(h: HourlyWeather): HourAssessment {
  const reasons: string[] = [];
  let level: Flyability = 'good';
  const bump = (to: Flyability) => {
    if (to === 'poor' || (to === 'caution' && level === 'good')) level = to;
  };
  if (h.gustMs !== null && h.gustMs >= LIMITS.gustNoFlyMs) {
    reasons.push(`gusts ${h.gustMs.toFixed(0)} m/s`);
    bump('poor');
  } else if (h.windMs !== null && h.windMs >= LIMITS.windStrongMs) {
    reasons.push(`wind ${h.windMs.toFixed(0)} m/s at 10 m`);
    bump('poor');
  } else if (h.windMs !== null && h.windMs >= LIMITS.windCautionMs) {
    reasons.push(`breezy, ${h.windMs.toFixed(0)} m/s at 10 m`);
    bump('caution');
  }
  if (h.wind120Ms !== null && h.wind120Ms >= LIMITS.windStrongMs && (h.windMs === null || h.windMs < LIMITS.windStrongMs)) {
    reasons.push(`wind ${h.wind120Ms.toFixed(0)} m/s at 120 m`);
    bump('caution');
  }
  if (h.precipitationMm !== null && h.precipitationMm >= LIMITS.rainMm) {
    reasons.push(`rain ${h.precipitationMm.toFixed(1)} mm`);
    bump('poor');
  } else if (h.precipitationProbability !== null && h.precipitationProbability >= 50) {
    reasons.push(`${h.precipitationProbability}% chance of rain`);
    bump('caution');
  }
  if (h.visibilityM !== null) {
    if (h.visibilityM < LIMITS.visibilityBadM) {
      reasons.push(`visibility ${(h.visibilityM / 1000).toFixed(1)} km`);
      bump('poor');
    } else if (h.visibilityM < LIMITS.visibilityPoorM) {
      reasons.push(`visibility ${(h.visibilityM / 1000).toFixed(0)} km`);
      bump('caution');
    }
  }
  if (h.temperatureC !== null && h.temperatureC <= LIMITS.coldC) {
    reasons.push(`${h.temperatureC.toFixed(0)} °C, battery life reduced`);
    bump('caution');
  }
  if (h.lowCloudPct !== null && h.lowCloudPct >= 90) {
    reasons.push('low cloud');
    bump('caution');
  }
  return { hour: h, flyability: level, reasons };
}

/** Open-Meteo returns Europe/London local times without an offset, e.g. 2026-09-26T14:00. */
export function localHourKey(d: Date): string {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hour12: false }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '00';
  return `${get('year')}-${get('month')}-${get('day')}T${get('hour') === '24' ? '00' : get('hour')}:00`;
}

export function compassPoint(deg: number | null): string {
  if (deg === null) return '';
  const points = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
  return points[Math.round(((deg % 360) + 360) % 360 / 45) % 8];
}

const WMO: Record<number, string> = {
  0: 'clear', 1: 'mainly clear', 2: 'partly cloudy', 3: 'overcast', 45: 'fog', 48: 'freezing fog',
  51: 'light drizzle', 53: 'drizzle', 55: 'heavy drizzle', 56: 'freezing drizzle', 57: 'freezing drizzle',
  61: 'light rain', 63: 'rain', 65: 'heavy rain', 66: 'freezing rain', 67: 'freezing rain',
  71: 'light snow', 73: 'snow', 75: 'heavy snow', 77: 'snow grains', 80: 'showers', 81: 'showers', 82: 'heavy showers',
  85: 'snow showers', 86: 'snow showers', 95: 'thunderstorm', 96: 'thunderstorm with hail', 99: 'thunderstorm with hail',
};

export function describeWeatherCode(code: number | null): string {
  return code === null ? 'unknown' : (WMO[code] ?? `code ${code}`);
}
