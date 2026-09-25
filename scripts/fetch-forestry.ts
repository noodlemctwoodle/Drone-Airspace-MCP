#!/usr/bin/env tsx
import { parsePipelineArgs, type PipelineArgs, type SourceReport } from '../pipeline/lib/cli.js';
import { runArcgisLayers } from '../pipeline/sources/arcgis/runner.js';
import { FE_ATTRIBUTION, FE_LEGAL_BOUNDARY_URL, normaliseForestryFeature } from '../pipeline/sources/forestry/legal-boundary.js';
import { SOURCE_IDS } from '../src/pack/schema.js';

/** Forestry England legal boundary: take-off banned without a permit. */
export async function run(args: PipelineArgs): Promise<SourceReport[]> {
  return runArcgisLayers(args, {
    logName: 'forestry',
    ndjsonFile: 'forestry.ndjson',
    cacheDirName: 'forestry',
    ttlSeconds: 30 * 86_400,
    layers: [
      { id: SOURCE_IDS.forestryEngland, name: 'Forestry England Legal Boundary', url: process.env.FE_LEGAL_BOUNDARY_URL ?? FE_LEGAL_BOUNDARY_URL, licence: 'OGL-3.0', attribution: FE_ATTRIBUTION, notes: 'Seven cost-centre multipolygons split into parts; no site names in the data.', normalise: (f, at) => normaliseForestryFeature(f, at, args.simplifyLandM) },
    ],
  });
}

if (process.argv[1] && /fetch-forestry\.ts$/.test(process.argv[1])) {
  run(parsePipelineArgs(process.argv.slice(2))).catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
