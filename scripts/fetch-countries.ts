#!/usr/bin/env tsx
import path from 'node:path';
import { createBuildLog } from '../pipeline/lib/log.js';
import { parsePipelineArgs, writeReport, type PipelineArgs, type SourceReport } from '../pipeline/lib/cli.js';
import { fetchCached } from '../pipeline/lib/http.js';
import { openNdjsonWriter } from '../pipeline/lib/ndjson.js';
import { ONS_COUNTRIES_URL, parseCountries } from '../pipeline/sources/countries/ons.js';
import { SOURCE_IDS } from '../src/pack/schema.js';

export async function run(args: PipelineArgs): Promise<SourceReport> {
  const log = createBuildLog('countries');
  const url = process.env.ONS_COUNTRIES_URL ?? ONS_COUNTRIES_URL;
  const writer = await openNdjsonWriter(path.join(args.normalisedDir, 'coverage.ndjson'));
  let count = 0;
  let fetchedAt = new Date().toISOString();
  try {
    const res = await fetchCached(url, { cacheDir: path.join(args.rawDir, 'countries'), ttlSeconds: 30 * 86_400, offline: args.offline });
    fetchedAt = res.fetchedAt;
    for (const c of parseCountries(JSON.parse(res.body.toString('utf8')))) {
      writer.write(c);
      count += 1;
    }
    log.info(`${count} country polygons`);
    if (count < 4) log.warn(`expected 4 countries, got ${count}`);
  } catch (error) {
    log.warn(`countries layer failed: ${(error as Error).message}; coverage will be unknown`);
  }
  await writer.close();
  const report: SourceReport = {
    source: {
      id: SOURCE_IDS.countries,
      name: 'ONS Countries (December 2024) Boundaries UK BUC',
      url,
      licence: 'OGL-3.0',
      attribution: 'Country boundaries: Office for National Statistics licensed under the Open Government Licence v3. Contains OS data © Crown copyright and database right 2024.',
      fetchedAt,
      effectiveFrom: null,
      effectiveTo: null,
      version: '2024-12',
      featureCount: count,
      notes: 'Used only to tell England and Wales (rights-of-way coverage) from Scotland and Northern Ireland.',
    },
    warnings: [...log.warnings],
  };
  await writeReport(args.reportsDir, 'countries', report);
  return report;
}

if (process.argv[1] && /fetch-countries\.ts$/.test(process.argv[1])) {
  run(parsePipelineArgs(process.argv.slice(2))).catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
