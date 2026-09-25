import length from '@turf/length';
import { lineString } from '@turf/helpers';
import type { PathType, Position } from '../../../src/types.js';
import { round6 } from '../../lib/geometry.js';

export interface NormalisedPath {
  authorityCode: string;
  sourceRef: string | null;
  pathType: PathType;
  routeNo: string | null;
  routeName: string | null;
  parish: string | null;
  lengthM: number;
  coordinates: Position[];
}

export const FILE_PATH_TYPES: Record<number, PathType> = { 1: 'footpath', 2: 'bridleway', 3: 'restricted_byway', 4: 'boat' };
const PREFIX_PATH_TYPES: Record<string, PathType> = { Fo: 'footpath', Br: 'bridleway', Re: 'restricted_byway', By: 'boat', Bo: 'boat' };

interface ParsedProps {
  routeNo: string | null;
  routeName: string | null;
  parish: string | null;
  sourceRef: string | null;
  prefixType: PathType | undefined;
  attribution: string | null;
}

/**
 * rowmaps encodes attributes as pipe-delimited strings (verified 2026-09-25):
 *   Name:        "DN|Abbots Bickington|1"                  -> code | parish (name, code or number) | route number
 *   Description: "Fo|DN:1|0.523|<extra>|lon|lat|..."       -> type | id | miles | extra | endpoints...
 * <extra> varies by council: a description sentence (Barking), "none" (Devon), a
 * number (Dorset) or "Parish@District@Ref" (Cornwall). The first feature of each
 * file also carries an "Attribution" property.
 */
export function parseRowmapsProps(props: Record<string, unknown> | null | undefined, authorityName?: string): ParsedProps {
  const p = props ?? {};
  const name = typeof p.Name === 'string' ? p.Name : typeof p.name === 'string' ? p.name : '';
  const desc = typeof p.Description === 'string' ? p.Description : typeof p.description === 'string' ? p.description : '';
  const nameParts = name.split('|').map((x) => x.trim());
  const descParts = desc.split('|').map((x) => x.trim());
  const routeNo = nameParts.length >= 3 ? nameParts.slice(2).join('|') || null : name.trim() || null;
  let parish: string | null = nameParts.length >= 3 && nameParts[1] && nameParts[1] !== authorityName ? nameParts[1] : null;
  const prefixType = descParts.length >= 2 ? PREFIX_PATH_TYPES[descParts[0]] : undefined;
  const sourceRef = descParts.length >= 2 && /^[A-Z]{2,3}:\S+$/.test(descParts[1]) ? descParts[1] : null;
  let routeName: string | null = null;
  const extra = descParts.length >= 4 ? descParts[3] : '';
  if (extra.includes('@')) {
    const [parishName] = extra.split('@');
    if (parishName && (!parish || /^\d+$/.test(parish))) parish = parishName;
  } else if (extra && extra.toLowerCase() !== 'none' && /[A-Za-z]{3,}/.test(extra) && /\s/.test(extra)) {
    routeName = extra;
  }
  if (typeof p.parish === 'string') parish = p.parish;
  else if (typeof p.Parish === 'string') parish = p.Parish;
  const attribution = typeof p.Attribution === 'string' ? p.Attribution : null;
  return { routeNo, routeName, parish, sourceRef, prefixType, attribution };
}

export interface RowmapsParseResult {
  paths: NormalisedPath[];
  attribution: string | null;
  skipped: number;
}

export function parseRowmapsGeojson(json: unknown, authorityCode: string, pathType: PathType, authorityName?: string): RowmapsParseResult {
  const result: RowmapsParseResult = { paths: [], attribution: null, skipped: 0 };
  const features = Array.isArray(json)
    ? json
    : json && typeof json === 'object' && Array.isArray((json as { features?: unknown[] }).features)
      ? (json as { features: unknown[] }).features
      : [];
  for (const raw of features) {
    const f = raw as { geometry?: { type?: string; coordinates?: unknown }; properties?: Record<string, unknown> };
    const props = parseRowmapsProps(f?.properties, authorityName);
    if (props.attribution && !result.attribution) result.attribution = props.attribution;
    const geom = f?.geometry;
    if (!geom || !Array.isArray(geom.coordinates)) {
      result.skipped += 1;
      continue;
    }
    const lines: Position[][] = geom.type === 'LineString' ? [geom.coordinates as Position[]] : geom.type === 'MultiLineString' ? (geom.coordinates as Position[][]) : [];
    if (lines.length === 0) {
      result.skipped += 1;
      continue;
    }
    lines.forEach((coords, i) => {
      const clean = coords
        .filter((c) => Array.isArray(c) && Number.isFinite(c[0]) && Number.isFinite(c[1]))
        .map(([lon, lat]) => [round6(lon), round6(lat)] as Position);
      const dedup = clean.filter((c, idx) => idx === 0 || c[0] !== clean[idx - 1][0] || c[1] !== clean[idx - 1][1]);
      if (dedup.length < 2) {
        result.skipped += 1;
        return;
      }
      const lengthM = Math.round(length(lineString(dedup), { units: 'meters' }));
      if (lengthM < 2) {
        result.skipped += 1;
        return;
      }
      result.paths.push({
        authorityCode,
        sourceRef: props.sourceRef ? (lines.length > 1 ? `${props.sourceRef}#${i + 1}` : props.sourceRef) : null,
        pathType: props.prefixType ?? pathType,
        routeNo: props.routeNo,
        routeName: props.routeName,
        parish: props.parish,
        lengthM,
        coordinates: dedup,
      });
    });
  }
  return result;
}

export interface Authority {
  code: string;
  name: string;
  country: 'england' | 'wales';
}

export function authorityAttribution(a: Authority, year: number): string {
  return `Rights of way data provided by the council of ${a.name} under the Open Government Licence, via rowmaps.com. Contains Ordnance Survey data © Crown copyright and database right ${year}. An interpretation of the Definitive Map, not the Definitive Map itself.`;
}

/** Scrape authority codes and names from https://www.rowmaps.com/jsons/ */
export function scrapeAuthorityIndex(html: string): Array<{ code: string; name: string }> {
  const out: Array<{ code: string; name: string }> = [];
  const seen = new Set<string>();
  const re = /<a href="([A-Z]{2,3})\/">([^<]*)<\/a>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    if (seen.has(m[1])) continue;
    seen.add(m[1]);
    out.push({ code: m[1], name: m[2].replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').trim() });
  }
  return out;
}
