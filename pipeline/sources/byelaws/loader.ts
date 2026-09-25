import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { parse as parseYaml } from 'yaml';
import type { MultiPolygon, Polygon } from '../../../src/types.js';
import { circlePositions, roundGeometry } from '../../lib/geometry.js';
import type { NormalisedRestriction } from '../nt/arcgis.js';
import { byelawFileSchema, type ByelawEntry } from './schema.js';

export interface ByelawLoadResult {
  restrictions: NormalisedRestriction[];
  validEntries: number;
  warnings: string[];
}

async function geometryFor(entry: ByelawEntry, baseDir: string): Promise<Array<Polygon | MultiPolygon>> {
  if (entry.geometry.type === 'circle') {
    return [{ type: 'Polygon', coordinates: [circlePositions(entry.geometry.centre, entry.geometry.radius_m / 1000)] }];
  }
  const file = path.join(baseDir, entry.geometry.path);
  const json = JSON.parse(await readFile(file, 'utf8')) as { type?: string; features?: Array<{ geometry?: Polygon | MultiPolygon }>; coordinates?: unknown };
  const geoms: Array<Polygon | MultiPolygon> = [];
  if (json.type === 'FeatureCollection') {
    for (const f of json.features ?? []) {
      if (f.geometry && (f.geometry.type === 'Polygon' || f.geometry.type === 'MultiPolygon')) geoms.push(f.geometry);
    }
  } else if (json.type === 'Polygon' || json.type === 'MultiPolygon') {
    geoms.push(json as unknown as Polygon | MultiPolygon);
  }
  if (geoms.length === 0) throw new Error(`no Polygon/MultiPolygon in ${entry.geometry.path}`);
  if (entry.geometry.merge && geoms.length > 1) {
    const polys = geoms.flatMap((g) => (g.type === 'Polygon' ? [g.coordinates] : g.coordinates));
    return [{ type: 'MultiPolygon', coordinates: polys }];
  }
  return geoms;
}

export async function loadByelaws(yamlPath: string): Promise<ByelawLoadResult> {
  const warnings: string[] = [];
  const restrictions: NormalisedRestriction[] = [];
  let raw: unknown;
  try {
    raw = parseYaml(await readFile(yamlPath, 'utf8'));
  } catch (error) {
    return { restrictions, validEntries: 0, warnings: [`could not read ${yamlPath}: ${(error as Error).message}`] };
  }
  const parsed = byelawFileSchema.safeParse(raw);
  let entries: ByelawEntry[] = [];
  if (parsed.success) {
    entries = parsed.data.entries;
  } else {
    // Validate entry by entry so one bad entry does not drop the whole file.
    const list = (raw as { entries?: unknown[] })?.entries;
    if (!Array.isArray(list)) return { restrictions, validEntries: 0, warnings: [`${yamlPath}: ${parsed.error.issues[0]?.message ?? 'invalid'}`] };
    for (const [i, e] of list.entries()) {
      const one = byelawFileSchema.shape.entries.element.safeParse(e);
      if (one.success) entries.push(one.data);
      else warnings.push(`entry ${i} (${(e as { id?: string })?.id ?? 'no id'}): ${one.error.issues.map((x) => `${x.path.join('.')} ${x.message}`).join('; ')}`);
    }
  }
  const baseDir = path.dirname(yamlPath);
  const seen = new Set<string>();
  for (const entry of entries) {
    if (seen.has(entry.id)) {
      warnings.push(`duplicate id ${entry.id} skipped`);
      continue;
    }
    seen.add(entry.id);
    let geoms: Array<Polygon | MultiPolygon>;
    try {
      geoms = await geometryFor(entry, baseDir);
    } catch (error) {
      warnings.push(`${entry.id}: ${(error as Error).message}`);
      continue;
    }
    for (const g of geoms) {
      restrictions.push({
        sourceId: 'byelaws',
        entryId: entry.id,
        kind: entry.rule_type,
        owner: entry.authority,
        name: entry.area_name,
        accessClass: null,
        takeoffBanned: entry.takeoff_banned,
        landingBanned: entry.landing_banned ?? entry.takeoff_banned,
        summary: entry.summary,
        sourceUrl: entry.source_url,
        lastVerified: entry.last_verified,
        props: null,
        geometry: roundGeometry(g),
      });
    }
  }
  return { restrictions, validEntries: seen.size, warnings };
}
