#!/usr/bin/env tsx
import path from 'node:path';
import { createBuildLog } from '../pipeline/lib/log.js';
import { parsePipelineArgs, writeReport, type PipelineArgs, type SourceReport } from '../pipeline/lib/cli.js';
import { fetchCached } from '../pipeline/lib/http.js';
import { openNdjsonWriter } from '../pipeline/lib/ndjson.js';
import { bboxIntersects } from '../pipeline/lib/regions.js';
import { bboxOfPositions } from '../src/pack/geometry.js';
import { fetchAllWfsFeatures } from '../pipeline/sources/wfs/geojson.js';
import { SPATIALHUB_TYPENAME, SPATIALHUB_WFS_URL, normaliseCorePathFeature } from '../pipeline/sources/corepaths/spatialhub.js';
import type { AuthorityReport } from './fetch-rowmaps.js';
import { SOURCE_IDS } from '../src/pack/schema.js';

const SCOTLAND_BBOX: [number, number, number, number] = [-8.7, 54.6, -0.7, 61];

/**
 * Scottish core paths. Needs SPATIALHUB_AUTHKEY (a free Spatial Hub account);
 * without it the source is reported with zero features and a warning so the
 * pack still builds and the server keeps its "no data" caveat for Scotland.
 */
export async function run(args: PipelineArgs): Promise<SourceReport> {
  const log = createBuildLog('corepaths');
  const key = process.env.SPATIALHUB_AUTHKEY?.trim();
  const base = process.env.SPATIALHUB_WFS_URL ?? SPATIALHUB_WFS_URL;
  const typeName = process.env.SPATIALHUB_TYPENAME ?? SPATIALHUB_TYPENAME;
  const year = new Date().getUTCFullYear();
  const writer = await openNdjsonWriter(path.join(args.normalisedDir, 'core_paths.ndjson'));
  const authorities = new Map<string, AuthorityReport>();
  const fetchedAt = new Date().toISOString();
  let count = 0;
  const warnings: string[] = [];
  if (!bboxIntersects(args.region.bbox, SCOTLAND_BBOX)) log.info('region does not touch Scotland, skipped');
  else if (!key) {
    const msg = 'SPATIALHUB_AUTHKEY not set; Scottish core paths skipped';
    log.warn(msg);
    warnings.push(msg);
  } else {
    const cacheDir = path.join(args.rawDir, 'corepaths');
    const fetchText = async (u: string) => (await fetchCached(u, { cacheDir, ttlSeconds: 7 * 86_400, offline: args.offline, politeGapMs: 300 })).body.toString('utf8');
    try {
      for await (const f of fetchAllWfsFeatures(base, typeName, { fetchText, pageSize: 2000, bbox: args.region.name === 'national' ? undefined : args.region.bbox, extra: { authkey: key } })) {
        for (const p of normaliseCorePathFeature(f)) {
          if (!bboxIntersects(bboxOfPositions(p.coordinates), args.region.bbox)) continue;
          const { authorityName, ...row } = p;
          writer.write(row);
          count += 1;
          const rep = authorities.get(row.authorityCode) ?? {
            code: row.authorityCode,
            name: authorityName,
            country: 'scotland',
            attribution: `Core paths: ${authorityName} core path plan via the Improvement Service Spatial Hub, Open Government Licence v3. Contains OS data © Crown copyright and database right ${year}.`,
            fetchedAt,
            featureCount: 0,
            skipped: 0,
          };
          rep.featureCount += 1;
          authorities.set(row.authorityCode, rep);
        }
      }
      log.info(`wrote ${count} core paths for ${authorities.size} authorities`);
    } catch (error) {
      const msg = `core paths failed: ${(error as Error).message}`;
      log.warn(msg);
      warnings.push(msg);
    }
  }
  await writer.close();
  const report: SourceReport = {
    source: {
      id: SOURCE_IDS.corePaths,
      name: 'Core Paths - Scotland (Improvement Service Spatial Hub)',
      url: 'https://data.spatialhub.scot/dataset/core_paths-is',
      licence: 'OGL-3.0',
      attribution: `Core paths: Scottish council core path plans via the Improvement Service Spatial Hub, Open Government Licence v3. Contains OS data © Crown copyright and database right ${year}.`,
      fetchedAt,
      effectiveFrom: null,
      effectiveTo: null,
      version: null,
      featureCount: count,
      notes: 'Core paths under the Land Reform (Scotland) Act 2003; responsible access rights apply to most land, not only paths.',
    },
    warnings,
    extra: { authorities: [...authorities.values()] },
  };
  await writeReport(args.reportsDir, 'corepaths', report);
  return report;
}

if (process.argv[1] && /fetch-corepaths\.ts$/.test(process.argv[1])) {
  run(parsePipelineArgs(process.argv.slice(2))).catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
