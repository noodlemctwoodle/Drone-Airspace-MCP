#!/usr/bin/env tsx
import path from 'node:path';
import { createBuildLog } from '../pipeline/lib/log.js';
import { parsePipelineArgs, writeReport, type PipelineArgs, type SourceReport } from '../pipeline/lib/cli.js';
import { openNdjsonWriter } from '../pipeline/lib/ndjson.js';
import { bboxIntersects } from '../pipeline/lib/regions.js';
import { geometryBbox } from '../pipeline/lib/geometry.js';
import { loadByelaws } from '../pipeline/sources/byelaws/loader.js';
import { SOURCE_IDS } from '../src/pack/schema.js';
import { REPO_URL } from '../src/version.js';

export async function run(args: PipelineArgs, seedPath = path.resolve('data/byelaws/seed.yaml')): Promise<SourceReport> {
  const log = createBuildLog('byelaws');
  const result = await loadByelaws(seedPath);
  for (const w of result.warnings) log.warn(w);
  const writer = await openNdjsonWriter(path.join(args.normalisedDir, 'byelaws.ndjson'));
  let count = 0;
  for (const r of result.restrictions) {
    if (!bboxIntersects(geometryBbox(r.geometry), args.region.bbox)) continue;
    writer.write(r);
    count += 1;
  }
  await writer.close();
  log.info(`${count} byelaw areas from ${result.validEntries} valid entries`);
  const report: SourceReport = {
    source: {
      id: SOURCE_IDS.byelaws,
      name: 'Council byelaw and PSPO seed list (community maintained)',
      url: `${REPO_URL}/blob/main/data/byelaws/seed.yaml`,
      licence: 'MIT',
      attribution: 'Council byelaws: hand-curated list maintained in the Drone-Airspace-MCP repository; incomplete, each entry cites its source and verification date.',
      fetchedAt: new Date().toISOString(),
      effectiveFrom: null,
      effectiveTo: null,
      version: null,
      featureCount: count,
      notes: `${result.validEntries} valid entries`,
    },
    warnings: [...log.warnings],
    extra: { validEntries: result.validEntries },
  };
  await writeReport(args.reportsDir, 'byelaws', report);
  return report;
}

if (process.argv[1] && /load-byelaws\.ts$/.test(process.argv[1])) {
  run(parsePipelineArgs(process.argv.slice(2))).catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
