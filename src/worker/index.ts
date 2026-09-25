import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { loadConfig } from '../core/config.js';
import { HttpClient } from '../core/http-client.js';
import { createLogger } from '../core/logger.js';
import { TokenBucket } from '../core/rate-limiter.js';
import type { HandlerDependencies } from '../handlers/deps.js';
import { createServer } from '../server.js';
import { AirspaceEngine } from '../services/airspace/airspace-engine.js';
import { Geocoder } from '../services/geocoder/index.js';
import { NominatimProvider } from '../services/geocoder/nominatim-provider.js';
import { OsNamesProvider } from '../services/geocoder/os-names-provider.js';
import { PostcodeProvider } from '../services/geocoder/postcode-provider.js';
import type { GeocodeProvider } from '../services/geocoder/provider.js';
import { NotamService } from '../services/notam/index.js';
import { PibFetcher } from '../services/notam/pib-fetcher.js';
import { RightsOfWayService } from '../services/rights-of-way.js';
import { OpenMeteoClient } from '../services/weather/open-meteo.js';
import { NAME, REPO_URL, USER_AGENT, VERSION } from '../version.js';
import { D1PackAccess } from './d1-pack.js';
import type { WorkerEnv } from './env.js';
import { KvCacheStore } from './kv-cache.js';
import { buildViewData, mapHtml, resolveViewQuery } from '../map/index.js';

// One Nominatim bucket per isolate; the platform may run several isolates, so
// prefer an OS Names key on the Worker for heavy use.
const nominatimBucket = new TokenBucket(1, 1);
let cachedDeps: { key: string; deps: HandlerDependencies; pack: D1PackAccess; notams: NotamService } | undefined;

function buildDeps(env: WorkerEnv) {
  const key = JSON.stringify([env.OS_NAMES_API_KEY ? 'k' : '', env.NOMINATIM_URL, env.NOTAM_PIB_URL, env.LOG_LEVEL]);
  if (cachedDeps && cachedDeps.key === key) return cachedDeps;
  const config = loadConfig(env as unknown as NodeJS.ProcessEnv, { transport: 'http' });
  const logger = createLogger(config.logLevel);
  const http = new HttpClient({ userAgent: USER_AGENT, timeoutMs: config.httpTimeoutMs, logger });
  const cache = new KvCacheStore(env.CACHE);
  const providers: GeocodeProvider[] = [new PostcodeProvider(http, config.postcodesIoUrl)];
  if (config.osNamesApiKey) providers.push(new OsNamesProvider(http, config.osNamesUrl, config.osNamesApiKey));
  providers.push(new NominatimProvider(http, config.nominatimUrl, nominatimBucket));
  const geocoder = new Geocoder({ providers, cache, cacheTtlSeconds: config.geocodeCacheTtlSeconds, logger });
  const notams = new NotamService(new PibFetcher(http, cache, config.notamPibUrl, config.notamCacheTtlSeconds, logger));
  const pack = new D1PackAccess(env.DB);
  const repo = pack.require();
  const deps: HandlerDependencies = {
    config,
    logger,
    pack,
    geocoder,
    notams,
    airspace: new AirspaceEngine(repo),
    rightsOfWay: new RightsOfWayService(repo),
    weather: new OpenMeteoClient(http, cache, config.openMeteoUrl, config.weatherCacheTtlSeconds),
    now: () => new Date(),
  };
  cachedDeps = { key, deps, pack, notams };
  return cachedDeps;
}

const JSON_HEADERS = { 'content-type': 'application/json; charset=utf-8' };
const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-methods': 'GET, OPTIONS', 'access-control-allow-headers': 'content-type' };

function landing(env: WorkerEnv): Response {
  const url = env.PUBLIC_URL ?? '';
  const body = {
    name: NAME,
    version: VERSION,
    description: 'UK drone airspace MCP server: flight restriction zones, live NOTAMs, public rights of way and landowner rules.',
    mcp_endpoint: `${url}/mcp`,
    transport: 'streamable-http',
    repository: REPO_URL,
    add_to_claude: 'Settings > Connectors > Add custom connector, paste the mcp_endpoint URL.',
  };
  return new Response(JSON.stringify(body, null, 2), { headers: JSON_HEADERS });
}

export default {
  async fetch(request: Request, env: WorkerEnv): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === '/' && request.method === 'GET') return landing(env);
    if (url.pathname === '/map' && request.method === 'GET') {
      return new Response(mapHtml({ mode: 'page', apiBase: env.PUBLIC_URL ?? url.origin }), { headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'public, max-age=3600' } });
    }
    if (url.pathname === '/api/view') {
      if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
      const { deps } = buildDeps(env);
      try {
        const req = await resolveViewQuery(url.searchParams, deps);
        if (!req) return new Response(JSON.stringify({ error: 'lat and lon, place, or waypoints query parameters are required' }), { status: 400, headers: { ...JSON_HEADERS, ...CORS } });
        const view = await buildViewData(deps, req);
        return new Response(JSON.stringify(view), { headers: { ...JSON_HEADERS, ...CORS, 'cache-control': 'public, max-age=300' } });
      } catch (error) {
        return new Response(JSON.stringify({ error: (error as Error).message }), { status: 503, headers: { ...JSON_HEADERS, ...CORS } });
      }
    }
    if (url.pathname === '/healthz') {
      const { pack, notams } = buildDeps(env);
      const meta = await pack.metaOrNull();
      return new Response(JSON.stringify({ ok: !!meta, version: VERSION, pack: pack.status(), airac: meta?.airacEffective ?? null, notamCacheAgeSeconds: notams.status().ageSeconds }), {
        status: meta ? 200 : 503,
        headers: JSON_HEADERS,
      });
    }
    if (url.pathname === '/mcp') {
      if (request.method !== 'POST') {
        return new Response(JSON.stringify({ jsonrpc: '2.0', error: { code: -32000, message: 'Method not allowed.' }, id: null }), { status: 405, headers: JSON_HEADERS });
      }
      // Stateless: a fresh server and transport per request. Nothing is closed
      // here because the response body is still streaming when handleRequest
      // returns; the objects are collected with the request.
      const { deps } = buildDeps(env);
      const server = createServer(deps);
      const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined });
      await server.connect(transport);
      return transport.handleRequest(request);
    }
    return new Response('Not found', { status: 404 });
  },
};
