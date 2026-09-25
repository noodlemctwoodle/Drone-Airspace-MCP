import { createHash } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { Readable, Transform } from 'node:stream';
import { createGunzip } from 'node:zlib';
import type { Config } from '../core/config.js';
import { PackUnavailableError } from '../core/errors.js';
import type { HttpClient } from '../core/http-client.js';
import type { Logger } from '../core/logger.js';
import type { PackAccess, PackState } from '../handlers/deps.js';
import type { PackMeta } from '../types.js';
import { REPO_URL } from '../version.js';
import { fetchManifest, type PackManifest } from './manifest.js';
import { SqlitePackRepository, type PackRepository } from './repository.js';
import { SCHEMA_VERSION } from './schema.js';

interface Installed {
  tag: string;
  sha256_sqlite: string;
  schema_version: number;
  installed_at: string;
  last_checked_at: string;
  airac?: { effective_from: string | null; effective_to: string | null };
}

export interface PackManagerOptions {
  config: Config;
  http: HttpClient;
  logger: Logger;
  fetchImpl?: (input: string, init?: RequestInit) => Promise<Response>;
  now?: () => Date;
}

/**
 * Owns the pack lifecycle: local override, first-run download with hash
 * verification and atomic rename, background staleness checks, hot swap.
 * Never blocks server startup; tools ask `require()` and get a clear error
 * until the pack is ready.
 */
export class PackManager implements PackAccess {
  private repo: PackRepository | undefined;
  private state: PackState = { state: 'unavailable', reason: 'not initialised' };
  private readonly dir: string;
  private readonly packPath: string;
  private readonly installedPath: string;
  private readonly now: () => Date;
  private readonly fetchImpl: (input: string, init?: RequestInit) => Promise<Response>;
  private swapChain: Promise<void> = Promise.resolve();
  private checking = false;

  constructor(private readonly opts: PackManagerOptions) {
    this.dir = opts.config.cacheDir;
    this.packPath = path.join(this.dir, 'pack.sqlite');
    this.installedPath = path.join(this.dir, 'installed.json');
    this.now = opts.now ?? (() => new Date());
    this.fetchImpl = opts.fetchImpl ?? ((input, init) => fetch(input, init));
  }

  require(): PackRepository {
    if (this.repo) return this.repo;
    if (this.state.state === 'downloading') {
      throw new PackUnavailableError(`still downloading${this.state.percent !== null ? ` (${this.state.percent}%)` : ''}; try again shortly. NOTAM and geocode tools work meanwhile.`);
    }
    throw new PackUnavailableError(this.state.state === 'unavailable' ? this.state.reason : 'not ready');
  }

  current(): PackRepository | undefined {
    return this.repo;
  }

  status(): PackState {
    return this.state;
  }

  metaOrNull(): PackMeta | null {
    try {
      return this.repo ? this.repo.meta() : null;
    } catch {
      return null;
    }
  }

  /** Opens whatever is available locally; returns whether a pack is ready. */
  async init(): Promise<boolean> {
    const { config, logger } = this.opts;
    if (config.packPath) {
      try {
        this.open(config.packPath, 'local');
        logger.info(`using local pack ${config.packPath}`);
        return true;
      } catch (error) {
        this.state = { state: 'unavailable', reason: `PACK_PATH ${config.packPath}: ${(error as Error).message}` };
        logger.error(this.state.reason);
        return false;
      }
    }
    const installed = await this.readInstalled();
    if (installed && installed.schema_version === SCHEMA_VERSION && (await exists(this.packPath))) {
      try {
        this.open(this.packPath, installed.tag);
        logger.info(`pack ${installed.tag} ready (${this.packPath})`);
        if (config.packUpdateCheck && this.hoursSince(installed.last_checked_at) >= config.packStaleHours) {
          void this.checkForUpdate();
        }
        return true;
      } catch (error) {
        logger.warn(`installed pack unusable (${(error as Error).message}); re-downloading`);
      }
    }
    this.state = { state: 'downloading', percent: null, tag: null };
    void this.downloadLatest(true);
    return false;
  }

  /** Block until the first pack is ready (used by tests and by --wait). */
  async ready(timeoutMs = 600_000): Promise<PackRepository> {
    const start = Date.now();
    while (!this.repo) {
      if (this.state.state === 'unavailable') throw new PackUnavailableError(this.state.reason);
      if (Date.now() - start > timeoutMs) throw new PackUnavailableError('timed out waiting for the pack download');
      await new Promise((r) => setTimeout(r, 200));
    }
    return this.repo;
  }

  async checkForUpdate(): Promise<void> {
    if (this.checking) return;
    this.checking = true;
    try {
      await this.downloadLatest(false);
    } finally {
      this.checking = false;
    }
  }

