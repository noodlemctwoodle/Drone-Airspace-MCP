#!/usr/bin/env tsx
import path from 'node:path';
import { createBuildLog } from '../pipeline/lib/log.js';
import { parsePipelineArgs, writeReport, type PipelineArgs, type SourceReport } from '../pipeline/lib/cli.js';
import { fetchCached } from '../pipeline/lib/http.js';
import { openNdjsonWriter } from '../pipeline/lib/ndjson.js';
import { bboxIntersects } from '../pipeline/lib/regions.js';
import { geometryBbox } from '../pipeline/lib/geometry.js';
import { fetchAllFeatures, layerInfo, normaliseNtFeature } from '../pipeline/sources/nt/arcgis.js';
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
  const log = createBuildLog('national-trust');
  const cacheDir = path.join(args.rawDir, 'nt');
  const writer = await openNdjsonWriter(path.join(args.normalisedDir, 'nt.ndjson'));
  const reports: SourceReport[] = [];
  const fetchText = async (url: string) => (await fetchCached(url, { cacheDir, ttlSeconds: 86_400, offline: args.offline, politeGapMs: 200 })).body.toString('utf8');
  for (const layer of LAYERS) {
    const fetchedAt = new Date().toISOString();
    let count = 0;
    let version: string | null = null;
    const warnings: string[] = [];
    try {
      const info = await layerInfo(layer.url, fetchText);
      const edit = info.editingInfo?.dataLastEditDate ?? info.editingInfo?.lastEditDate;
      version = edit ? new Date(edit).toISOString().slice(0, 10) : null;
      for await (const f of fetchAllFeatures(layer.url, { fetchText, bbox: args.region.name === 'national' ? undefined : args.region.bbox })) {
        const r = normaliseNtFeature(f, layer.id, layer.accessClass, layer.url, fetchedAt);
        if (!r) continue;
        if (!bboxIntersects(geometryBbox(r.geometry), args.region.bbox)) continue;
        writer.write(r);
        count += 1;
      }
      log.info(`${layer.id}: ${count} polygons`);
    } catch (error) {
      const msg = `${layer.id} failed: ${(error as Error).message}`;
      log.warn(msg);
      warnings.push(msg);
    }
    reports.push({
      source: {
        id: layer.id,
        name: layer.name,
        url: layer.url,
        licence: 'OGL-3.0',
        attribution: 'National Trust land: National Trust Open Data (Open Government Licence v3). NT byelaws prohibit unauthorised aircraft take-off and landing on Trust land.',
        fetchedAt,
        effectiveFrom: null,
        effectiveTo: null,
        version,
        featureCount: count,
        notes: 'Captured at ~1:50,000; not a detailed ownership boundary.',
      },
      warnings,
    });
  }
  await writer.close();
  await writeReport(args.reportsDir, 'nt', reports);
  return reports;
}

if (process.argv[1] && /fetch-nt\.ts$/.test(process.argv[1])) {
  run(parsePipelineArgs(process.argv.slice(2))).catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
