#!/usr/bin/env tsx
import { execSync } from 'node:child_process';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, rename, stat } from 'node:fs/promises';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { createGzip } from 'node:zlib';
import simplify from '@turf/simplify';
import { lineString } from '@turf/helpers';
import { createBuildLog } from '../pipeline/lib/log.js';
import { parsePipelineArgs, readReport, writeReport, type PipelineArgs, type SourceReport } from '../pipeline/lib/cli.js';
import { readNdjson } from '../pipeline/lib/ndjson.js';
import { createPackDb, finaliseDb } from '../pipeline/assemble/create-db.js';
import { insertAdminAreas, insertAuthority, insertCoverage, insertHazards, insertLandRestrictions, insertMeta, insertParking, insertRightsOfWay, insertSource, insertZones } from '../pipeline/assemble/insert.js';
import { buildGazetteer } from '../pipeline/assemble/gazetteer.js';
import { verifyPack } from '../pipeline/verify/assertions.js';
import type { NormalisedZone } from '../pipeline/sources/nats/aixm-parser.js';
import type { NormalisedPath } from '../pipeline/sources/rowmaps/geojson-parser.js';
import type { NormalisedRestriction } from '../pipeline/sources/nt/arcgis.js';
import type { CountryPolygon } from '../pipeline/sources/countries/ons.js';
import type { NormalisedParking } from '../pipeline/sources/osm/parking.js';
import type { NormalisedHazard } from '../pipeline/sources/osm/hazards.js';
import type { NormalisedAdminArea } from '../pipeline/sources/lad/ons.js';
import { SCHEMA_VERSION, SOURCE_IDS } from '../src/pack/schema.js';
import type { PackSource, Position } from '../src/types.js';
import { nextCycle } from '../pipeline/lib/airac.js';
import { run as fetchNats } from './fetch-nats.js';
import { run as fetchRowmaps, type AuthorityReport } from './fetch-rowmaps.js';
import { run as fetchNt } from './fetch-nt.js';
import { run as fetchCountries } from './fetch-countries.js';
import { run as loadByelaws } from './load-byelaws.js';
import { run as fetchParking } from './fetch-parking.js';
import { run as fetchLad } from './fetch-lad.js';
import { run as fetchAccess } from './fetch-access.js';
import { run as fetchWales } from './fetch-wales.js';
import { run as fetchForestry } from './fetch-forestry.js';
import { run as fetchNi } from './fetch-ni.js';
import { run as fetchNiProw } from './fetch-ni-prow.js';
import { run as fetchHazards } from './fetch-hazards.js';
import { run as fetchCorePaths } from './fetch-corepaths.js';
import { unlink } from 'node:fs/promises';
import { writeManifest } from './make-manifest.js';