  private async downloadLatest(firstRun: boolean): Promise<void> {
    const { config, http, logger } = this.opts;
    let manifest: PackManifest;
    try {
      manifest = await fetchManifest(http, config.packManifestUrl, REPO_URL, config.githubToken);
    } catch (error) {
      const reason = `could not fetch pack manifest: ${(error as Error).message}`;
      if (firstRun) this.state = { state: 'unavailable', reason };
      logger.warn(reason);
      await this.touchChecked();
      return;
    }
    const installed = await this.readInstalled();
    if (!firstRun && installed && installed.tag === manifest.tag) {
      await this.touchChecked();
      return;
    }
    if (firstRun) this.state = { state: 'downloading', percent: 0, tag: manifest.tag };
    logger.info(`downloading pack ${manifest.tag} (${(manifest.asset.size_gz / 1_048_576).toFixed(0)} MB)`);
    const partPath = `${this.packPath}.part`;
    try {
      await mkdir(this.dir, { recursive: true });
      await this.downloadAsset(manifest, partPath, firstRun);
      await this.swapIn(partPath, manifest);
      logger.info(`pack ${manifest.tag} ready`);
    } catch (error) {
      await rm(partPath, { force: true });
      const reason = `pack download failed: ${(error as Error).message}`;
      logger.error(reason);
      if (firstRun) this.state = { state: 'unavailable', reason };
    } finally {
      await this.touchChecked();
    }
  }

  private async downloadAsset(manifest: PackManifest, partPath: string, reportProgress: boolean): Promise<void> {
    const { config, logger } = this.opts;
    const res = await this.fetchImpl(manifest.asset.url, {
      headers: { 'User-Agent': `uk-drone-airspace-mcp (+${REPO_URL})` },
      signal: AbortSignal.timeout(config.packDownloadTimeoutMs),
      redirect: 'follow',
    });
    if (!res.ok || !res.body) throw new Error(`HTTP ${res.status} fetching ${manifest.asset.url}`);
    const gzHash = createHash('sha256');
    const sqliteHash = createHash('sha256');
    let received = 0;
    let lastPercent = -1;
    const total = manifest.asset.size_gz;
    const progress = new Transform({
      transform: (chunk: Buffer, _enc, cb) => {
        gzHash.update(chunk);
        received += chunk.length;
        if (reportProgress && total > 0) {
          const pct = Math.floor((received / total) * 100);
          if (pct >= lastPercent + 5) {
            lastPercent = pct;
            this.state = { state: 'downloading', percent: pct, tag: manifest.tag };
            logger.info(`downloading pack ${manifest.tag}: ${pct}% (${(received / 1_048_576).toFixed(0)}/${(total / 1_048_576).toFixed(0)} MB)`);
          }
        }
        cb(null, chunk);
      },
    });
    const hashSqlite = new Transform({
      transform: (chunk: Buffer, _enc, cb) => {
        sqliteHash.update(chunk);
        cb(null, chunk);
      },
    });
    await pipeline(Readable.fromWeb(res.body as never), progress, createGunzip(), hashSqlite, createWriteStream(partPath));
    const gz = gzHash.digest('hex');
    const sq = sqliteHash.digest('hex');
    if (gz !== manifest.asset.sha256_gz) throw new Error(`sha256 mismatch on compressed pack (expected ${manifest.asset.sha256_gz}, got ${gz})`);
    if (sq !== manifest.asset.sha256_sqlite) throw new Error(`sha256 mismatch on pack (expected ${manifest.asset.sha256_sqlite}, got ${sq})`);
  }

  private swapIn(partPath: string, manifest: PackManifest): Promise<void> {
    const run = async () => {
      const old = this.repo;
      this.repo = undefined;
      try {
        old?.close();
      } catch {
        // ignore
      }
      await rename(partPath, this.packPath);
      this.open(this.packPath, manifest.tag);
      const installed: Installed = {
        tag: manifest.tag,
        sha256_sqlite: manifest.asset.sha256_sqlite,
        schema_version: manifest.schema_version,
        installed_at: this.now().toISOString(),
        last_checked_at: this.now().toISOString(),
        airac: manifest.airac,
      };
      await writeFile(this.installedPath, JSON.stringify(installed, null, 2));
    };
    this.swapChain = this.swapChain.then(run, run);
    return this.swapChain;
  }

  private open(file: string, tag: string): void {
    this.repo = new SqlitePackRepository(file);
    this.state = { state: 'ready', tag, path: file };
  }

  private async readInstalled(): Promise<Installed | undefined> {
    try {
      return JSON.parse(await readFile(this.installedPath, 'utf8')) as Installed;
    } catch {
      return undefined;
    }
  }

  private async touchChecked(): Promise<void> {
    const installed = await this.readInstalled();
    if (!installed) return;
    installed.last_checked_at = this.now().toISOString();
    try {
      await writeFile(this.installedPath, JSON.stringify(installed, null, 2));
    } catch {
      // best effort
    }
  }

  private hoursSince(iso: string): number {
    const t = new Date(iso).getTime();
    if (Number.isNaN(t)) return Infinity;
    return (this.now().getTime() - t) / 3_600_000;
  }

  close(): void {
    try {
      this.repo?.close();
    } catch {
      // ignore
    }
    this.repo = undefined;
  }
}

async function exists(file: string): Promise<boolean> {
  try {
    await stat(file);
    return true;
  } catch {
    return false;
  }
}
