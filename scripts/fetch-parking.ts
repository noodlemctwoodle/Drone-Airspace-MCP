#!/usr/bin/env tsx
/**
 * Car parks, laybys and rest areas from OpenStreetMap (Geofabrik Great Britain extract).
 * Needs `osmium` (apt: osmium-tool, brew: osmium-tool). The PBF is cached for a week.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import readline from 'node:readline';
import { createReadStream } from 'node:fs';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { createBuildLog } from '../pipeline/lib/log.js';
import { parsePipelineArgs, writeReport, type PipelineArgs, type SourceReport } from '../pipeline/lib/cli.js';
import { BUILD_USER_AGENT } from '../pipeline/lib/http.js';
import { openNdjsonWriter } from '../pipeline/lib/ndjson.js';
import { normaliseParkingFeature } from '../pipeline/sources/osm/parking.js';
import { SOURCE_IDS } from '../src/pack/schema.js';

const PBF_URL = process.env.OSM_PBF_URL ?? 'https://download.geofabrik.de/europe/great-britain-latest.osm.pbf';
const PBF_MAX_AGE_DAYS = Number(process.env.OSM_PBF_MAX_AGE_DAYS ?? 7);
export const OSM_ATTRIBUTION = 'Parking and laybys: © OpenStreetMap contributors, Open Database Licence (ODbL), via the Geofabrik Great Britain extract.';

async function ensurePbf(dir: string, offline: boolean, log = createBuildLog('parking')): Promise<{ file: string; fetchedAt: string }> {
  await mkdir(dir, { recursive: true });
  const file = path.join(dir, 'great-britain-latest.osm.pbf');
  const metaFile = `${file}.meta.json`;
  let meta: { fetchedAt: string } | undefined;
  try {
    meta = JSON.parse(await readFile(metaFile, 'utf8'));
    const ageDays = (Date.now() - new Date(meta!.fetchedAt).getTime()) / 86_400_000;
    if ((await stat(file)).size > 100_000_000 && (offline || ageDays < PBF_MAX_AGE_DAYS)) return { file, fetchedAt: meta!.fetchedAt };
  } catch {
    meta = undefined;
  }
  if (offline) throw new Error(`offline and no cached ${file}`);
  log.info(`downloading ${PBF_URL}`);
  const res = await fetch(PBF_URL, { headers: { 'User-Agent': BUILD_USER_AGENT } });
  if (!res.ok || !res.body) throw new Error(`HTTP ${res.status} for ${PBF_URL}`);
  const part = `${file}.part`;
  await pipeline(Readable.fromWeb(res.body as never), createWriteStream(part));
  const { rename } = await import('node:fs/promises');
  await rename(part, file);
  const fetchedAt = new Date().toISOString();
  await writeFile(metaFile, JSON.stringify({ fetchedAt, url: PBF_URL }));
  return { file, fetchedAt };
}

export async function run(args: PipelineArgs): Promise<SourceReport> {
  const log = createBuildLog('parking');
  const dir = path.join(args.rawDir, 'osm');
  const osmium = spawnSync('osmium', ['--version'], { encoding: 'utf8' });
  if (osmium.status !== 0) throw new Error('osmium not found; install osmium-tool');
  const { file, fetchedAt } = await ensurePbf(dir, args.offline, log);

  const filtered = path.join(dir, 'parking.osm.pbf');
  const geojson = path.join(dir, 'parking.geojsonseq');
  log.info('extracting parking features with osmium');
  execFileSync('osmium', ['tags-filter', '--overwrite', '-o', filtered, file, 'nwr/amenity=parking', 'nwr/highway=rest_area'], { stdio: ['ignore', 'ignore', 'inherit'] });
  execFileSync('osmium', ['export', '--overwrite', '-f', 'geojsonseq', '--add-unique-id=type_id', '-o', geojson, filtered], { stdio: ['ignore', 'ignore', 'inherit'] });

  const writer = await openNdjsonWriter(path.join(args.normalisedDir, 'parking.ndjson'));
  const [w, s, e, n] = args.region.bbox;
  let kept = 0;
  let seen = 0;
  const rl = readline.createInterface({ input: createReadStream(geojson, { encoding: 'utf8' }), crlfDelay: Infinity });
  for await (const raw of rl) {
    const line = raw.replace(/^\u001e/, '').trim();
    if (!line) continue;
    seen += 1;
    let feature: { geometry?: never; properties?: Record<string, unknown> };
    try {
      feature = JSON.parse(line);
    } catch {
      continue;
    }
    const p = normaliseParkingFeature(feature);
    if (!p) continue;
    if (p.lon < w || p.lon > e || p.lat < s || p.lat > n) continue;
    writer.write(p);
    kept += 1;
  }
  await writer.close();
  log.info(`wrote ${kept} parking features (from ${seen} OSM features)`);
  const report: SourceReport = {
    source: {
      id: SOURCE_IDS.parking,
      name: 'OpenStreetMap car parks, laybys and rest areas',
      url: PBF_URL,
      licence: 'ODbL-1.0',
      attribution: OSM_ATTRIBUTION,
      fetchedAt,
      effectiveFrom: null,
      effectiveTo: null,
      version: fetchedAt.slice(0, 10),
      featureCount: kept,
      notes: 'amenity=parking and highway=rest_area; private access excluded from results by default',
    },
    warnings: [...log.warnings],
  };
  await writeReport(args.reportsDir, 'parking', report);
  return report;
}

if (process.argv[1] && /fetch-parking\.ts$/.test(process.argv[1])) {
  run(parsePipelineArgs(process.argv.slice(2))).catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
