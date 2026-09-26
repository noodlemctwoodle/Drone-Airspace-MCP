#!/usr/bin/env tsx
import path from 'node:path';
import { createBuildLog } from '../pipeline/lib/log.js';
import { parsePipelineArgs, writeReport, type PipelineArgs, type SourceReport } from '../pipeline/lib/cli.js';
import { fetchCached } from '../pipeline/lib/http.js';
import { openNdjsonWriter } from '../pipeline/lib/ndjson.js';
import { bboxIntersects } from '../pipeline/lib/regions.js';
import { bboxOfPositions } from '../src/pack/geometry.js';
import { fetchAllFeatures, layerInfo } from '../pipeline/sources/nt/arcgis.js';
import { NI_PROW_AUTHORITIES, normaliseNiProwFeature } from '../pipeline/sources/ni/prow.js';
import type { AuthorityReport } from './fetch-rowmaps.js';
import { SOURCE_IDS } from '../src/pack/schema.js';

const NI_BBOX: [number, number, number, number] = [-8.2, 54.0, -5.3, 55.4];

/** Asserted public rights of way published by Northern Ireland councils (Mid Ulster so far). */
export async function run(args: PipelineArgs): Promise<SourceReport> {
  const log = createBuildLog('niprow');
  const year = new Date().getUTCFullYear();
  const writer = await openNdjsonWriter(path.join(args.normalisedDir, 'ni_prow.ndjson'));
  const authorities: AuthorityReport[] = [];
  const warnings: string[] = [];
  const fetchedAt = new Date().toISOString();
  let count = 0;
  let version: string | null = null;
  if (!bboxIntersects(args.region.bbox, NI_BBOX)) log.info('region does not touch Northern Ireland, skipped');
  else {
    const cacheDir = path.join(args.rawDir, 'niprow');
    const fetchText = async (u: string) => (await fetchCached(u, { cacheDir, ttlSeconds: 7 * 86_400, offline: args.offline, politeGapMs: 200 })).body.toString('utf8');
    for (const a of NI_PROW_AUTHORITIES) {
      const rep: AuthorityReport = {
        code: a.code, name: a.name, country: 'northern_ireland',
        attribution: `Public rights of way: ${a.name} open data, Open Government Licence v3. Contains OS data © Crown copyright and database right ${year}.`,
        fetchedAt, featureCount: 0, skipped: 0,
      };
      try {
        const info = await layerInfo(a.url, fetchText);
        const edit = info.editingInfo?.dataLastEditDate ?? info.editingInfo?.lastEditDate;
        if (edit) version = new Date(edit).toISOString().slice(0, 10);
        for await (const f of fetchAllFeatures(a.url, { fetchText, bbox: args.region.name === 'national' ? undefined : args.region.bbox })) {
          for (const p of normaliseNiProwFeature(f, a.code)) {
            if (!bboxIntersects(bboxOfPositions(p.coordinates), args.region.bbox)) continue;
            writer.write(p);
            count += 1;
            rep.featureCount += 1;
          }
        }
        log.info(`${a.name}: ${rep.featureCount} paths`);
      } catch (error) {
        const msg = `${a.name} failed: ${(error as Error).message}`;
        log.warn(msg);
        warnings.push(msg);
        rep.error = msg;
      }
      authorities.push(rep);
    }
  }
  await writer.close();
  const report: SourceReport = {
    source: {
      id: SOURCE_IDS.niProw,
      name: 'Northern Ireland council public rights of way',
      url: NI_PROW_AUTHORITIES[0].url,
      licence: 'OGL-3.0',
      attribution: 'Public rights of way (Northern Ireland): council open data under the Open Government Licence v3; attribution per council is carried on each path.',
      fetchedAt,
      effectiveFrom: null,
      effectiveTo: null,
      version,
      featureCount: count,
      notes: 'Asserted rights of way from the councils that publish them; absence means unknown, not none.',
    },
    warnings,
    extra: { authorities },
  };
  await writeReport(args.reportsDir, 'niprow', report);
  return report;
}

if (process.argv[1] && /fetch-ni-prow\.ts$/.test(process.argv[1])) {
  run(parsePipelineArgs(process.argv.slice(2))).catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
