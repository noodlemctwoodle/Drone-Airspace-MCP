import path from 'node:path';
import { loadConfig, parseCliArgs, type Config } from './core/config.js';
import { DiskCache } from './core/disk-cache.js';
import { HttpClient } from './core/http-client.js';
import { createLogger, type Logger } from './core/logger.js';
import { TokenBucket } from './core/rate-limiter.js';
import type { HandlerDependencies } from './handlers/deps.js';
import { PackManager } from './pack/loader.js';
import { createServer } from './server.js';
import { AirspaceEngine } from './services/airspace/airspace-engine.js';
import { Geocoder } from './services/geocoder/index.js';
import { NominatimProvider } from './services/geocoder/nominatim-provider.js';
import { OsNamesProvider } from './services/geocoder/os-names-provider.js';
import { PostcodeProvider } from './services/geocoder/postcode-provider.js';
import type { GeocodeProvider } from './services/geocoder/provider.js';
import { NotamService } from './services/notam/index.js';
import { PibFetcher } from './services/notam/pib-fetcher.js';
import { RightsOfWayService } from './services/rights-of-way.js';
import { OpenMeteoClient } from './services/weather/open-meteo.js';
import { SpaceWeatherClient } from './services/weather/space-weather.js';
import { ElevationClient } from './services/terrain/elevation.js';
import { StreamableHttpTransport } from './transport/http.js';
import type { MCPTransport } from './transport/index.js';
import { StdioTransport } from './transport/stdio.js';
import { NAME, USER_AGENT, VERSION } from './version.js';
import { buildDroneIndex, buildViewData, buildWindField, geocodeQuery, mapHtml, parseWindQuery, resolveViewQuery } from './map/index.js';
import type { PackRepository } from './pack/repository.js';

const HELP = `${NAME} ${VERSION}

Usage: ${NAME} [--transport stdio|http] [--port 8080]

  --transport   stdio (default) for Claude Desktop and other MCP clients,
                http for a streamable HTTP server on POST /mcp (+ GET /healthz)
  --port        port for http transport (default 8080 or $PORT)
  --version     print the version
  --help        this text

Environment variables are documented in the README (OS_NAMES_API_KEY, NOTAM_PIB_URL, PACK_PATH, ...).`;

export interface BuiltDeps {
  deps: HandlerDependencies;
  packManager: PackManager;
}

/**
 * A repository is proxied through the PackManager so tools always see the
 * current pack after a hot swap.
 */
class LiveRepositoryProxy {
  constructor(private readonly manager: PackManager) {}
  get(): PackRepository {
    return this.manager.require();
  }
}

export function buildDeps(config: Config, logger: Logger, overrides: Partial<{ fetchImpl: (input: string, init?: RequestInit) => Promise<Response>; now: () => Date }> = {}): BuiltDeps {
  const http = new HttpClient({ userAgent: USER_AGENT, timeoutMs: config.httpTimeoutMs, logger, fetchImpl: overrides.fetchImpl });
  const cache = new DiskCache(path.join(config.cacheDir, 'http'));
  const now = overrides.now ?? (() => new Date());

  const providers: GeocodeProvider[] = [new PostcodeProvider(http, config.postcodesIoUrl)];
  if (config.osNamesApiKey) providers.push(new OsNamesProvider(http, config.osNamesUrl, config.osNamesApiKey));
  providers.push(new NominatimProvider(http, config.nominatimUrl, new TokenBucket(1, 1)));
  const geocoder = new Geocoder({ providers, cache, cacheTtlSeconds: config.geocodeCacheTtlSeconds, logger });

  const notams = new NotamService(new PibFetcher(http, cache, config.notamPibUrl, config.notamCacheTtlSeconds, logger, now));

  const packManager = new PackManager({ config, http, logger, fetchImpl: overrides.fetchImpl, now });
  const proxy = new LiveRepositoryProxy(packManager);
  const liveRepo: PackRepository = {
    meta: () => proxy.get().meta(),
    zonesAt: (lon, lat, o) => proxy.get().zonesAt(lon, lat, o),
    zonesInBbox: (b) => proxy.get().zonesInBbox(b),
    zonesAlongLine: (l) => proxy.get().zonesAlongLine(l),
    zoneById: (id) => proxy.get().zoneById(id),
    nearestRightsOfWay: (lon, lat, m, n) => proxy.get().nearestRightsOfWay(lon, lat, m, n),
    prowCoverageAt: (lon, lat) => proxy.get().prowCoverageAt(lon, lat),
    landRestrictionsAt: (lon, lat) => proxy.get().landRestrictionsAt(lon, lat),
    findAerodrome: (q, n) => proxy.get().findAerodrome(q, n),
    zonesByAerodrome: (name) => proxy.get().zonesByAerodrome(name),
    nearestParking: (lon, lat, m, n, priv) => proxy.get().nearestParking(lon, lat, m, n, priv),
    landRestrictionsInBbox: (b, l) => proxy.get().landRestrictionsInBbox(b, l),
    hazardsNear: (lon, lat, m, n) => proxy.get().hazardsNear(lon, lat, m, n),
    hazardsInBbox: (b, l, k, n) => proxy.get().hazardsInBbox(b, l, k, n),
    adminAreaAt: (lon, lat) => proxy.get().adminAreaAt(lon, lat),
    close: () => undefined,
  };

  const deps: HandlerDependencies = {
    config,
    logger,
    pack: packManager,
    geocoder,
    notams,
    airspace: new AirspaceEngine(liveRepo),
    rightsOfWay: new RightsOfWayService(liveRepo),
    weather: new OpenMeteoClient(http, cache, config.openMeteoUrl, config.weatherCacheTtlSeconds, now),
    spaceWeather: new SpaceWeatherClient(http, cache, config.noaaKpUrl, config.spaceWeatherCacheTtlSeconds, now),
    elevation: new ElevationClient(http, cache, config.openMeteoElevationUrl, config.elevationCacheTtlSeconds),
    now,
  };
  return { deps, packManager };
}

export async function bootstrap(argv: string[]): Promise<void> {
  const cli = parseCliArgs(argv);
  if (cli.version) {
    console.log(VERSION);
    return;
  }
  if (cli.help) {
    console.log(HELP);
    return;
  }
  const config = loadConfig(process.env, cli);
  const logger = createLogger(config.logLevel);
  const { deps, packManager } = buildDeps(config, logger);

  const transport: MCPTransport =
    config.transport === 'http'
      ? new StreamableHttpTransport(
          () => createServer(deps),
          logger,
          config.port,
          () => ({ version: VERSION, pack: packManager.status(), notamCacheAgeSeconds: deps.notams.status().ageSeconds }),
          '0.0.0.0',
          {
            mapHtml: (origin) => mapHtml({ mode: 'page', apiBase: config.publicUrl ?? origin, supportUrl: config.supportUrl ?? null }),
            viewData: async (params) => {
              const req = await resolveViewQuery(params, deps);
              return req ? buildViewData(deps, req) : undefined;
            },
            windData: async (params) => {
              const q = parseWindQuery(params);
              return q ? buildWindField(deps, q) : undefined;
            },
            droneIndex: () => buildDroneIndex(deps.now()),
            geocode: (params) => geocodeQuery(params, deps),
          }
        )
      : new StdioTransport(() => createServer(deps), logger);

  // Start serving first; the pack loads (or downloads) without blocking the handshake.
  await transport.start();
  void packManager.init();

  const shutdown = async () => {
    logger.info('shutting down');
    await transport.stop();
    packManager.close();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown());
  process.on('SIGTERM', () => void shutdown());
}
