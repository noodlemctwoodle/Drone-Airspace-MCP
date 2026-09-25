import { mkdtempSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadConfig, type Config } from '../../src/core/config.js';
import { DiskCache } from '../../src/core/disk-cache.js';
import { HttpClient } from '../../src/core/http-client.js';
import { createLogger } from '../../src/core/logger.js';
import { TokenBucket } from '../../src/core/rate-limiter.js';
import type { HandlerDependencies, PackAccess, PackState } from '../../src/handlers/deps.js';
import type { PackRepository } from '../../src/pack/repository.js';
import { AirspaceEngine } from '../../src/services/airspace/airspace-engine.js';
import { Geocoder } from '../../src/services/geocoder/index.js';
import { NominatimProvider } from '../../src/services/geocoder/nominatim-provider.js';
import { OsNamesProvider } from '../../src/services/geocoder/os-names-provider.js';
import { PostcodeProvider } from '../../src/services/geocoder/postcode-provider.js';
import type { GeocodeProvider } from '../../src/services/geocoder/provider.js';
import { NotamService } from '../../src/services/notam/index.js';
import { PibFetcher } from '../../src/services/notam/pib-fetcher.js';
import { RightsOfWayService } from '../../src/services/rights-of-way.js';
import { PackUnavailableError } from '../../src/core/errors.js';
import { FakePackRepository } from './fake-pack-repository.js';
import type { FetchLike } from '../../src/core/http-client.js';

export const FIXED_NOW = new Date('2026-09-25T12:00:00Z');

export class StaticPackAccess implements PackAccess {
  constructor(
    private repo: PackRepository | undefined,
    private state: PackState = repo ? { state: 'ready', tag: 'pack-test', path: ':memory:' } : { state: 'unavailable', reason: 'no pack in test' }
  ) {}
  require(): PackRepository {
    if (!this.repo) throw new PackUnavailableError(this.state.state === 'unavailable' ? this.state.reason : 'not ready');
    return this.repo;
  }
  current() {
    return this.repo;
  }
  status() {
    return this.state;
  }
  metaOrNull() {
    return this.repo ? this.repo.meta() : null;
  }
}

export function tempDir(prefix = 'drone-mcp-test-'): string {
  return mkdtempSync(path.join(os.tmpdir(), prefix));
}

export function testConfig(overrides: Partial<Record<string, string>> = {}): Config {
  return loadConfig({ DRONE_AIRSPACE_CACHE_DIR: tempDir(), LOG_LEVEL: 'silent', ...overrides });
}

export interface BuiltTestDeps {
  deps: HandlerDependencies;
  repo: FakePackRepository;
  config: Config;
}

export function buildTestDeps(opts: { fetchImpl?: FetchLike; config?: Config; repo?: PackRepository; noPack?: boolean; rate?: TokenBucket; now?: () => Date } = {}): BuiltTestDeps {
  const now = opts.now ?? (() => FIXED_NOW);
  const config = opts.config ?? testConfig();
  const logger = createLogger('silent');
  const http = new HttpClient({ userAgent: 'test', timeoutMs: 2000, retries: 0, fetchImpl: opts.fetchImpl ?? (async () => new Response('offline', { status: 503 })), sleep: async () => undefined });
  const cache = new DiskCache(path.join(config.cacheDir, 'http'), () => now().getTime());
  const providers: GeocodeProvider[] = [new PostcodeProvider(http, config.postcodesIoUrl)];
  if (config.osNamesApiKey) providers.push(new OsNamesProvider(http, config.osNamesUrl, config.osNamesApiKey));
  providers.push(new NominatimProvider(http, config.nominatimUrl, opts.rate ?? new TokenBucket(1000, 1000)));
  const geocoder = new Geocoder({ providers, cache, logger });
  const notams = new NotamService(new PibFetcher(http, cache, config.notamPibUrl, config.notamCacheTtlSeconds, logger, now));
  const repo = (opts.repo as FakePackRepository) ?? new FakePackRepository();
  const pack = new StaticPackAccess(opts.noPack ? undefined : repo);
  const deps: HandlerDependencies = {
    config,
    logger,
    pack,
    geocoder,
    notams,
    airspace: new AirspaceEngine(repo),
    rightsOfWay: new RightsOfWayService(repo),
    now,
  };
  return { deps, repo, config };
}
