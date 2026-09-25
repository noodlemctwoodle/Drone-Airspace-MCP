#!/usr/bin/env tsx
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { cycleEnd } from '../pipeline/lib/airac.js';
import { parsePipelineArgs } from '../pipeline/lib/cli.js';
import { MANIFEST_KIND } from '../src/pack/manifest.js';
import { SCHEMA_VERSION } from '../src/pack/schema.js';
import type { PackSource } from '../src/types.js';
import { REPO_URL, VERSION } from '../src/version.js';

export async function sha256File(file: string): Promise<string> {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk as Buffer);
  return hash.digest('hex');
}

export interface ManifestInput {
  packPath: string;
  gzPath: string;
  tag: string;
  region: string;
  sources: PackSource[];
  counts: Record<string, number>;
  airac: string | null;
  buildCommit: string | null;
  out: string;
  repoUrl?: string;
}

export async function writeManifest(input: ManifestInput): Promise<string> {
  const repo = input.repoUrl ?? process.env.PACK_REPO_URL ?? REPO_URL;
  const assetName = path.basename(input.gzPath);
  const manifest = {
    kind: MANIFEST_KIND,
    manifest_version: 1,
    schema_version: SCHEMA_VERSION,
    tag: input.tag,
    built_at: new Date().toISOString(),
    build_commit: input.buildCommit,
    region: input.region,
    asset: {
      name: assetName,
      url: `${repo}/releases/download/${input.tag}/${assetName}`,
      size_gz: (await stat(input.gzPath)).size,
      size_sqlite: (await stat(input.packPath)).size,
      sha256_gz: await sha256File(input.gzPath),
      sha256_sqlite: await sha256File(input.packPath),
    },
    airac: { effective_from: input.airac, effective_to: input.airac ? cycleEnd(input.airac) : null },
    sources: input.sources,
    counts: input.counts,
    min_server_version: VERSION,
  };
  const file = path.join(input.out, 'manifest.json');
  await writeFile(file, JSON.stringify(manifest, null, 2));
  return file;
}

if (process.argv[1] && /make-manifest\.ts$/.test(process.argv[1])) {
  const args = parsePipelineArgs(process.argv.slice(2));
  const packPath = args.positionals[0];
  if (!packPath) {
    console.error('usage: make-manifest.ts <pack.sqlite> [--tag pack-YYYYMMDD-N] [--region name]');
    process.exit(2);
  }
  (async () => {
    const { readFile } = await import('node:fs/promises');
    const { SqlitePackRepository } = await import('../src/pack/repository.js');
    const repo = new SqlitePackRepository(packPath);
    const meta = repo.meta();
    repo.close();
    const gzPath = `${packPath}.gz`;
    await stat(gzPath).catch(() => {
      throw new Error(`${gzPath} not found; gzip the pack first`);
    });
    const file = await writeManifest({ packPath, gzPath, tag: args.tag ?? meta.packTag, region: meta.region, sources: meta.sources, counts: meta.counts, airac: meta.airacEffective, buildCommit: meta.buildCommit, out: args.out });
    console.error(`[make-manifest] wrote ${file}`);
    console.log(await readFile(file, 'utf8'));
  })().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
