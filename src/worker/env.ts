import type { D1Like } from '../pack/d1-repository.js';

/** Minimal shapes of the Cloudflare bindings this Worker uses (kept local to avoid a types dependency). */
export interface KVLike {
  get(key: string, type: 'text'): Promise<string | null>;
  put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>;
}

export interface WorkerEnv {
  DB: D1Like;
  CACHE: KVLike;
  OS_NAMES_API_KEY?: string;
  NOMINATIM_URL?: string;
  OS_NAMES_URL?: string;
  POSTCODES_IO_URL?: string;
  NOTAM_PIB_URL?: string;
  NOTAM_CACHE_TTL_SECONDS?: string;
  GEOCODE_CACHE_TTL_SECONDS?: string;
  HTTP_TIMEOUT_MS?: string;
  LOG_LEVEL?: string;
  PUBLIC_URL?: string;
  /** Optional donation link (GitHub Sponsors or a Stripe Payment Link) shown in the map credits and the landing JSON. */
  SUPPORT_URL?: string;
  /** Optional recurring-donation link, shown beside SUPPORT_URL. */
  SUPPORT_MONTHLY_URL?: string;
  /** Embedded checkout: the account's secret key (a worker secret), the publishable key and the two price ids. */
  STRIPE_SECRET_KEY?: string;
  STRIPE_PUBLISHABLE_KEY?: string;
  STRIPE_PRICE_ONCE?: string;
  STRIPE_PRICE_MONTHLY?: string;
  OPEN_METEO_URL?: string;
  WEATHER_CACHE_TTL_SECONDS?: string;
  OPEN_METEO_ELEVATION_URL?: string;
  ELEVATION_CACHE_TTL_SECONDS?: string;
  NOAA_KP_URL?: string;
  SPACE_WEATHER_CACHE_TTL_SECONDS?: string;
}
