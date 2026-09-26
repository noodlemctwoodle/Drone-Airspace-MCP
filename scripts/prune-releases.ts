#!/usr/bin/env tsx
/** Keep the newest N pack-* releases (and their tags); delete the rest. Needs GITHUB_TOKEN with contents:write. */
import { parsePipelineArgs } from '../pipeline/lib/cli.js';
import { REPO_URL } from '../src/version.js';

(async () => {
  const args = parsePipelineArgs(process.argv.slice(2));
  const token = process.env.GITHUB_TOKEN;
  if (!token) throw new Error('GITHUB_TOKEN required');
  const m = /github\.com\/([^/]+)\/([^/]+)/.exec(REPO_URL)!;
  const api = `https://api.github.com/repos/${m[1]}/${m[2]}`;
  const headers = { Accept: 'application/vnd.github+json', Authorization: `Bearer ${token}`, 'User-Agent': 'fpv-airspace-pack-builder' };
  const releases = (await (await fetch(`${api}/releases?per_page=100`, { headers })).json()) as Array<{ id: number; tag_name: string; draft: boolean }>;
  const packs = releases.filter((r) => !r.draft && r.tag_name.startsWith(args.prefix)).sort((a, b) => b.tag_name.localeCompare(a.tag_name));
  for (const r of packs.slice(args.keep)) {
    console.error(`[prune-releases] deleting ${r.tag_name}`);
    await fetch(`${api}/releases/${r.id}`, { method: 'DELETE', headers });
    await fetch(`${api}/git/refs/tags/${r.tag_name}`, { method: 'DELETE', headers });
  }
  console.error(`[prune-releases] kept ${Math.min(args.keep, packs.length)} of ${packs.length}`);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
