import type { CacheStore } from '../../core/cache-store.js';
import type { HttpClient } from '../../core/http-client.js';

export interface HourlyWeather {
  time: string; // local ISO hour, Europe/London
  temperatureC: number | null;
  windMs: number | null; // 10 m
  gustMs: number | null; // 10 m
  windDirectionDeg: number | null;
  wind120Ms: number | null; // 120 m, the open-category ceiling
  precipitationMm: number | null;
  precipitationProbability: number | null;
  visibilityM: number | null;
  cloudCoverPct: number | null;
  lowCloudPct: number | null;
  weatherCode: number | null;
}

export interface DailyWeather {
  date: string;
  sunrise: string | null;
  sunset: string | null;
}

export interface Forecast {
  latitude: number;
  longitude: number;
  elevationM: number | null;
  timezone: string;
  hourly: HourlyWeather[];
  daily: DailyWeather[];
  fetchedAt: string;
  fromCache: boolean;
}

export const OPEN_METEO_DEFAULT_URL = 'https://api.open-meteo.com/v1/forecast';
export const OPEN_METEO_ATTRIBUTION = 'Weather: Open-Meteo.com (CC BY 4.0)';

const WIND_HOURLY = ['wind_speed_10m', 'wind_gusts_10m', 'wind_direction_10m', 'wind_speed_120m'];
const HOURLY = ['temperature_2m', 'precipitation_probability', 'precipitation', 'wind_speed_10m', 'wind_gusts_10m', 'wind_direction_10m', 'wind_speed_120m', 'visibility', 'cloud_cover', 'cloud_cover_low', 'weather_code'];

interface RawForecast {
  latitude?: number;
  longitude?: number;
  elevation?: number;
  timezone?: string;
  hourly?: Record<string, unknown[]>;
  daily?: Record<string, unknown[]>;
}

const numOrNull = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/** Defensive: any missing or malformed series becomes nulls, never a throw. */
export function parseForecast(raw: unknown, fetchedAt: string, fromCache = false): Forecast {
  const r = (raw ?? {}) as RawForecast;
  const h = r.hourly ?? {};
  const times = Array.isArray(h.time) ? (h.time as unknown[]).map(String) : [];
  const col = (k: string, i: number) => (Array.isArray(h[k]) ? numOrNull((h[k] as unknown[])[i]) : null);
  const hourly: HourlyWeather[] = times.map((time, i) => ({
    time,
    temperatureC: col('temperature_2m', i),
    windMs: col('wind_speed_10m', i),
    gustMs: col('wind_gusts_10m', i),
    windDirectionDeg: col('wind_direction_10m', i),
    wind120Ms: col('wind_speed_120m', i),
    precipitationMm: col('precipitation', i),
    precipitationProbability: col('precipitation_probability', i),
    visibilityM: col('visibility', i),
    cloudCoverPct: col('cloud_cover', i),
    lowCloudPct: col('cloud_cover_low', i),
    weatherCode: col('weather_code', i),
  }));
  const d = r.daily ?? {};
  const dates = Array.isArray(d.time) ? (d.time as unknown[]).map(String) : [];
  const daily: DailyWeather[] = dates.map((date, i) => ({
    date,
    sunrise: Array.isArray(d.sunrise) && typeof d.sunrise[i] === 'string' ? (d.sunrise[i] as string) : null,
    sunset: Array.isArray(d.sunset) && typeof d.sunset[i] === 'string' ? (d.sunset[i] as string) : null,
  }));
  return {
    latitude: numOrNull(r.latitude) ?? 0,
    longitude: numOrNull(r.longitude) ?? 0,
    elevationM: numOrNull(r.elevation),
    timezone: typeof r.timezone === 'string' ? r.timezone : 'Europe/London',
    hourly,
    daily,
    fetchedAt,
    fromCache,
  };
}

export class OpenMeteoClient {
  constructor(
    private readonly http: HttpClient,
    private readonly cache: CacheStore,
    private readonly baseUrl: string = OPEN_METEO_DEFAULT_URL,
    private readonly ttlSeconds = 900,
    private readonly now: () => Date = () => new Date()
  ) {}

  async forecast(lat: number, lon: number): Promise<Forecast> {
    // Cache per ~5 km cell so nearby requests share a forecast.
    const key = `weather:openmeteo:v1:${lat.toFixed(2)}:${lon.toFixed(2)}`;
    const cached = await this.cache.getEntry<unknown>(key);
    if (cached && this.cache.isFresh(cached)) return parseForecast(cached.value, new Date(cached.storedAt).toISOString(), true);
    const params = new URLSearchParams({
      latitude: lat.toFixed(4),
      longitude: lon.toFixed(4),
      hourly: HOURLY.join(','),
      daily: 'sunrise,sunset',
      wind_speed_unit: 'ms',
      timezone: 'Europe/London',
      forecast_days: '7',
    });
    try {
      const { data } = await this.http.getJson<unknown>(`${this.baseUrl}?${params.toString()}`, { provider: 'open-meteo' });
      await this.cache.set(key, data, this.ttlSeconds);
      return parseForecast(data, this.now().toISOString());
    } catch (error) {
      if (cached) return parseForecast(cached.value, new Date(cached.storedAt).toISOString(), true);
      throw error;
    }
  }

  /**
   * Wind-only forecasts for many points in one request (Open-Meteo returns an
   * array when given comma-separated coordinates). Each point is cached on its
   * own so a panned map only fetches the points it has not seen. Points that
   * fail to parse are dropped rather than throwing.
   */
  async windField(points: Array<{ lat: number; lon: number }>): Promise<Forecast[]> {
    const keyOf = (pt: { lat: number; lon: number }) => `weather:wind:v1:${pt.lat.toFixed(3)}:${pt.lon.toFixed(3)}`;
    const out = new Map<string, Forecast>();
    const missing: Array<{ lat: number; lon: number }> = [];
    // Open-Meteo reports its model cell centre as latitude/longitude; always report the requested point instead so arrows sit on the lattice.
    const at = (f: Forecast, pt: { lat: number; lon: number }): Forecast => ({ ...f, latitude: pt.lat, longitude: pt.lon });
    for (const pt of points) {
      const cached = await this.cache.getEntry<unknown>(keyOf(pt));
      if (cached && this.cache.isFresh(cached)) out.set(keyOf(pt), at(parseForecast(cached.value, new Date(cached.storedAt).toISOString(), true), pt));
      else missing.push(pt);
    }
    if (missing.length > 0) {
      const params = new URLSearchParams({
        latitude: missing.map((p) => p.lat.toFixed(3)).join(','),
        longitude: missing.map((p) => p.lon.toFixed(3)).join(','),
        hourly: WIND_HOURLY.join(','),
        wind_speed_unit: 'ms',
        timezone: 'Europe/London',
        forecast_days: '2',
      });
      const { data } = await this.http.getJson<unknown>(`${this.baseUrl}?${params.toString()}`, { provider: 'open-meteo' });
      const list = Array.isArray(data) ? data : [data];
      const fetchedAt = this.now().toISOString();
      for (let i = 0; i < missing.length; i++) {
        const raw = list[i];
        if (!raw || typeof raw !== 'object') continue;
        await this.cache.set(keyOf(missing[i]), raw, this.ttlSeconds);
        out.set(keyOf(missing[i]), at(parseForecast(raw, fetchedAt), missing[i]));
      }
    }
    return points.map((pt) => out.get(keyOf(pt))).filter((f): f is Forecast => f !== undefined);
  }
}
