#!/usr/bin/env tsx
/**
 * Decide whether a new pack should be built. Writes should_build / airac_date /
 * reason to $GITHUB_OUTPUT when present, and prints a JSON summary.
 */
import { appendFile } from 'node:fs/promises';
import { execSync } from 'node:child_process';
import { parsePipelineArgs } from '../pipeline/lib/cli.js';
import { fetchCached } from '../pipeline/lib/http.js';
import { resolveNatsDataset } from './fetch-nats.js';
import { REPO_URL } from '../src/version.js';

interface Release {
  tag_name: string;
  published_at: string;
  draft: boolean;
  assets: Array<{ name: string; browser_download_url: string }>;
}

async function latestPackRelease(): Promise<{ tag: string; date: string; publishedAt: string; manifest: Record<string, unknown> | null } | null> {
  const m = /github\.com\/([^/]+)\/([^/]+)/.exec(REPO_URL);
  if (!m) return null;
  const headers: Record<string, string> = { Accept: 'application/vnd.github+json', 'User-Agent': 'fpv-airspace-pack-builder' };
  if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  const res = await fetch(`https://api.github.com/repos/${m[1]}/${m[2]}/releases?per_page=30`, { headers });
  if (!res.ok) return null;
  const releases = (await res.json()) as Release[];
  const packs = releases.filter((r) => !r.draft && r.tag_name.startsWith('pack-')).sort((a, b) => b.tag_name.localeCompare(a.tag_name));
  const latest = packs[0];
  if (!latest) return null;
  const date = /^pack-(\d{8})/.exec(latest.tag_name)?.[1] ?? '00000000';
  let manifest: Record<string, unknown> | null = null;
  const asset = latest.assets.find((a) => a.name === 'manifest.json');
  if (asset) {
    try {
      manifest = (await (await fetch(asset.browser_download_url, { headers: { 'User-Agent': headers['User-Agent'] } })).json()) as Record<string, unknown>;
    } catch {
      manifest = null;
    }
  }
  return { tag: latest.tag_name, date, publishedAt: latest.published_at, manifest };
}

/** ArcGIS layers whose edit date is compared with the source version recorded in the manifest. */
const UPSTREAM_ARCGIS: Array<{ sourceId: string; layerUrl: string; label: string }> = [
  { sourceId: 'nt_always_open', layerUrl: 'https://services-eu1.arcgis.com/NPIbx47lsIiu2pqz/arcgis/rest/services/National_Trust_Open_Data_Land_Always_Open/FeatureServer/0', label: 'National Trust layer' },
  { sourceId: 'ne_crow_access', layerUrl: 'https://services.arcgis.com/JJzESW51TqeY9uat/arcgis/rest/services/CRoW_Act_2000_Access_Layer/FeatureServer/0', label: 'Natural England access land' },
  { sourceId: 'ne_sssi', layerUrl: 'https://services.arcgis.com/JJzESW51TqeY9uat/arcgis/rest/services/SSSI_England/FeatureServer/0', label: 'Natural England SSSI layer' },
  { sourceId: 'fe_legal_boundary', layerUrl: 'https://services2.arcgis.com/mHXjwgl3OARRqqD4/arcgis/rest/services/Forestry_England_Legal_Boundary_2024/FeatureServer/0', label: 'Forestry England boundary' },
  { sourceId: 'ons_lad', layerUrl: 'https://services1.arcgis.com/ESMARspQHYMw9BZ9/arcgis/rest/services/Local_Authority_Districts_May_2026_Boundaries_UK_BSC/FeatureServer/0', label: 'ONS local authority boundaries' },
];

async function layerLastEdit(layerUrl: string): Promise<string | null> {
  try {
    const res = await fetchCached(`${layerUrl}?f=json`, { cacheDir: 'build/raw/upstream', ttlSeconds: 3600, offline: false });
    const info = JSON.parse(res.body.toString('utf8')) as { editingInfo?: { dataLastEditDate?: number; lastEditDate?: number } };
    const edit = info.editingInfo?.dataLastEditDate ?? info.editingInfo?.lastEditDate;
    return edit ? new Date(edit).toISOString().slice(0, 10) : null;
  } catch {
    return null;
  }
}

function changedSince(commit: string | null): boolean {
  if (!commit) return false;
  try {
    const out = execSync(`git diff --quiet ${commit} HEAD -- data/byelaws pipeline scripts src/pack/schema.ts || echo changed`, { stdio: ['ignore', 'pipe', 'ignore'] }).toString();
    return out.includes('changed');
  } catch {
    return false;
  }
}

(async () => {
  const args = parsePipelineArgs(process.argv.slice(2));
  const reasons: string[] = [];
  const latest = await latestPackRelease();
  const nats = await resolveNatsDataset(args);
  if (!latest) reasons.push('no pack release exists yet');
  else {
    if (nats.date > latest.date) reasons.push(`new AIRAC dataset ${nats.date} (latest pack ${latest.date})`);
    const ageDays = (Date.now() - new Date(latest.publishedAt).getTime()) / 86_400_000;
    if (new Date().getUTCDay() === 6 && ageDays > 6) reasons.push(`weekly rights-of-way refresh (pack is ${ageDays.toFixed(0)} days old)`);
    const sources = (latest.manifest?.sources as Array<{ id: string; version: string | null }> | undefined) ?? [];
    for (const u of UPSTREAM_ARCGIS) {
      const edited = await layerLastEdit(u.layerUrl);
      const version = sources.find((s) => s.id === u.sourceId)?.version ?? null;
      if (edited && version && edited > version) reasons.push(`${u.label} edited ${edited}`);
    }
    if (changedSince((latest.manifest?.build_commit as string | null) ?? null)) reasons.push('pipeline or byelaw data changed since the last pack');
  }
  const shouldBuild = reasons.length > 0;
  const summary = { should_build: shouldBuild, airac_date: nats.date, latest_tag: latest?.tag ?? null, reason: reasons.join('; ') || 'up to date' };
  console.log(JSON.stringify(summary, null, 2));
  if (process.env.GITHUB_OUTPUT) {
    await appendFile(process.env.GITHUB_OUTPUT, `should_build=${shouldBuild}\nairac_date=${nats.date}\nreason=${summary.reason}\n`);
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
