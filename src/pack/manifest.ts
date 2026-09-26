import { readFile } from 'node:fs/promises';
import { z } from 'zod';
import type { HttpClient } from '../core/http-client.js';
import { UpstreamError } from '../core/errors.js';
import { SCHEMA_VERSION } from './schema.js';

export const MANIFEST_KIND = 'fpv-airspace-pack';
/** Packs released before the rename carry this kind; both are accepted. */
export const LEGACY_MANIFEST_KIND = 'uk-drone-airspace-pack';

export const manifestSchema = z.object({
  kind: z.enum([MANIFEST_KIND, LEGACY_MANIFEST_KIND]),
  manifest_version: z.number().int(),
  schema_version: z.number().int(),
  tag: z.string().min(1),
  built_at: z.string(),
  build_commit: z.string().nullable().optional(),
  region: z.string(),
  asset: z.object({
    name: z.string(),
    url: z.string().url(),
    size_gz: z.number().int().nonnegative(),
    size_sqlite: z.number().int().nonnegative(),
    sha256_gz: z.string().regex(/^[0-9a-f]{64}$/),
    sha256_sqlite: z.string().regex(/^[0-9a-f]{64}$/),
  }),
  airac: z.object({ effective_from: z.string().nullable(), effective_to: z.string().nullable() }).optional(),
  sources: z.array(z.record(z.string(), z.unknown())).optional(),
  counts: z.record(z.string(), z.number()).optional(),
  min_server_version: z.string().optional(),
});

export type PackManifest = z.infer<typeof manifestSchema>;

export function parseManifest(json: unknown): PackManifest {
  return manifestSchema.parse(json);
}

export function isCompatible(m: PackManifest): boolean {
  return m.schema_version === SCHEMA_VERSION;
}

interface GithubRelease {
  tag_name: string;
  prerelease: boolean;
  draft: boolean;
  assets: Array<{ name: string; browser_download_url: string }>;
}

/**
 * Fetch the manifest for the latest compatible pack. Tries `manifestUrl`
 * first (normally the `releases/latest/download/manifest.json` redirect);
 * if that is missing or incompatible, walks the GitHub releases list for
 * the newest `pack-*` release whose manifest matches this schema version.
 */
export async function fetchManifest(
  http: HttpClient,
  manifestUrl: string,
  repoUrl: string,
  githubToken?: string
): Promise<PackManifest> {
  const errors: string[] = [];
  try {
    const m = await loadManifest(http, manifestUrl);
    if (isCompatible(m)) return m;
    errors.push(`manifest at ${manifestUrl} is schema v${m.schema_version}, server expects v${SCHEMA_VERSION}`);
  } catch (error) {
    errors.push(`${manifestUrl}: ${(error as Error).message}`);
  }

  const match = /github\.com\/([^/]+)\/([^/]+)/.exec(repoUrl);
  if (match) {
    const api = `https://api.github.com/repos/${match[1]}/${match[2].replace(/\.git$/, '')}/releases?per_page=20`;
    try {
      const headers: Record<string, string> = { Accept: 'application/vnd.github+json' };
      if (githubToken) headers.Authorization = `Bearer ${githubToken}`;
      const { data } = await http.getJson<GithubRelease[]>(api, { provider: 'github', headers });
      for (const rel of Array.isArray(data) ? data : []) {
        if (rel.draft || !rel.tag_name.startsWith('pack-')) continue;
        const asset = rel.assets.find((a) => a.name === 'manifest.json');
        if (!asset) continue;
        try {
          const m = await loadManifest(http, asset.browser_download_url);
          if (isCompatible(m)) return m;
        } catch (error) {
          errors.push(`${rel.tag_name}: ${(error as Error).message}`);
        }
      }
      errors.push('no compatible pack-* release found');
    } catch (error) {
      errors.push(`GitHub releases: ${(error as Error).message}`);
    }
  }
  throw new UpstreamError('pack-manifest', errors.join('; '));
}

async function loadManifest(http: HttpClient, url: string): Promise<PackManifest> {
  let json: unknown;
  if (url.startsWith('file://')) {
    json = JSON.parse(await readFile(new URL(url), 'utf8'));
  } else {
    json = (await http.getJson<unknown>(url, { provider: 'pack-manifest' })).data;
  }
  return parseManifest(json);
}
