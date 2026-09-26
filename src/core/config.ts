import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { z } from 'zod';
import { REPO_URL } from '../version.js';

const DEFAULT_MANIFEST_URL = `${REPO_URL}/releases/latest/download/manifest.json`;

const CACHE_DIR_NAME = 'fpv-airspace';
/** The directory name before the rename; still used when it exists and the new one does not, so nobody re-downloads the pack. */
const LEGACY_CACHE_DIR_NAME = 'uk-drone-airspace-mcp';

function cacheDirCandidates(env: NodeJS.ProcessEnv): [string, string] {
  if (env.XDG_CACHE_HOME) return [path.join(env.XDG_CACHE_HOME, CACHE_DIR_NAME), path.join(env.XDG_CACHE_HOME, LEGACY_CACHE_DIR_NAME)];
  if (process.platform === 'win32' && env.LOCALAPPDATA) {
    return [path.join(env.LOCALAPPDATA, CACHE_DIR_NAME, 'cache'), path.join(env.LOCALAPPDATA, LEGACY_CACHE_DIR_NAME, 'cache')];
  }
  return [path.join(os.homedir(), '.cache', CACHE_DIR_NAME), path.join(os.homedir(), '.cache', LEGACY_CACHE_DIR_NAME)];
}

function defaultCacheDir(env: NodeJS.ProcessEnv): string {
  const [current, legacy] = cacheDirCandidates(env);
  if (!existsSync(current) && existsSync(legacy)) return legacy;
  return current;
}

const intFromEnv = (fallback: number, min = 1) =>
  z
    .string()
    .optional()
    .transform((v) => (v === undefined || v === '' ? fallback : Number(v)))
    .pipe(z.number().int().min(min));

const boolFromEnv = (fallback: boolean) =>
  z
    .string()
    .optional()
    .transform((v) => (v === undefined || v === '' ? fallback : !/^(0|false|no|off)$/i.test(v)));

