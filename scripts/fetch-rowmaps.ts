#!/usr/bin/env tsx
import path from 'node:path';
import { createRequire } from 'node:module';
import { createBuildLog } from '../pipeline/lib/log.js';
import { parsePipelineArgs, writeReport, type PipelineArgs, type SourceReport } from '../pipeline/lib/cli.js';
import { fetchCached } from '../pipeline/lib/http.js';
import { openNdjsonWriter } from '../pipeline/lib/ndjson.js';
import { bboxIntersects } from '../pipeline/lib/regions.js';
import { bboxOfPositions } from '../src/pack/geometry.js';
import { FILE_PATH_TYPES, authorityAttribution, parseRowmapsGeojson, type Authority } from '../pipeline/sources/rowmaps/geojson-parser.js';
import { SOURCE_IDS } from '../src/pack/schema.js';

const require = createRequire(import.meta.url);
const AUTHORITIES = (require('../pipeline/sources/rowmaps/authorities.json') as { authorities: Authority[] }).authorities;
const BASE = process.env.ROWMAPS_BASE_URL ?? 'https://www.rowmaps.com/jsons';

export interface AuthorityReport {
  code: string;
  name: string;
  country: string;
  attribution: string;
  fetchedAt: string | null;
  featureCount: number;
  skipped: number;
  error?: string;
}

export function selectAuthorities(args: PipelineArgs): Authority[] {
  const sel = args.region.authorities;
  if (sel === 'all') return AUTHORITIES;
  if ((sel as unknown) === 'wales') return AUTHORITIES.filter((a) => a.country === 'wales');
  const set = new Set(sel);
  return AUTHORITIES.filter((a) => set.has(a.code));
}

export async function run(args: PipelineArgs): Promise<SourceReport> {
  const log = createBuildLog('rowmaps');
  const cacheDir = path.join(args.rawDir, 'rowmaps');
  const year = new Date().getUTCFullYear();
  const authorities = selectAuthorities(args);
  log.info(`fetching ${authorities.length} authorities`);
  const writer = await openNdjsonWriter(path.join(args.normalisedDir, 'rights_of_way.ndjson'));
  const reports: AuthorityReport[] = [];
  let total = 0;
  let latestFetch: string | null = null;
  for (const a of authorities) {
    const rep: AuthorityReport = { code: a.code, name: a.name, country: a.country, attribution: authorityAttribution(a, year), fetchedAt: null, featureCount: 0, skipped: 0 };
    for (const [num, pathType] of Object.entries(FILE_PATH_TYPES)) {
      const url = `${BASE}/${a.code}/mutated${num}.json`;
      try {
        const res = await fetchCached(url, { cacheDir, ttlSeconds: 6 * 86_400, offline: args.offline, politeGapMs: 300, retries: 2 });
        if (res.status === 404 || res.body.length === 0) continue;
        rep.fetchedAt = res.fetchedAt;
        if (!latestFetch || res.fetchedAt > latestFetch) latestFetch = res.fetchedAt;
        let json: unknown;
        try {
          json = JSON.parse(res.body.toString('utf8'));
        } catch {
          log.warn(`${a.code} mutated${num}.json is not valid JSON`);
          continue;
        }
        const parsed = parseRowmapsGeojson(json, a.code, pathType, a.name);
        rep.skipped += parsed.skipped;
        for (const p of parsed.paths) {
          if (!bboxIntersects(bboxOfPositions(p.coordinates), args.region.bbox)) continue;
          writer.write(p);
          rep.featureCount += 1;
          total += 1;
        }
      } catch (error) {
        rep.error = (error as Error).message;
        log.warn(`${a.code} ${a.name}: ${rep.error}`);
      }
    }
    reports.push(rep);
  }
  await writer.close();
  const missing = reports.filter((r) => r.featureCount === 0);
  if (missing.length > 0) log.warn(`${missing.length} authorities yielded no paths: ${missing.map((m) => m.code).join(', ')}`);
  log.info(`wrote ${total} rights of way`);
  const report: SourceReport = {
    source: {
      id: SOURCE_IDS.rowmaps,
      name: 'Public rights of way (council open data via rowmaps.com)',
      url: BASE,
      licence: 'OGL-3.0',
      attribution: `Rights of way: council open data under the Open Government Licence v3, aggregated by rowmaps.com. Contains Ordnance Survey data © Crown copyright and database right ${year}. An interpretation of each council's Definitive Map, not the Definitive Map itself. England and Wales only.`,
      fetchedAt: latestFetch ?? new Date().toISOString(),
      effectiveFrom: null,
      effectiveTo: null,
      version: latestFetch ? latestFetch.slice(0, 10) : null,
      featureCount: total,
      notes: `${reports.length} authorities requested, ${reports.length - missing.length} with data`,
    },
    warnings: [...log.warnings],
    extra: { authorities: reports },
  };
  await writeReport(args.reportsDir, 'rowmaps', report);
  return report;
}

if (process.argv[1] && /fetch-rowmaps\.ts$/.test(process.argv[1])) {
  run(parsePipelineArgs(process.argv.slice(2))).catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
