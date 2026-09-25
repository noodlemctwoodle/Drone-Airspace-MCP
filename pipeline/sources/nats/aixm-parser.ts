import centroid from '@turf/centroid';
import union from '@turf/union';
import { featureCollection, polygon as turfPolygon } from '@turf/helpers';
import { createRequire } from 'node:module';
import type { LimitRef, MultiPolygon, Polygon, Position, ZoneType } from '../../../src/types.js';
import { arcPositions, appendSegment, circlePositions, normalisePolygon, radiusToKm, roundGeometry, samePoint } from '../../lib/geometry.js';
import { attr, child, children, childrenNamed, findAll, findFirst, parseOrderedXml, pathText, tagName, textOf, type XmlNode } from '../../lib/xml.js';
import { aerodromeNameOf, mapZoneType } from './zone-types.js';

const require = createRequire(import.meta.url);
const AERODROME_ICAO = require('./aerodromes.json') as Record<string, string>;

export interface NormalisedZone {
  aixmId: string | null;
  designator: string | null;
  name: string;
  zoneType: ZoneType;
  rawType: string | null;
  icao: string | null;
  aerodromeName: string | null;
  lowerFt: number | null;
  lowerRef: LimitRef | null;
  lowerRaw: string | null;
  upperFt: number | null;
  upperRef: LimitRef | null;
  upperRaw: string | null;
  activation: string | null;
  contact: string | null;
  notes: string | null;
  validFrom: string | null;
  validTo: string | null;
  centroid: Position;
  geometry: Polygon | MultiPolygon;
}

export interface AixmParseResult {
  zones: NormalisedZone[];
  warnings: string[];
  stats: { airspaces: number; parsed: number; dropped: number; geoBorders: number };
}

const UK = { minLat: 48.5, maxLat: 62, minLon: -12, maxLon: 4 };

function parsePos(text: string | undefined, warn: (m: string) => void): Position | undefined {
  if (!text) return undefined;
  const parts = text.trim().split(/\s+/).map(Number);
  if (parts.length < 2 || parts.some((n) => !Number.isFinite(n))) return undefined;
  // EPSG:4326 in GML is lat lon. Sanity-check against the UK envelope and swap if it only fits the other way round.
  let [lat, lon] = parts;
  const fits = (la: number, lo: number) => la >= UK.minLat && la <= UK.maxLat && lo >= UK.minLon && lo <= UK.maxLon;
  if (!fits(lat, lon) && fits(lon, lat)) {
    warn('coordinate axis order looked like lon lat; swapped');
    [lat, lon] = [lon, lat];
  }
  return [lon, lat];
}

function pointsOf(segment: XmlNode, warn: (m: string) => void): Position[] {
  const out: Position[] = [];
  for (const pp of childrenNamed(segment, 'pointProperty')) {
    const pos = findFirst(pp, 'pos');
    const p = parsePos(textOf(pos), warn);
    if (p) out.push(p);
  }
  const posList = child(segment, 'posList');
  if (posList) {
    const nums = (textOf(posList) ?? '').split(/\s+/).map(Number).filter((n) => Number.isFinite(n));
    for (let i = 0; i + 1 < nums.length; i += 2) {
      const p = parsePos(`${nums[i]} ${nums[i + 1]}`, warn);
      if (p) out.push(p);
    }
  }
  return out;
}

