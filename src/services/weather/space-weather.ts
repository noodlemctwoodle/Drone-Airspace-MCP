import type { CacheStore } from '../../core/cache-store.js';
import type { HttpClient } from '../../core/http-client.js';
import type { Flyability } from './assessment.js';

/**
 * NOAA planetary K-index: a 0 to 9 measure of geomagnetic activity issued
 * every three hours. High values degrade GPS accuracy and trigger compass
 * calibration prompts on small drones. Public domain (US Government).
 */
export type GeomagneticLevel = 'quiet' | 'unsettled' | 'active' | 'storm';

export interface KpReading {
  /** ISO 8601 UTC. */
  time: string;
  kp: number;
}

export interface SpaceWeather {
  latest: KpReading;
  level: GeomagneticLevel;
  flyability: Flyability;
  note: string;
  fetchedAt: string;
  fromCache: boolean;
  /** Seconds between the reading's time and now. */
  ageSeconds: number;
}

const CACHE_KEY = 'spaceweather:noaa-kp:v1';

function isoOf(raw: unknown): string | null {
  if (typeof raw !== 'string' || raw.trim() === '') return null;
  const t = raw.trim().replace(' ', 'T');
  const d = new Date(/[zZ]|[+-]\d{2}:?\d{2}$/.test(t) ? t : `${t}Z`);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/**
 * Defensive: NOAA has published this feed both as an array of objects and as
 * an array of arrays with a header row. Anything else yields no readings.
 */
export function parseKpFeed(raw: unknown): KpReading[] {
  if (!Array.isArray(raw) || raw.length === 0) return [];
  const out: KpReading[] = [];
  if (Array.isArray(raw[0])) {
    const header = (raw[0] as unknown[]).map((h) => String(h).toLowerCase());
    const ti = header.indexOf('time_tag');
    const ki = header.findIndex((h) => h === 'kp' || h === 'kp_index');
    if (ti < 0 || ki < 0) return [];
    for (const row of raw.slice(1)) {
      if (!Array.isArray(row)) continue;
      const time = isoOf(row[ti]);
      const kp = Number(row[ki]);
      if (time && Number.isFinite(kp)) out.push({ time, kp });
    }
  } else {
    for (const row of raw) {
      if (!row || typeof row !== 'object') continue;
      const r = row as Record<string, unknown>;
      const time = isoOf(r.time_tag);
      const kp = Number(r.Kp ?? r.kp ?? r.kp_index);
      if (time && Number.isFinite(kp)) out.push({ time, kp });
    }
  }
  return out.sort((a, b) => a.time.localeCompare(b.time));
}

export function rateKp(kp: number): { level: GeomagneticLevel; flyability: Flyability; note: string } {
  if (kp >= 5) return { level: 'storm', flyability: 'poor', note: 'geomagnetic storm: GPS position and compass heading may be unreliable, expect compass calibration prompts and fewer satellites' };
  if (kp >= 4) return { level: 'active', flyability: 'caution', note: 'raised geomagnetic activity: GPS accuracy may be reduced' };
  if (kp >= 3) return { level: 'unsettled', flyability: 'good', note: 'slightly unsettled, no effect expected' };
  return { level: 'quiet', flyability: 'good', note: 'quiet' };
}

export class SpaceWeatherClient {
  constructor(
    private readonly http: HttpClient,
    private readonly cache: CacheStore,
    private readonly url: string,
    private readonly ttlSeconds = 900,
    private readonly now: () => Date = () => new Date()
  ) {}

  async latest(): Promise<SpaceWeather> {
    const cached = await this.cache.getEntry<unknown>(CACHE_KEY);
    if (cached && this.cache.isFresh(cached)) return this.build(cached.value, new Date(cached.storedAt).toISOString(), true);
    try {
      const { data } = await this.http.getJson<unknown>(this.url, { provider: 'noaa-swpc', timeoutMs: 5000 });
      if (parseKpFeed(data).length === 0) throw new Error('NOAA Kp feed had no readings');
      await this.cache.set(CACHE_KEY, data, this.ttlSeconds);
      return this.build(data, this.now().toISOString(), false);
    } catch (error) {
      if (cached) return this.build(cached.value, new Date(cached.storedAt).toISOString(), true);
      throw error;
    }
  }

  private build(raw: unknown, fetchedAt: string, fromCache: boolean): SpaceWeather {
    const readings = parseKpFeed(raw);
    const latest = readings[readings.length - 1];
    if (!latest) throw new Error('NOAA Kp feed had no readings');
    const rating = rateKp(latest.kp);
    const ageSeconds = Math.max(0, Math.round((this.now().getTime() - new Date(latest.time).getTime()) / 1000));
    return { latest, ...rating, fetchedAt, fromCache, ageSeconds };
  }
}
