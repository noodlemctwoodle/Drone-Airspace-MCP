#!/usr/bin/env tsx
import path from 'node:path';
import { createBuildLog } from '../pipeline/lib/log.js';
import { parsePipelineArgs, writeReport, type PipelineArgs, type SourceReport } from '../pipeline/lib/cli.js';
import { fetchCached } from '../pipeline/lib/http.js';
import { openNdjsonWriter } from '../pipeline/lib/ndjson.js';
import { bboxIntersects } from '../pipeline/lib/regions.js';
import { geometryBbox } from '../pipeline/lib/geometry.js';
import { fetchAllWfsFeatures, type WfsFeature } from '../pipeline/sources/wfs/geojson.js';
import type { NormalisedRestriction } from '../pipeline/sources/nt/arcgis.js';
import { NRW_LAYERS, NRW_WFS_URL, normaliseNrwAccessFeature, normaliseNrwNationalParkFeature, normaliseNrwSssiFeature } from '../pipeline/sources/access/nrw.js';
import { SOURCE_IDS } from '../src/pack/schema.js';

const NRW_ATTRIBUTION = (what: string) => `${what}: Natural Resources Wales open data via DataMapWales, Open Government Licence v3. Contains Natural Resources Wales information © Natural Resources Wales and database right. Contains OS data © Crown copyright and database right 2026.`;

/** Welsh access land, SSSIs and National Parks over WFS. Wales is skipped when the region does not touch it. */
export async function run(args: PipelineArgs): Promise<SourceReport[]> {
  const log = createBuildLog('wales');
  const base = process.env.NRW_WFS_URL ?? NRW_WFS_URL;
  const cacheDir = path.join(args.rawDir, 'wales');
  const fetchText = async (u: string) => (await fetchCached(u, { cacheDir, ttlSeconds: 7 * 86_400, offline: args.offline, politeGapMs: 300 })).body.toString('utf8');
  const writer = await openNdjsonWriter(path.join(args.normalisedDir, 'wales.ndjson'));
  const m = args.simplifyLandM;
  const layers: Array<{ id: string; name: string; typeName: string; normalise: (f: WfsFeature, at: string) => NormalisedRestriction | undefined; attribution: string; notes: string }> = [
    { id: SOURCE_IDS.nrwOpenCountry, name: 'NRW Open Access: Open Country', typeName: process.env.NRW_OPEN_COUNTRY_TYPENAME ?? NRW_LAYERS.openCountry, normalise: (f, at) => normaliseNrwAccessFeature(f, 'open_country', SOURCE_IDS.nrwOpenCountry, at, m), attribution: NRW_ATTRIBUTION('Open access land'), notes: 'CRoW open country.' },
    { id: SOURCE_IDS.nrwCommonLand, name: 'NRW Open Access: Registered Common Land', typeName: process.env.NRW_COMMON_LAND_TYPENAME ?? NRW_LAYERS.commonLand, normalise: (f, at) => normaliseNrwAccessFeature(f, 'common_land', SOURCE_IDS.nrwCommonLand, at, m), attribution: NRW_ATTRIBUTION('Open access land'), notes: 'CRoW registered common land.' },
    { id: SOURCE_IDS.nrwSssi, name: 'NRW Sites of Special Scientific Interest', typeName: process.env.NRW_SSSI_TYPENAME ?? NRW_LAYERS.sssi, normalise: (f, at) => normaliseNrwSssiFeature(f, at, m), attribution: NRW_ATTRIBUTION('SSSI boundaries'), notes: 'Advisory.' },
    { id: SOURCE_IDS.nrwNationalParks, name: 'NRW National Parks', typeName: process.env.NRW_NATIONAL_PARK_TYPENAME ?? NRW_LAYERS.nationalParks, normalise: (f, at) => normaliseNrwNationalParkFeature(f, at, Math.max(m, 20)), attribution: NRW_ATTRIBUTION('National Park boundaries'), notes: 'Advisory.' },
  ];
  const WALES_BBOX: [number, number, number, number] = [-5.4, 51.3, -2.6, 53.5];
  const touchesWales = bboxIntersects(args.region.bbox, WALES_BBOX);
  const reports: SourceReport[] = [];
  for (const layer of layers) {
    const fetchedAt = new Date().toISOString();
    let count = 0;
    const warnings: string[] = [];
    if (touchesWales) {
      try {
        for await (const f of fetchAllWfsFeatures(base, layer.typeName, { fetchText, pageSize: 500, bbox: args.region.name === 'national' ? undefined : args.region.bbox })) {
          const r = layer.normalise(f, fetchedAt);
          if (!r || !bboxIntersects(geometryBbox(r.geometry), args.region.bbox)) continue;
          writer.write(r);
          count += 1;
        }
        log.info(`${layer.id}: ${count} polygons`);
      } catch (error) {
        const msg = `${layer.id} failed: ${(error as Error).message}`;
        log.warn(msg);
        warnings.push(msg);
      }
    } else log.info(`${layer.id}: region does not touch Wales, skipped`);
    reports.push({ source: { id: layer.id, name: layer.name, url: `${base}?service=WFS&typeNames=${layer.typeName}`, licence: 'OGL-3.0', attribution: layer.attribution, fetchedAt, effectiveFrom: null, effectiveTo: null, version: null, featureCount: count, notes: layer.notes }, warnings });
  }
  await writer.close();
  await writeReport(args.reportsDir, 'wales', reports);
  return reports;
}

if (process.argv[1] && /fetch-wales\.ts$/.test(process.argv[1])) {
  run(parsePipelineArgs(process.argv.slice(2))).catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