function ringFromCurveMembers(ring: XmlNode, warn: (m: string) => void): Position[] {
  let positions: Position[] = [];
  const members = childrenNamed(ring, 'curveMember');
  for (const member of members) {
    const segments = findFirst(member, 'segments');
    if (!segments) continue;
    for (const seg of children(segments)) {
      const kind = tagName(seg);
      let pts: Position[] = [];
      if (kind === 'GeodesicString' || kind === 'LineStringSegment' || kind === 'LineString') {
        pts = pointsOf(seg, warn);
      } else if (kind === 'CircleByCenterPoint' || kind === 'ArcByCenterPoint') {
        const centre = pointsOf(seg, warn)[0];
        const radiusNode = child(seg, 'radius');
        const radius = Number(textOf(radiusNode));
        if (!centre || !Number.isFinite(radius)) {
          warn(`${kind} without centre or radius skipped`);
          continue;
        }
        const km = radiusToKm(radius, attr(radiusNode!, 'uom'));
        if (kind === 'CircleByCenterPoint') {
          pts = circlePositions(centre, km);
        } else {
          const start = Number(textOf(child(seg, 'startAngle')));
          const end = Number(textOf(child(seg, 'endAngle')));
          if (!Number.isFinite(start) || !Number.isFinite(end)) {
            warn('ArcByCenterPoint without angles skipped');
            continue;
          }
          pts = arcPositions(centre, km, start, end);
        }
      } else if (kind) {
        warn(`unsupported segment type ${kind} skipped`);
        continue;
      }
      if (pts.length === 0) continue;
      const joined = appendSegment(positions, pts);
      if (joined.reversed && kind === 'ArcByCenterPoint') warn('arc direction reversed to join ring');
      positions = joined.ring;
    }
  }
  // A LinearRing / posList ring without curve members
  if (members.length === 0) {
    const linear = child(ring, 'LinearRing') ?? ring;
    positions = pointsOf(linear, warn);
  }
  return positions;
}

function polygonFromSurface(surface: XmlNode, warn: (m: string) => void): Polygon[] {
  const polys: Polygon[] = [];
  for (const patch of findAll(surface, 'PolygonPatch')) {
    const exterior = child(patch, 'exterior');
    const outerRing = exterior ? (child(exterior, 'Ring') ?? child(exterior, 'LinearRing') ?? exterior) : undefined;
    if (!outerRing) continue;
    const rings: Position[][] = [ringFromCurveMembers(outerRing, warn)];
    for (const interior of childrenNamed(patch, 'interior')) {
      const innerRing = child(interior, 'Ring') ?? child(interior, 'LinearRing') ?? interior;
      const inner = ringFromCurveMembers(innerRing, warn);
      if (inner.length >= 3) rings.push(inner);
    }
    const poly = normalisePolygon(rings);
    if (poly) polys.push(poly);
    else warn('polygon patch produced no valid ring');
  }
  return polys;
}

function normaliseLimit(value: string | undefined, uom: string | undefined, ref: string | undefined): { ft: number | null; ref: LimitRef | null; raw: string | null } {
  const raw = [value, uom, ref].filter(Boolean).join(' ') || null;
  const v = (value ?? '').trim().toUpperCase();
  const u = (uom ?? '').trim().toUpperCase();
  const r = (ref ?? '').trim().toUpperCase();
  if (v === 'GND' || v === 'SFC') return { ft: 0, ref: 'sfc', raw };
  if (v === 'UNL' || v === 'UNLIMITED') return { ft: null, ref: 'unl', raw };
  const n = Number(v);
  if (!Number.isFinite(n)) return { ft: null, ref: null, raw };
  let ft = n;
  let limitRef: LimitRef | null = null;
  if (u === 'FL') {
    ft = n * 100;
    limitRef = 'fl';
  } else if (u === 'M') {
    ft = Math.round(n * 3.28084);
  }
  if (!limitRef) {
    if (r === 'SFC') limitRef = ft === 0 ? 'sfc' : 'agl';
    else if (r === 'MSL') limitRef = 'amsl';
    else if (r === 'STD') limitRef = 'fl';
    else if (r === 'W84') limitRef = 'amsl';
    else limitRef = null;
  }
  if (u === 'FL' && n >= 999) return { ft: null, ref: 'unl', raw };
  return { ft, ref: limitRef, raw };
}

function noteTexts(node: XmlNode | undefined): string[] {
  const out: string[] = [];
  for (const note of findAll(node, 'note')) {
    const t = textOf(note);
    if (t) out.push(t.replace(/\s+\n/g, '\n').trim());
  }
  return out;
}