const envSchema = z.object({
  NOMINATIM_URL: z.string().url().default('https://nominatim.openstreetmap.org/search'),
  OS_NAMES_API_KEY: z.string().optional().transform((v) => (v && v.trim() !== '' ? v.trim() : undefined)),
  OS_NAMES_URL: z.string().url().default('https://api.os.uk/search/names/v1/find'),
  POSTCODES_IO_URL: z.string().url().default('https://api.postcodes.io'),
  NOTAM_PIB_URL: z.string().url().default('https://pibs.nats.co.uk/operational/pibs/PIB.xml'),
  OPEN_METEO_URL: z.string().url().default('https://api.open-meteo.com/v1/forecast'),
  WEATHER_CACHE_TTL_SECONDS: intFromEnv(900),
  OPEN_METEO_ELEVATION_URL: z.string().url().default('https://api.open-meteo.com/v1/elevation'),
  ELEVATION_CACHE_TTL_SECONDS: intFromEnv(30 * 24 * 3600),
  NOAA_KP_URL: z.string().url().default('https://services.swpc.noaa.gov/products/noaa-planetary-k-index.json'),
  SPACE_WEATHER_CACHE_TTL_SECONDS: intFromEnv(900),
  NOTAM_CACHE_TTL_SECONDS: intFromEnv(1800),
  GEOCODE_CACHE_TTL_SECONDS: intFromEnv(30 * 24 * 3600),
  HTTP_TIMEOUT_MS: intFromEnv(8000, 100),
  FPV_AIRSPACE_CACHE_DIR: z.string().optional(),
  /** The pre-rename name of FPV_AIRSPACE_CACHE_DIR; still honoured. */
  DRONE_AIRSPACE_CACHE_DIR: z.string().optional(),
  PACK_MANIFEST_URL: z.string().default(DEFAULT_MANIFEST_URL),
  PACK_PATH: z.string().optional().transform((v) => (v && v.trim() !== '' ? v : undefined)),
  PACK_UPDATE_CHECK: boolFromEnv(true),
  PACK_STALE_HOURS: intFromEnv(24),
  PACK_DOWNLOAD_TIMEOUT_MS: intFromEnv(600_000, 1000),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error', 'silent']).default('info'),
  MCP_TRANSPORT: z.enum(['stdio', 'http']).default('stdio'),
  PORT: intFromEnv(8080),
  GITHUB_TOKEN: z.string().optional(),
  PUBLIC_URL: z.string().optional().transform((v) => (v && /^https?:\/\//.test(v) ? v.replace(/\/+$/, '') : undefined)),
  SUPPORT_URL: z.string().optional().transform((v) => (v && /^https:\/\//.test(v) ? v : undefined)),
  SUPPORT_MONTHLY_URL: z.string().optional().transform((v) => (v && /^https:\/\//.test(v) ? v : undefined)),
  STRIPE_SECRET_KEY: z.string().optional(),
  STRIPE_PUBLISHABLE_KEY: z.string().optional(),
  STRIPE_PRICE_ONCE: z.string().optional(),
  STRIPE_PRICE_MONTHLY: z.string().optional(),
});

export interface Config {
  nominatimUrl: string;
  osNamesApiKey: string | undefined;
  osNamesUrl: string;
  postcodesIoUrl: string;
  notamPibUrl: string;
  notamCacheTtlSeconds: number;
  openMeteoUrl: string;
  weatherCacheTtlSeconds: number;
  openMeteoElevationUrl: string;
  elevationCacheTtlSeconds: number;
  noaaKpUrl: string;
  spaceWeatherCacheTtlSeconds: number;
  geocodeCacheTtlSeconds: number;
  httpTimeoutMs: number;
  cacheDir: string;
  packManifestUrl: string;
  packPath: string | undefined;
  packUpdateCheck: boolean;
  packStaleHours: number;
  packDownloadTimeoutMs: number;
  logLevel: 'debug' | 'info' | 'warn' | 'error' | 'silent';
  transport: 'stdio' | 'http';
  port: number;
  githubToken: string | undefined;
  /** Base URL of a hosted deployment; enables map links and the map app. */
  publicUrl: string | undefined;
  supportUrl?: string;
  supportMonthlyUrl?: string;
  stripe: { secretKey?: string; publishableKey?: string; priceOnce?: string; priceMonthly?: string };
}

export interface CliArgs {
  transport?: 'stdio' | 'http';
  port?: number;
  version: boolean;
  help: boolean;
}

export function parseCliArgs(argv: string[]): CliArgs {
  const { values } = parseArgs({
    args: argv,
    options: {
      transport: { type: 'string' },
      port: { type: 'string' },
      version: { type: 'boolean', short: 'v', default: false },
      help: { type: 'boolean', short: 'h', default: false },
    },
    strict: true,
    allowPositionals: false,
  });
  const transport = values.transport;
  if (transport !== undefined && transport !== 'stdio' && transport !== 'http') {
    throw new Error(`--transport must be "stdio" or "http", got "${transport}"`);
  }
  const port = values.port === undefined ? undefined : Number(values.port);
  if (port !== undefined && (!Number.isInteger(port) || port < 1 || port > 65535)) {
    throw new Error(`--port must be an integer between 1 and 65535, got "${values.port}"`);
  }
  return { transport, port, version: values.version ?? false, help: values.help ?? false };
}

/**
 * Desktop-extension hosts substitute `${user_config.x}` / `${HOME}` into env
 * values; when a value is left unset the literal placeholder can arrive
 * instead. Treat anything still containing `${` as not provided.
 */
export function sanitiseEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const out: NodeJS.ProcessEnv = {};
  for (const [k, v] of Object.entries(env)) {
    if (typeof v === 'string' && v.includes('${')) continue;
    out[k] = v;
  }
  return out;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env, cli: Partial<CliArgs> = {}): Config {
  env = sanitiseEnv(env);
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const key = issue?.path.join('.') ?? 'environment';
    throw new Error(`Invalid configuration for ${key}: ${issue?.message ?? 'unknown error'}`);
  }
  const e = parsed.data;
  return Object.freeze({
    nominatimUrl: e.NOMINATIM_URL,
    osNamesApiKey: e.OS_NAMES_API_KEY,
    osNamesUrl: e.OS_NAMES_URL,
    postcodesIoUrl: e.POSTCODES_IO_URL.replace(/\/+$/, ''),
    notamPibUrl: e.NOTAM_PIB_URL,
    notamCacheTtlSeconds: e.NOTAM_CACHE_TTL_SECONDS,
    openMeteoUrl: e.OPEN_METEO_URL,
    weatherCacheTtlSeconds: e.WEATHER_CACHE_TTL_SECONDS,
    openMeteoElevationUrl: e.OPEN_METEO_ELEVATION_URL,
    elevationCacheTtlSeconds: e.ELEVATION_CACHE_TTL_SECONDS,
    noaaKpUrl: e.NOAA_KP_URL,
    spaceWeatherCacheTtlSeconds: e.SPACE_WEATHER_CACHE_TTL_SECONDS,
    geocodeCacheTtlSeconds: e.GEOCODE_CACHE_TTL_SECONDS,
    httpTimeoutMs: e.HTTP_TIMEOUT_MS,
    cacheDir: [e.FPV_AIRSPACE_CACHE_DIR, e.DRONE_AIRSPACE_CACHE_DIR].find((v) => v && v.trim() !== '') ?? defaultCacheDir(env),
    packManifestUrl: e.PACK_MANIFEST_URL,
    packPath: e.PACK_PATH,
    packUpdateCheck: e.PACK_UPDATE_CHECK,
    packStaleHours: e.PACK_STALE_HOURS,
    packDownloadTimeoutMs: e.PACK_DOWNLOAD_TIMEOUT_MS,
    logLevel: e.LOG_LEVEL,
    transport: cli.transport ?? e.MCP_TRANSPORT,
    port: cli.port ?? e.PORT,
    githubToken: e.GITHUB_TOKEN && e.GITHUB_TOKEN.trim() !== '' ? e.GITHUB_TOKEN : undefined,
    publicUrl: e.PUBLIC_URL,
    supportUrl: e.SUPPORT_URL,
    supportMonthlyUrl: e.SUPPORT_MONTHLY_URL,
    stripe: { secretKey: e.STRIPE_SECRET_KEY || undefined, publishableKey: e.STRIPE_PUBLISHABLE_KEY || undefined, priceOnce: e.STRIPE_PRICE_ONCE || undefined, priceMonthly: e.STRIPE_PRICE_MONTHLY || undefined },
  });
}
