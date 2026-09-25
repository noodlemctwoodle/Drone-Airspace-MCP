#!/usr/bin/env tsx
import path from 'node:path';
import { createBuildLog } from '../pipeline/lib/log.js';
import { parsePipelineArgs, writeReport, type PipelineArgs, type SourceReport } from '../pipeline/lib/cli.js';
import { fetchCached } from '../pipeline/lib/http.js';
import { entryText, pickEntry, readZipEntries } from '../pipeline/lib/zip.js';
import { currentCycle, cycleEnd, nextCycle } from '../pipeline/lib/airac.js';
import { bboxIntersects } from '../pipeline/lib/regions.js';
import { openNdjsonWriter } from '../pipeline/lib/ndjson.js';
import { geometryBbox } from '../pipeline/lib/geometry.js';
import { parseAixmAirspaces } from '../pipeline/sources/nats/aixm-parser.js';
import { parseNatsKml } from '../pipeline/sources/nats/kml-parser.js';
import { crossCheck } from '../pipeline/sources/nats/crosscheck.js';
import { scrapeNatsIndex } from '../pipeline/sources/nats/index-page.js';
import { SOURCE_IDS } from '../src/pack/schema.js';

const INDEX_URL = process.env.NATS_UAS_INDEX_URL ?? 'https://nats-uk.ead-it.com/cms-nats/opencms/en/Publications/digital-datasets/index.html';
const ZIP_TEMPLATE =
  process.env.NATS_UAS_ZIP_URL_TEMPLATE ??
  'https://nats-uk.ead-it.com/cms-nats/export/sites/default/en/Publications/digital-datasets/UAS_AREA_1/EG_UAS_FR_DS_AREA1_FULL_{date}_{fmt}.zip';
export const NATS_ATTRIBUTION = 'Airspace restrictions: UK AIP ENR 5.1 UAS Flight Restrictions dataset © NATS Limited. Reproduced for information only; the UK AIP is the authoritative source.';

export async function resolveNatsDataset(args: PipelineArgs, log = createBuildLog('nats')): Promise<{ date: string; xmlUrl: string; kmlUrl: string | null }> {
  const url = (date: string, fmt: 'XML' | 'KML') => ZIP_TEMPLATE.replace('{date}', date).replace('{fmt}', fmt);
  const wanted = args.airac ?? currentCycle().replace(/-/g, '');
  const probe = await fetchCached(url(wanted, 'XML'), { cacheDir: path.join(args.rawDir, 'nats'), ttlSeconds: 7 * 86_400, offline: args.offline });
  if (probe.status !== 404 && probe.body.length > 0) return { date: wanted, xmlUrl: url(wanted, 'XML'), kmlUrl: url(wanted, 'KML') };
  log.warn(`no dataset for ${wanted} at the templated URL; scraping the index page`);
  const index = await fetchCached(INDEX_URL, { cacheDir: path.join(args.rawDir, 'nats'), ttlSeconds: 3600, offline: args.offline });
  const today = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const links = scrapeNatsIndex(index.body.toString('utf8')).filter((l) => l.xmlUrl && l.date <= today);
  if (links.length === 0) throw new Error('no NATS UAS dataset links found on the index page');
  return { date: links[0].date, xmlUrl: links[0].xmlUrl!, kmlUrl: links[0].kmlUrl };
}

export async function run(args: PipelineArgs): Promise<SourceReport> {
  const log = createBuildLog('nats');
  const cacheDir = path.join(args.rawDir, 'nats');
  const ds = await resolveNatsDataset(args, log);
  const effective = `${ds.date.slice(0, 4)}-${ds.date.slice(4, 6)}-${ds.date.slice(6, 8)}`;
  log.info(`dataset ${ds.date} (effective ${effective})`);
  const xmlZip = await fetchCached(ds.xmlUrl, { cacheDir, ttlSeconds: 30 * 86_400, offline: args.offline });
  const xml = entryText(pickEntry(readZipEntries(xmlZip.body), /(?<!METADATA)\.xml$/i));
  const parsed = parseAixmAirspaces(xml);
  log.info(`parsed ${parsed.stats.parsed} of ${parsed.stats.airspaces} airspaces (${parsed.stats.dropped} dropped, ${parsed.stats.geoBorders} geo-borders ignored)`);
  for (const w of parsed.warnings.slice(0, 20)) log.warn(w);
  if (parsed.warnings.length > 20) log.warn(`... ${parsed.warnings.length - 20} more parser warnings`);

  let crossReport: unknown = null;
  if (ds.kmlUrl) {
    try {
      const kmlZip = await fetchCached(ds.kmlUrl, { cacheDir, ttlSeconds: 30 * 86_400, offline: args.offline });
      const entries = readZipEntries(kmlZip.body);
      let kmlText: string;
      const kmz = entries.find((e) => /\.kmz$/i.test(e.name));
      if (kmz) kmlText = entryText(pickEntry(readZipEntries(kmz.data), /\.kml$/i));
      else kmlText = entryText(pickEntry(entries, /\.kml$/i));
      const report = crossCheck(parsed.zones, parseNatsKml(kmlText));
      crossReport = report;
      log.info(`cross-check: ${report.matched} matched, ${report.onlyInAixm.length} only in AIXM, ${report.onlyInKml.length} only in KML, ${report.areaOutliers.length} area outliers`);
      for (const w of report.warnings) log.warn(`cross-check: ${w}`);
    } catch (error) {
      log.warn(`cross-check skipped: ${(error as Error).message}`);
    }
  }

  const writer = await openNdjsonWriter(path.join(args.normalisedDir, 'zones.ndjson'));
  let kept = 0;
  for (const z of parsed.zones) {
    if (!bboxIntersects(geometryBbox(z.geometry), args.region.bbox)) continue;
    writer.write(z);
    kept += 1;
  }
  await writer.close();
  log.info(`wrote ${kept} zones for region ${args.region.name}`);

  const report: SourceReport = {
    source: {
      id: SOURCE_IDS.nats,
      name: 'NATS UK AIP ENR 5.1 UAS Flight Restrictions',
      url: ds.xmlUrl,
      licence: 'NATS-unspecified',
      attribution: NATS_ATTRIBUTION,
      fetchedAt: xmlZip.fetchedAt,
      effectiveFrom: effective,
      effectiveTo: cycleEnd(effective),
      version: ds.date,
      featureCount: kept,
      notes: `AIRAC next cycle ${nextCycle(new Date(`${effective}T00:00:00Z`))}`,
    },
    warnings: [...log.warnings],
    extra: { stats: parsed.stats, parserWarnings: parsed.warnings, crossCheck: crossReport },
  };
  await writeReport(args.reportsDir, 'nats', report);
  return report;
}

if (process.argv[1] && /fetch-nats\.ts$/.test(process.argv[1])) {
  run(parsePipelineArgs(process.argv.slice(2))).catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