function gitCommit(): string | null {
  try {
    return execSync('git rev-parse HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
  } catch {
    return null;
  }
}

async function exists(p: string): Promise<boolean> {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

export interface BuildResult {
  packPath: string;
  gzPath: string | null;
  tag: string;
  counts: Record<string, number>;
  verify: Awaited<ReturnType<typeof verifyPack>>;
}

export async function buildPack(args: PipelineArgs): Promise<BuildResult> {
  const log = createBuildLog('build-pack');
  await mkdir(args.out, { recursive: true });
  const reports: SourceReport[] = [];
  const has = (id: string) => !args.exclude.has(id);

  // Sources in build order. `lad` runs before `byelaws` so authority-scoped policies can resolve their boundary.
  const SOURCES: Array<{ id: string; files: string[]; run: (a: PipelineArgs) => Promise<SourceReport | SourceReport[]> }> = [
    { id: 'nats', files: ['zones.ndjson'], run: fetchNats },
    { id: 'rowmaps', files: ['rights_of_way.ndjson'], run: fetchRowmaps },
    { id: 'corepaths', files: ['core_paths.ndjson'], run: fetchCorePaths },
    { id: 'niprow', files: ['ni_prow.ndjson'], run: fetchNiProw },
    { id: 'nt', files: ['nt.ndjson'], run: fetchNt },
    { id: 'access', files: ['access.ndjson'], run: fetchAccess },
    { id: 'wales', files: ['wales.ndjson'], run: fetchWales },
    { id: 'forestry', files: ['forestry.ndjson'], run: fetchForestry },
    { id: 'ni', files: ['ni.ndjson'], run: fetchNi },
    { id: 'countries', files: ['coverage.ndjson'], run: fetchCountries },
    { id: 'lad', files: ['admin_areas.ndjson'], run: fetchLad },
    { id: 'byelaws', files: ['byelaws.ndjson'], run: loadByelaws },
    { id: 'parking', files: ['parking.ndjson'], run: fetchParking },
    { id: 'hazards', files: ['hazards.ndjson'], run: fetchHazards },
  ];
  for (const source of SOURCES) {
    if (!has(source.id)) {
      // Excluded means "not in the pack": drop any stale NDJSON so it is not inserted.
      for (const f of source.files) await unlink(path.join(args.normalisedDir, f)).catch(() => undefined);
      continue;
    }
    const r = args.skipFetch ? await readReport<SourceReport | SourceReport[]>(args.reportsDir, source.id) : await source.run(args);
    if (!r) continue;
    reports.push(...(Array.isArray(r) ? r : [r]));
  }

  const natsReport = reports.find((r) => r.source.id === SOURCE_IDS.nats);
  const airac = natsReport?.source.effectiveFrom ?? null;
  const tag = args.tag ?? `pack-${(airac ?? new Date().toISOString().slice(0, 10)).replace(/-/g, '')}-local`;
  const packDir = path.join(args.out, 'pack');
  await mkdir(packDir, { recursive: true });
  const finalPath = path.join(packDir, `${tag}.sqlite`);
  const tmpPath = `${finalPath}.building`;
  const db = await createPackDb(tmpPath);
  const counts: Record<string, number> = {};
  const warnings: string[] = reports.flatMap((r) => r.warnings);

  try {
    for (const r of reports) insertSource(db, r.source);

    const zonesFile = path.join(args.normalisedDir, 'zones.ndjson');
    counts.zones = (await exists(zonesFile)) ? await insertZones(db, SOURCE_IDS.nats, readNdjson<NormalisedZone>(zonesFile)) : 0;
    log.info(`zones: ${counts.zones}`);

    const rowReport = reports.find((r) => r.source.id === SOURCE_IDS.rowmaps);
    const coreReport = reports.find((r) => r.source.id === SOURCE_IDS.corePaths);
    const niProwReport = reports.find((r) => r.source.id === SOURCE_IDS.niProw);
    const authorities = [...((rowReport?.extra?.authorities as AuthorityReport[] | undefined) ?? []), ...((coreReport?.extra?.authorities as AuthorityReport[] | undefined) ?? []), ...((niProwReport?.extra?.authorities as AuthorityReport[] | undefined) ?? [])];
    for (const a of authorities) insertAuthority(db, { code: a.code, name: a.name, country: a.country, attribution: a.attribution, fetchedAt: a.fetchedAt, featureCount: a.featureCount });
    const prowFiles = (await Promise.all(['rights_of_way.ndjson', 'core_paths.ndjson', 'ni_prow.ndjson'].map(async (f) => ((await exists(path.join(args.normalisedDir, f))) ? path.join(args.normalisedDir, f) : null)))).filter((f): f is string => f !== null);
    if (prowFiles.length > 0) {
      const tolerance = args.simplifyProwM > 0 ? args.simplifyProwM / 111_320 : 0;
      async function* paths(): AsyncGenerator<NormalisedPath> {
        for (const prowFile of prowFiles) for await (const p of readNdjson<NormalisedPath>(prowFile)) {
          if (tolerance > 0 && p.coordinates.length > 2) {
            try {
              p.coordinates = simplify(lineString(p.coordinates), { tolerance, highQuality: false }).geometry.coordinates as Position[];
            } catch {
              // keep original
            }
          }
          yield p;
        }
      }
      counts.rights_of_way = await insertRightsOfWay(db, paths());
    } else counts.rights_of_way = 0;
    log.info(`rights of way: ${counts.rights_of_way}`);

    async function* restrictions(): AsyncGenerator<NormalisedRestriction> {
      for (const name of ['nt.ndjson', 'byelaws.ndjson', 'access.ndjson', 'wales.ndjson', 'forestry.ndjson', 'ni.ndjson']) {
        const f = path.join(args.normalisedDir, name);
        if (!(await exists(f))) continue;
        for await (const r of readNdjson<NormalisedRestriction>(f)) yield r;
      }
    }
    counts.land_restrictions = await insertLandRestrictions(db, restrictions());
    log.info(`land restrictions: ${counts.land_restrictions}`);

    const coverageFile = path.join(args.normalisedDir, 'coverage.ndjson');
    const countries: CountryPolygon[] = [];
    if (await exists(coverageFile)) for await (const c of readNdjson<CountryPolygon>(coverageFile)) countries.push(c);
    counts.coverage = insertCoverage(db, countries);
    const parkingFile = path.join(args.normalisedDir, 'parking.ndjson');
    counts.parking = (await exists(parkingFile)) ? await insertParking(db, readNdjson<NormalisedParking>(parkingFile)) : 0;
    log.info(`parking: ${counts.parking}`);
    const hazardsFile = path.join(args.normalisedDir, 'hazards.ndjson');
    counts.hazards = (await exists(hazardsFile)) ? await insertHazards(db, SOURCE_IDS.hazards, readNdjson<NormalisedHazard>(hazardsFile)) : 0;
    log.info(`hazards: ${counts.hazards}`);
    const ladFile = path.join(args.normalisedDir, 'admin_areas.ndjson');
    counts.admin_areas = (await exists(ladFile)) ? await insertAdminAreas(db, readNdjson<NormalisedAdminArea>(ladFile)) : 0;
    log.info(`admin areas: ${counts.admin_areas}`);
    counts.gazetteer = buildGazetteer(db);
    log.info(`gazetteer: ${counts.gazetteer}`);

    const metaSources: PackSource[] = reports.map((r) => r.source);
    insertMeta(db, {
      schema_version: SCHEMA_VERSION,
      pack_tag: tag,
      built_at: new Date().toISOString(),
      build_commit: gitCommit(),
      region: args.region.name,
      bbox: args.region.bbox,
      airac_effective: airac,
      airac_next: airac ? nextCycle(new Date(`${airac}T00:00:00Z`)) : null,
      counts,
      attribution: metaSources.map((s) => s.attribution),
      licences: Object.fromEntries(metaSources.map((s) => [s.id, s.licence])),
      warnings: warnings.slice(0, 200),
    });
    finaliseDb(db);
  } finally {
    db.close();
  }
  await rename(tmpPath, finalPath);
  const sizeBytes = (await stat(finalPath)).size;
  log.info(`pack ${finalPath} (${(sizeBytes / 1048576).toFixed(1)} MB)`);

  const verify = await verifyPack(finalPath, { region: args.region.name, strict: args.strict, sizeBytes });
  for (const w of verify.warnings) log.warn(`verify: ${w}`);
  for (const f of verify.failures) log.error(`verify: ${f}`);
  await writeReport(args.reportsDir, 'verify', verify);
  await writeReport(args.reportsDir, 'size', { sizeBytes, counts });
  if (!verify.ok) throw new Error(`pack verification failed: ${verify.failures.join('; ')}`);

  let gzPath: string | null = null;
  const sources: PackSource[] = reports.map((r) => r.source);
  if (!args.noManifest) {
    gzPath = `${finalPath}.gz`;
    await pipeline(createReadStream(finalPath), createGzip({ level: 9 }), createWriteStream(gzPath));
    await writeManifest({ packPath: finalPath, gzPath, tag, region: args.region.name, sources, counts, airac, buildCommit: gitCommit(), out: args.out });
  }
  return { packPath: finalPath, gzPath, tag, counts, verify };
}

if (process.argv[1] && /build-pack\.ts$/.test(process.argv[1])) {
  buildPack(parsePipelineArgs(process.argv.slice(2)))
    .then((r) => console.error(`[build-pack] done: ${r.tag} ${JSON.stringify(r.counts)}`))
    .catch((e) => {
      console.error(e);
      process.exit(1);
    });
}
