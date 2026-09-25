#!/usr/bin/env tsx
/**
 * Car parks, laybys and rest areas from OpenStreetMap (Geofabrik Great Britain extract).
 * Needs `osmium` (apt: osmium-tool, brew: osmium-tool). The PBF is cached for a week.
 */
import { execFileSync } from 'node:child_process';
import { createReadStream } from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { createBuildLog } from '../pipeline/lib/log.js';
import { parsePipelineArgs, writeReport, type PipelineArgs, type SourceReport } from '../pipeline/lib/cli.js';
import { openNdjsonWriter } from '../pipeline/lib/ndjson.js';
import { ensurePbf, PBF_URL, requireOsmium } from '../pipeline/sources/osm/pbf.js';
import { normaliseParkingFeature } from '../pipeline/sources/osm/parking.js';
import { SOURCE_IDS } from '../src/pack/schema.js';

export const OSM_ATTRIBUTION = 'Parking and laybys: © OpenStreetMap contributors, Open Database Licence (ODbL), via the Geofabrik Great Britain extract.';

export async function run(args: PipelineArgs): Promise<SourceReport> {
  const log = createBuildLog('parking');
  const dir = path.join(args.rawDir, 'osm');
  requireOsmium();
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
