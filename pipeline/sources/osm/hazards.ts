import simplify from '@turf/simplify';
import length from '@turf/length';
import centroid from '@turf/centroid';
import { lineString } from '@turf/helpers';
import type { Geometry, Point } from 'geojson';
import type { HazardKind, LineString, MultiPolygon, Polygon } from '../../../src/types.js';
import { roundCoords, roundGeometry } from '../../lib/geometry.js';

/** One ground hazard as extracted from OpenStreetMap; polygons are split into parts at insert time. */
export interface NormalisedHazard {
  osmId: string | null;
  kind: HazardKind;
  name: string | null;
  operator: string | null;
  ref: string | null;
  geometry: Point | LineString | Polygon | MultiPolygon;
}

/** The osmium tags-filter expressions that select hazard features from the extract. */
export const HAZARD_FILTERS = ['w/railway=rail,light_rail,narrow_gauge', 'w/highway=motorway,trunk', 'w/power=line', 'nwr/aeroway=helipad', 'nwr/emergency=landing_site', 'wr/landuse=military', 'wr/military'];

const MIN_LINE_M = 30;

/**
 * Classify an OSM feature exported by `osmium export` (tags as properties).
 * Sidings, yards and disused lines are not hazards to a drone in the way a
 * running line is; trenches are not military installations.
 */
export function classifyHazard(tags: Record<string, unknown>): HazardKind | undefined {
  const t = (k: string) => String(tags[k] ?? '');
  if (['rail', 'light_rail', 'narrow_gauge'].includes(t('railway'))) {
    if (['siding', 'yard', 'spur', 'crossover'].includes(t('service'))) return undefined;
    return 'railway';
  }
  if (t('highway') === 'motorway') return 'motorway';
  if (t('highway') === 'trunk') return 'trunk_road';
  if (t('power') === 'line') return 'power_line';
  if (t('aeroway') === 'helipad' || t('emergency') === 'landing_site') return 'helipad';
  if (t('landuse') === 'military' || (t('military') !== '' && t('military') !== 'trench')) return 'military';
  return undefined;
}

export function normaliseHazardFeature(feature: { geometry?: Geometry | null; properties?: Record<string, unknown> | null }, simplifyM = 10): NormalisedHazard[] {
  const tags = feature.properties ?? {};
  const kind = classifyHazard(tags);
  const g = feature.geometry;
  if (!kind || !g) return [];
  const str = (k: string) => {
    const v = tags[k];
    return typeof v === 'string' && v.trim() !== '' ? v.trim().slice(0, 120) : null;
  };
  const base = { osmId: str('@id') ?? str('id'), kind, name: str('name'), operator: str('operator'), ref: str('ref') };
  const tolerance = simplifyM / 111_320;
  const lines: LineString[] = g.type === 'LineString' ? [g] : g.type === 'MultiLineString' ? g.coordinates.map((c) => ({ type: 'LineString', coordinates: c })) : [];
  if (kind === 'helipad') {
    try {
      const pos = g.type === 'Point' ? g.coordinates : centroid(g).geometry.coordinates;
      if (!Number.isFinite(pos[0]) || !Number.isFinite(pos[1])) return [];
      return [{ ...base, geometry: { type: 'Point', coordinates: roundCoords([pos])[0] } }];
    } catch {
      return [];
    }
  }
  if (kind === 'military') {
    if (g.type !== 'Polygon' && g.type !== 'MultiPolygon') return [];
    let geometry: Polygon | MultiPolygon = g;
    try {
      geometry = simplify(g, { tolerance, highQuality: false }) as Polygon | MultiPolygon;
    } catch {
      geometry = g;
    }
    return [{ ...base, geometry: roundGeometry(geometry) }];
  }
  const out: NormalisedHazard[] = [];
  for (const line of lines) {
    if (line.coordinates.length < 2) continue;
    let coords = line.coordinates;
    if (tolerance > 0 && coords.length > 2) {
      try {
        coords = simplify(lineString(coords), { tolerance, highQuality: false }).geometry.coordinates;
      } catch {
        // keep original
      }
    }
    if (length(lineString(coords), { units: 'meters' }) < MIN_LINE_M) continue;
    out.push({ ...base, geometry: { type: 'LineString', coordinates: roundCoords(coords) } });
  }
  return out;
}
