#!/usr/bin/env tsx
/**
 * Ground hazards from OpenStreetMap: railways, motorways and trunk roads, power
 * lines, helipads and military land. Shares the cached Geofabrik extract with
 * the parking source and needs `osmium`.
 */
import { execFileSync } from 'node:child_process';
import { createReadStream } from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { createBuildLog } from '../pipeline/lib/log.js';
import { parsePipelineArgs, writeReport, type PipelineArgs, type SourceReport } from '../pipeline/lib/cli.js';
import { openNdjsonWriter } from '../pipeline/lib/ndjson.js';
import { bboxIntersects } from '../pipeline/lib/regions.js';
import { bboxOfGeometry, bboxOfPositions } from '../src/pack/geometry.js';
import type { BBox } from '../src/types.js';
import type { NormalisedHazard } from '../pipeline/sources/osm/hazards.js';
import { ensurePbf, PBF_URL, requireOsmium } from '../pipeline/sources/osm/pbf.js';
import { HAZARD_FILTERS, normaliseHazardFeature } from '../pipeline/sources/osm/hazards.js';
import { SOURCE_IDS } from '../src/pack/schema.js';

function hazardBbox(g: NormalisedHazard['geometry']): BBox {
  if (g.type === 'Point') return [g.coordinates[0], g.coordinates[1], g.coordinates[0], g.coordinates[1]];
  if (g.type === 'LineString') return bboxOfPositions(g.coordinates);
  return bboxOfGeometry(g);
}

export const HAZARDS_ATTRIBUTION = 'Ground hazards (railways, motorways and trunk roads, power lines, helipads, military land): © OpenStreetMap contributors, Open Database Licence (ODbL), via the Geofabrik Great Britain extract.';

export async function run(args: PipelineArgs): Promise<SourceReport> {
  const log = createBuildLog('hazards');
  const dir = path.join(args.rawDir, 'osm');
  requireOsmium();
  const { file, fetchedAt } = await ensurePbf(dir, args.offline, log);
  const filtered = path.join(dir, 'hazards.osm.pbf');
  const geojson = path.join(dir, 'hazards.geojsonseq');
  log.info('extracting hazard features with osmium');
  execFileSync('osmium', ['tags-filter', '--overwrite', '-o', filtered, file, ...HAZARD_FILTERS], { stdio: ['ignore', 'ignore', 'inherit'] });
  execFileSync('osmium', ['export', '--overwrite', '-f', 'geojsonseq', '--add-unique-id=type_id', '-o', geojson, filtered], { stdio: ['ignore', 'ignore', 'inherit'] });

  const writer = await openNdjsonWriter(path.join(args.normalisedDir, 'hazards.ndjson'));
  const counts: Record<string, number> = {};
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
    for (const h of normaliseHazardFeature(feature, args.simplifyLandM)) {
      if (!bboxIntersects(hazardBbox(h.geometry), args.region.bbox)) continue;
      writer.write(h);
      counts[h.kind] = (counts[h.kind] ?? 0) + 1;
    }
  }
  await writer.close();
  const kept = Object.values(counts).reduce((a, b) => a + b, 0);
  log.info(`wrote ${kept} hazards (from ${seen} OSM features): ${JSON.stringify(counts)}`);
  const report: SourceReport = {
    source: {
      id: SOURCE_IDS.hazards,
      name: 'OpenStreetMap ground hazards',
      url: PBF_URL,
      licence: 'ODbL-1.0',
      attribution: HAZARDS_ATTRIBUTION,
      fetchedAt,
      effectiveFrom: null,
      effectiveTo: null,
      version: fetchedAt.slice(0, 10),
      featureCount: kept,
      notes: 'Advisory only; incomplete where OSM is incomplete (low-voltage power lines especially).',
    },
    warnings: [...log.warnings],
    extra: { counts },
  };
  await writeReport(args.reportsDir, 'hazards', report);
  return report;
}

if (process.argv[1] && /fetch-hazards\.ts$/.test(process.argv[1])) {
  run(parsePipelineArgs(process.argv.slice(2))).catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
