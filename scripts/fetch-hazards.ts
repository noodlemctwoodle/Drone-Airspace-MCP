#!/usr/bin/env tsx
/**
 * Ground hazards from OpenStreetMap: railways, motorways and trunk roads, power
 * lines and pylons, substations and generators, helipads, masts, military land,
 * and the places people gather (schools, nurseries, hospitals, fire and fuel
 * stations, parks, cemeteries). Shares the cached Geofabrik extract with the
 * parking source and needs `osmium`.
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
import { ensurePbf, OSM_EXTRACTS, PBF_URL, requireOsmium } from '../pipeline/sources/osm/pbf.js';
import { loadCountryFilter } from '../pipeline/sources/osm/country-filter.js';
import { HAZARD_FILTERS, normaliseHazardFeature } from '../pipeline/sources/osm/hazards.js';
import { SOURCE_IDS } from '../src/pack/schema.js';

function hazardBbox(g: NormalisedHazard['geometry']): BBox {
  if (g.type === 'Point') return [g.coordinates[0], g.coordinates[1], g.coordinates[0], g.coordinates[1]];
  if (g.type === 'LineString') return bboxOfPositions(g.coordinates);
  return bboxOfGeometry(g);
}

export const HAZARDS_ATTRIBUTION = 'Ground hazards (railways, major roads, power lines, pylons, substations, generators, helipads, masts, military land, schools, hospitals, fire and fuel stations, parks, cemeteries): © OpenStreetMap contributors, Open Database Licence (ODbL), via the Geofabrik Great Britain and Ireland extracts.';

export async function run(args: PipelineArgs): Promise<SourceReport> {
  const log = createBuildLog('hazards');
  const dir = path.join(args.rawDir, 'osm');
  requireOsmium();
  const inNorthernIreland = await loadCountryFilter(args.normalisedDir, 'northern_ireland');
  if (!inNorthernIreland) log.warn('no Northern Ireland boundary in coverage.ndjson (run the countries source first); skipping the Ireland extract');

  const writer = await openNdjsonWriter(path.join(args.normalisedDir, 'hazards.ndjson'));
  const counts: Record<string, number> = {};
  let seen = 0;
  let fetchedAt = new Date().toISOString();
  for (const extract of OSM_EXTRACTS) {
    const clip = extract.key === 'ie' ? inNorthernIreland : null;
    if (extract.key === 'ie' && !clip) continue;
    const pbf = await ensurePbf(dir, args.offline, log, extract);
    if (extract.key === 'gb') fetchedAt = pbf.fetchedAt;
    const filtered = path.join(dir, `hazards-${extract.key}.osm.pbf`);
    const geojson = path.join(dir, `hazards-${extract.key}.geojsonseq`);
    log.info(`extracting hazard features from ${extract.name} with osmium`);
    execFileSync('osmium', ['tags-filter', '--overwrite', '-o', filtered, pbf.file, ...HAZARD_FILTERS], { stdio: ['ignore', 'ignore', 'inherit'] });
    execFileSync('osmium', ['export', '--overwrite', '-f', 'geojsonseq', '--add-unique-id=type_id', '-o', geojson, filtered], { stdio: ['ignore', 'ignore', 'inherit'] });
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
        const bb = hazardBbox(h.geometry);
        if (!bboxIntersects(bb, args.region.bbox)) continue;
        // The Ireland extract also holds the Republic: keep a feature only when its bbox centre is in Northern Ireland.
        if (clip && !clip((bb[0] + bb[2]) / 2, (bb[1] + bb[3]) / 2)) continue;
        writer.write(h);
        counts[h.kind] = (counts[h.kind] ?? 0) + 1;
      }
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
      notes: 'Advisory only; incomplete where OSM is incomplete (low-voltage lines and small substations especially).',
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
