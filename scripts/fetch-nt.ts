#!/usr/bin/env tsx
import { parsePipelineArgs, type PipelineArgs, type SourceReport } from '../pipeline/lib/cli.js';
import { normaliseNtFeature } from '../pipeline/sources/nt/arcgis.js';
import { runArcgisLayers } from '../pipeline/sources/arcgis/runner.js';
import { SOURCE_IDS } from '../src/pack/schema.js';

const LAYERS = [
  {
    id: SOURCE_IDS.ntAlwaysOpen,
    name: 'National Trust Open Data: Land - Always Open',
    accessClass: 'always_open' as const,
    url: process.env.NT_ALWAYS_OPEN_URL ?? 'https://services-eu1.arcgis.com/NPIbx47lsIiu2pqz/arcgis/rest/services/National_Trust_Open_Data_Land_Always_Open/FeatureServer/0',
  },
  {
    id: SOURCE_IDS.ntLimitedAccess,
    name: 'National Trust Open Data: Land - Limited Access',
    accessClass: 'limited_access' as const,
    url: process.env.NT_LIMITED_ACCESS_URL ?? 'https://services-eu1.arcgis.com/NPIbx47lsIiu2pqz/arcgis/rest/services/National_Trust_Open_Data_Land_Limited_Access/FeatureServer/0',
  },
];

export async function run(args: PipelineArgs): Promise<SourceReport[]> {
  return runArcgisLayers(args, {
    logName: 'nt',
    ndjsonFile: 'nt.ndjson',
    cacheDirName: 'nt',
    layers: LAYERS.map((layer) => ({
      id: layer.id,
      name: layer.name,
      url: layer.url,
      licence: 'OGL-3.0',
      attribution: 'National Trust land: National Trust Open Data (Open Government Licence v3). NT byelaws prohibit unauthorised aircraft take-off and landing on Trust land.',
      notes: 'Captured at ~1:50,000; not a detailed ownership boundary.',
      normalise: (f, fetchedAt) => normaliseNtFeature(f, layer.id, layer.accessClass, layer.url, fetchedAt),
    })),
  });
}

if (process.argv[1] && /fetch-nt\.ts$/.test(process.argv[1])) {
  run(parsePipelineArgs(process.argv.slice(2))).catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
