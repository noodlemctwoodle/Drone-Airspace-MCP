import path from 'node:path';
import { createBuildLog } from '../../lib/log.js';
import { writeReport, type PipelineArgs, type SourceReport } from '../../lib/cli.js';
import { fetchCached } from '../../lib/http.js';
import { openNdjsonWriter } from '../../lib/ndjson.js';
import { bboxIntersects } from '../../lib/regions.js';
import { geometryBbox } from '../../lib/geometry.js';
import { fetchAllFeatures, layerInfo, type ArcgisFeature, type NormalisedRestriction } from '../nt/arcgis.js';

/** One ArcGIS FeatureServer layer that becomes rows of `land_restrictions`. */
export interface ArcgisLayer {
  id: string;
  name: string;
  url: string;
  licence: string;
  attribution: string;
  notes: string | null;
  normalise: (feature: ArcgisFeature, fetchedAt: string) => NormalisedRestriction | undefined;
}

export interface ArcgisRunOptions {
  /** Log prefix and report file name. */
  logName: string;
  ndjsonFile: string;
  cacheDirName: string;
  layers: ArcgisLayer[];
  ttlSeconds?: number;
}

/**
 * Fetch every layer, page by page, into one NDJSON file and return a
 * SourceReport per layer. The layer's `dataLastEditDate` becomes the source
 * version so check-upstream can rebuild when the publisher edits the layer.
 * A layer that fails is reported with a warning and zero features; the others
 * still run.
 */
export async function runArcgisLayers(args: PipelineArgs, opts: ArcgisRunOptions): Promise<SourceReport[]> {
  const log = createBuildLog(opts.logName);
  const cacheDir = path.join(args.rawDir, opts.cacheDirName);
  const writer = await openNdjsonWriter(path.join(args.normalisedDir, opts.ndjsonFile));
  const reports: SourceReport[] = [];
  const fetchText = async (url: string) => (await fetchCached(url, { cacheDir, ttlSeconds: opts.ttlSeconds ?? 86_400, offline: args.offline, politeGapMs: 200 })).body.toString('utf8');
  for (const layer of opts.layers) {
    const fetchedAt = new Date().toISOString();
    let count = 0;
    let version: string | null = null;
    const warnings: string[] = [];
    try {
      const info = await layerInfo(layer.url, fetchText);
      const edit = info.editingInfo?.dataLastEditDate ?? info.editingInfo?.lastEditDate;
      version = edit ? new Date(edit).toISOString().slice(0, 10) : null;
      for await (const f of fetchAllFeatures(layer.url, { fetchText, bbox: args.region.name === 'national' ? undefined : args.region.bbox })) {
        const r = layer.normalise(f, fetchedAt);
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
      source: { id: layer.id, name: layer.name, url: layer.url, licence: layer.licence, attribution: layer.attribution, fetchedAt, effectiveFrom: null, effectiveTo: null, version, featureCount: count, notes: layer.notes },
      warnings,
    });
  }
  await writer.close();
  await writeReport(args.reportsDir, opts.logName, reports);
  return reports;
}