function extractContact(notes: string[]): string | null {
  for (const n of notes) {
    const m = /HMPPS[^@\n]*?([\w.+-]+@justice\.gov\.uk)/i.exec(n);
    if (m) return `HMPPS (${m[1]})`;
  }
  for (const n of notes) {
    const m = /Contact:\s*([^\n]+)/i.exec(n);
    if (m) return m[1].trim().replace(/\.$/, '');
  }
  for (const n of notes) {
    const m = /(?:Tel|Telephone|Phone)[:\s]+([+\d][\d\s-]{7,})/i.exec(n);
    if (m) return m[0].trim();
  }
  for (const n of notes) {
    if (/ATC|Air Traffic|permission/i.test(n) && /AD 2\.2/.test(n)) return 'the aerodrome ATC/operator (see UK AIP AD 2.2 for details)';
  }
  return null;
}

function icaoFor(aerodromeName: string | null, designator: string | null, name: string): string | null {
  const direct = /\b(EG[A-Z]{2})\b/.exec(`${designator ?? ''} ${name}`);
  if (direct && !/^EG[RDP]/.test(direct[1])) return direct[1];
  if (!aerodromeName) return null;
  const key = aerodromeName.toUpperCase().replace(/\s+/g, ' ').trim();
  return AERODROME_ICAO[key] ?? null;
}

