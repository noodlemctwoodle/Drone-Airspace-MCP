#!/usr/bin/env tsx
import path from 'node:path';
import { createBuildLog } from '../pipeline/lib/log.js';
import { parsePipelineArgs, writeReport, type PipelineArgs, type SourceReport } from '../pipeline/lib/cli.js';
import { fetchCached } from '../pipeline/lib/http.js';
import { openNdjsonWriter } from '../pipeline/lib/ndjson.js';
import { bboxIntersects } from '../pipeline/lib/regions.js';
import { geometryBbox } from '../pipeline/lib/geometry.js';
import { NI_DESIGNATION_LAYERS, normaliseNiDesignation } from '../pipeline/sources/ni/designations.js';

const NI_BBOX: [number, number, number, number] = [-8.2, 54.0, -5.3, 55.4];
const NI_ATTRIBUTION = (what: string) => `${what}: Northern Ireland Environment Agency (DAERA) open data via OpenDataNI, Open Government Licence v3. Contains public sector information licensed under the Open Government Licence v3.0.`;

/** Northern Ireland designations: ASSI, AONB and National Nature Reserves as static GeoJSON. */
export async function run(args: PipelineArgs): Promise<SourceReport[]> {
  const log = createBuildLog('ni');
  const cacheDir = path.join(args.rawDir, 'ni');
  const writer = await openNdjsonWriter(path.join(args.normalisedDir, 'ni.ndjson'));
  const reports: SourceReport[] = [];
  const inRegion = bboxIntersects(args.region.bbox, NI_BBOX);
  if (!inRegion) log.info('region does not touch Northern Ireland, skipped');
  for (const layer of NI_DESIGNATION_LAYERS) {
    const fetchedAt = new Date().toISOString();
    let count = 0;
    const warnings: string[] = [];
    if (inRegion) {
      try {
        const body = (await fetchCached(layer.url, { cacheDir, ttlSeconds: 30 * 86_400, offline: args.offline, politeGapMs: 500 })).body.toString('utf8');
        const fc = JSON.parse(body) as { features?: Array<{ geometry?: never; properties?: Record<string, unknown> }> };
        for (const f of fc.features ?? []) {
          const r = normaliseNiDesignation(f, layer, fetchedAt, args.simplifyLandM);
          if (!r || !bboxIntersects(geometryBbox(r.geometry), args.region.bbox)) continue;
          writer.write(r);
          count += 1;
        }
        log.info(`${layer.sourceId}: ${count} polygons`);
      } catch (error) {
        const msg = `${layer.sourceId} failed: ${(error as Error).message}`;
        log.warn(msg);
        warnings.push(msg);
      }
    }
    reports.push({
      source: { id: layer.sourceId, name: layer.name, url: layer.datasetUrl, licence: 'OGL-3.0', attribution: NI_ATTRIBUTION(layer.label + ' boundaries'), fetchedAt, effectiveFrom: null, effectiveTo: null, version: layer.version, featureCount: count, notes: 'Advisory designation; no blanket drone ban.' },
      warnings,
    });
  }
  await writer.close();
  await writeReport(args.reportsDir, 'ni', reports);
  return reports;
}

if (process.argv[1] && /fetch-ni\.ts$/.test(process.argv[1])) {
  run(parsePipelineArgs(process.argv.slice(2))).catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
