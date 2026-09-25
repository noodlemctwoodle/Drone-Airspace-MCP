import { spawnSync } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { BUILD_USER_AGENT } from '../../lib/http.js';
import { createBuildLog } from '../../lib/log.js';

/** The Geofabrik Great Britain extract, shared by every OpenStreetMap source and cached for a week. */
export const PBF_URL = process.env.OSM_PBF_URL ?? 'https://download.geofabrik.de/europe/great-britain-latest.osm.pbf';
const PBF_MAX_AGE_DAYS = Number(process.env.OSM_PBF_MAX_AGE_DAYS ?? 7);

export function requireOsmium(): void {
  const osmium = spawnSync('osmium', ['--version'], { encoding: 'utf8' });
  if (osmium.status !== 0) throw new Error('osmium not found; install osmium-tool');
}

export async function ensurePbf(dir: string, offline: boolean, log = createBuildLog('osm')): Promise<{ file: string; fetchedAt: string }> {
  await mkdir(dir, { recursive: true });
  const file = path.join(dir, 'great-britain-latest.osm.pbf');
  const metaFile = `${file}.meta.json`;
  try {
    const meta = JSON.parse(await readFile(metaFile, 'utf8')) as { fetchedAt: string };
    const ageDays = (Date.now() - new Date(meta.fetchedAt).getTime()) / 86_400_000;
    if ((await stat(file)).size > 100_000_000 && (offline || ageDays < PBF_MAX_AGE_DAYS)) return { file, fetchedAt: meta.fetchedAt };
  } catch {
    // no usable cache
  }
  if (offline) throw new Error(`offline and no cached ${file}`);
  log.info(`downloading ${PBF_URL}`);
  const res = await fetch(PBF_URL, { headers: { 'User-Agent': BUILD_USER_AGENT } });
  if (!res.ok || !res.body) throw new Error(`HTTP ${res.status} for ${PBF_URL}`);
  const part = `${file}.part`;
  await pipeline(Readable.fromWeb(res.body as never), createWriteStream(part));
  await rename(part, file);
  const fetchedAt = new Date().toISOString();
  await writeFile(metaFile, JSON.stringify({ fetchedAt, url: PBF_URL }));
  return { file, fetchedAt };
}