export function parseAixmAirspaces(xml: string): AixmParseResult {
  const warnings: string[] = [];
  const warn = (m: string) => {
    if (warnings.length < 500) warnings.push(m);
  };
  const zones: NormalisedZone[] = [];
  let airspaces = 0;
  let dropped = 0;
  let geoBorders = 0;
  let doc: XmlNode[];
  try {
    doc = parseOrderedXml(xml);
  } catch (error) {
    return { zones, warnings: [`XML parse failed: ${(error as Error).message}`], stats: { airspaces: 0, parsed: 0, dropped: 0, geoBorders: 0 } };
  }
  const root = doc.find((n) => tagName(n) === 'AIXMBasicMessage') ?? doc[0];
  for (const member of childrenNamed(root, 'hasMember')) {
    const feature = children(member)[0];
    if (!feature) continue;
    const kind = tagName(feature);
    if (kind === 'GeoBorder') {
      geoBorders += 1;
      continue;
    }
    if (kind !== 'Airspace') continue;
    airspaces += 1;
    const localWarn = (m: string) => warn(`${pathText(findFirst(feature, 'AirspaceTimeSlice'), 'designator') ?? attr(feature, 'id') ?? 'airspace'}: ${m}`);
    try {
      // Pick the time slice: prefer BASELINE/SNAPSHOT with the highest sequence number.
      const slices = findAll(feature, 'AirspaceTimeSlice');
      const scored = slices
        .map((s) => ({ s, interp: pathText(s, 'interpretation') ?? '', seq: Number(pathText(s, 'sequenceNumber') ?? 0), corr: Number(pathText(s, 'correctionNumber') ?? 0) }))
        .filter((x) => x.interp !== 'TEMPDELTA')
        .sort((a, b) => b.seq - a.seq || b.corr - a.corr);
      const slice = scored[0]?.s ?? slices[0];
      if (!slice) {
        dropped += 1;
        localWarn('no time slice');
        continue;
      }
      const rawType = pathText(slice, 'type');
      const localType = pathText(slice, 'localType');
      const designator = pathText(slice, 'designator') ?? null;
      const name = pathText(slice, 'name') ?? designator ?? 'UNNAMED';
      if (rawType === 'COAST' || rawType === 'RIVER') continue;
      // Feature-level notes (exclude the geometry sub-tree, which carries per-point remarks).
      const featureNotes: string[] = [];
      for (const ann of childrenNamed(slice, 'annotation')) featureNotes.push(...noteTexts(ann));
      const zoneType = mapZoneType(rawType, localType, name, featureNotes.join('\n'));
      const aerodromeName = aerodromeNameOf(zoneType, name);

      const components = findAll(slice, 'AirspaceGeometryComponent').sort(
        (a, b) => Number(pathText(a, 'operationSequence') ?? 0) - Number(pathText(b, 'operationSequence') ?? 0)
      );
      const polys: Polygon[] = [];
      let lower = { ft: null as number | null, ref: null as LimitRef | null, raw: null as string | null };
      let upper = { ft: null as number | null, ref: null as LimitRef | null, raw: null as string | null };
      let first = true;
      for (const comp of components) {
        const volume = findFirst(comp, 'AirspaceVolume');
        if (!volume) continue;
        if (first) {
          const up = child(volume, 'upperLimit');
          const lo = child(volume, 'lowerLimit');
          upper = normaliseLimit(textOf(up), up ? attr(up, 'uom') : undefined, pathText(volume, 'upperLimitReference'));
          lower = normaliseLimit(textOf(lo), lo ? attr(lo, 'uom') : undefined, pathText(volume, 'lowerLimitReference'));
          first = false;
        }
        const surface = findFirst(volume, 'Surface');
        if (!surface) {
          if (findFirst(volume, 'centreline')) localWarn('corridor (centreline) volume skipped');
          continue;
        }
        const op = pathText(comp, 'operation') ?? 'BASE';
        if (op === 'SUBTR' || op === 'INTERS') localWarn(`operation ${op} treated as union`);
        polys.push(...polygonFromSurface(surface, localWarn));
      }
      if (polys.length === 0) {
        dropped += 1;
        localWarn('no usable geometry');
        continue;
      }
      let geometry: Polygon | MultiPolygon;
      if (polys.length === 1) geometry = polys[0];
      else {
        try {
          const u = union(featureCollection(polys.map((p) => turfPolygon(p.coordinates))));
          geometry = (u?.geometry as Polygon | MultiPolygon) ?? { type: 'MultiPolygon', coordinates: polys.map((p) => p.coordinates) };
        } catch {
          geometry = { type: 'MultiPolygon', coordinates: polys.map((p) => p.coordinates) };
        }
      }
      geometry = roundGeometry(geometry);
      const c = centroid(geometry).geometry.coordinates as Position;
      if (!samePoint(c, c)) throw new Error('bad centroid');

      const activationNotes: string[] = [];
      let activationStatus: string | undefined;
      for (const act of childrenNamed(slice, 'activation')) {
        activationNotes.push(...noteTexts(act));
        activationStatus = pathText(findFirst(act, 'AirspaceActivation'), 'status') ?? activationStatus;
      }
      const activation = [activationStatus ? `status ${activationStatus}` : null, ...activationNotes].filter(Boolean).join('; ') || null;
      const contact = extractContact([...featureNotes, ...activationNotes]);
      const lifetime = findFirst(slice, 'featureLifetime');
      zones.push({
        aixmId: attr(feature, 'id') ?? null,
        designator,
        name,
        zoneType,
        rawType: [rawType, localType].filter(Boolean).join('/') || null,
        icao: icaoFor(aerodromeName, designator, name),
        aerodromeName,
        lowerFt: lower.ft,
        lowerRef: lower.ref,
        lowerRaw: lower.raw,
        upperFt: upper.ft,
        upperRef: upper.ref,
        upperRaw: upper.raw,
        activation,
        contact,
        notes: featureNotes.join('\n\n') || null,
        validFrom: pathText(lifetime, 'TimePeriod', 'beginPosition') ?? null,
        validTo: pathText(lifetime, 'TimePeriod', 'endPosition') ?? null,
        centroid: [Math.round(c[0] * 1e6) / 1e6, Math.round(c[1] * 1e6) / 1e6],
        geometry,
      });
    } catch (error) {
      dropped += 1;
      localWarn(`failed: ${(error as Error).message}`);
    }
  }
  return { zones, warnings, stats: { airspaces, parsed: zones.length, dropped, geoBorders } };
}
