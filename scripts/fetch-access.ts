#!/usr/bin/env tsx
import { parsePipelineArgs, type PipelineArgs, type SourceReport } from '../pipeline/lib/cli.js';
import { runArcgisLayers } from '../pipeline/sources/arcgis/runner.js';
import { NE_CROW_URL, NE_NATIONAL_PARKS_URL, NE_SSSI_URL, normaliseCrowFeature, normaliseNationalParkFeature, normaliseSssiFeature } from '../pipeline/sources/access/natural-england.js';
import { SOURCE_IDS } from '../src/pack/schema.js';

const NE_ATTRIBUTION = (what: string) => `${what}: Natural England open data, Open Government Licence v3. Contains Natural England data © Natural England, and OS data © Crown copyright and database right 2026.`;

/** Natural England access land, SSSIs and National Parks (England). */
export async function run(args: PipelineArgs): Promise<SourceReport[]> {
  const m = args.simplifyLandM;
  return runArcgisLayers(args, {
    logName: 'access',
    ndjsonFile: 'access.ndjson',
    cacheDirName: 'access',
    ttlSeconds: 7 * 86_400,
    layers: [
      { id: SOURCE_IDS.neCrowAccess, name: 'CRoW Act 2000 Access Layer (England)', url: process.env.NE_CROW_URL ?? NE_CROW_URL, licence: 'OGL-3.0', attribution: NE_ATTRIBUTION('Open access land'), notes: 'Combined open country, registered common land and dedicated land, with MoD byelaw and other excepted land removed.', normalise: (f, at) => normaliseCrowFeature(f, at, m) },
      { id: SOURCE_IDS.neSssi, name: 'Sites of Special Scientific Interest (England)', url: process.env.NE_SSSI_URL ?? NE_SSSI_URL, licence: 'OGL-3.0', attribution: NE_ATTRIBUTION('SSSI boundaries'), notes: 'Advisory: disturbing protected wildlife is an offence; no blanket drone ban.', normalise: (f, at) => normaliseSssiFeature(f, at, m) },
      { id: SOURCE_IDS.neNationalParks, name: 'National Parks (England)', url: process.env.NE_NATIONAL_PARKS_URL ?? NE_NATIONAL_PARKS_URL, licence: 'OGL-3.0', attribution: NE_ATTRIBUTION('National Park boundaries'), notes: 'Advisory: park authorities publish their own drone guidance.', normalise: (f, at) => normaliseNationalParkFeature(f, at, Math.max(m, 20)) },
    ],
  });
}

if (process.argv[1] && /fetch-access\.ts$/.test(process.argv[1])) {
  run(parsePipelineArgs(process.argv.slice(2))).catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
