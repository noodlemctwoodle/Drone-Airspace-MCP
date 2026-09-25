#!/usr/bin/env tsx
import path from 'node:path';
import { createBuildLog } from '../pipeline/lib/log.js';
import { parsePipelineArgs, writeReport, type PipelineArgs, type SourceReport } from '../pipeline/lib/cli.js';
import { fetchCached } from '../pipeline/lib/http.js';
import { openNdjsonWriter } from '../pipeline/lib/ndjson.js';
import { bboxIntersects } from '../pipeline/lib/regions.js';
import { geometryBbox } from '../pipeline/lib/geometry.js';
import { fetchAllFeatures, layerInfo } from '../pipeline/sources/nt/arcgis.js';
import { ONS_LAD_URL, parseLadFeature } from '../pipeline/sources/lad/ons.js';
import { SOURCE_IDS } from '../src/pack/schema.js';

/** Local authority district boundaries: the frame for council-wide policy notes in the byelaw seed. */
export async function run(args: PipelineArgs): Promise<SourceReport> {
  const log = createBuildLog('lad');
  const url = process.env.ONS_LAD_URL ?? ONS_LAD_URL;
  const cacheDir = path.join(args.rawDir, 'lad');
  const fetchText = async (u: string) => (await fetchCached(u, { cacheDir, ttlSeconds: 30 * 86_400, offline: args.offline, politeGapMs: 200 })).body.toString('utf8');
  const writer = await openNdjsonWriter(path.join(args.normalisedDir, 'admin_areas.ndjson'));
  let count = 0;
  let version: string | null = null;
  const fetchedAt = new Date().toISOString();
  try {
    const info = await layerInfo(url, fetchText);
    const edit = info.editingInfo?.dataLastEditDate ?? info.editingInfo?.lastEditDate;
    version = edit ? new Date(edit).toISOString().slice(0, 10) : null;
    // Boundaries are never clipped to the region bbox: a council whose edge crosses it still applies to points inside.
    for await (const f of fetchAllFeatures(url, { fetchText })) {
      const a = parseLadFeature(f);
      if (!a || !bboxIntersects(geometryBbox(a.geometry), args.region.bbox)) continue;
      writer.write(a);
      count += 1;
    }
    log.info(`${count} local authority districts`);
  } catch (error) {
    log.warn(`local authority layer failed: ${(error as Error).message}; council policies will not resolve`);
  }
  await writer.close();
  const report: SourceReport = {
    source: {
      id: SOURCE_IDS.lad,
      name: 'ONS Local Authority Districts (May 2026) Boundaries UK BSC',
      url,
      licence: 'OGL-3.0',
      attribution: 'Local authority boundaries: Office for National Statistics licensed under the Open Government Licence v3. Contains OS data © Crown copyright and database right 2026.',
      fetchedAt,
      effectiveFrom: null,
      effectiveTo: null,
      version,
      featureCount: count,
      notes: 'Super-generalised (about 200 m); used to name the council at a point and to carry council-wide policy notes from the byelaw seed.',
    },
    warnings: [...log.warnings],
  };
  await writeReport(args.reportsDir, 'lad', report);
  return report;
}

if (process.argv[1] && /fetch-lad\.ts$/.test(process.argv[1])) {
  run(parsePipelineArgs(process.argv.slice(2))).catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
