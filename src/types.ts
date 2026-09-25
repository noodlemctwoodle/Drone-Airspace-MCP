import type { Geometry, LineString, MultiPolygon, Polygon, Position } from 'geojson';

export type ZoneType = 'frz' | 'prohibited' | 'restricted' | 'danger' | 'other' | 'prison';
export type LimitRef = 'sfc' | 'agl' | 'amsl' | 'fl' | 'unl';

export interface VerticalLimit {
  /** Height in feet; null for unlimited or unknown. */
  ft: number | null;
  ref: LimitRef | null;
  raw: string | null;
}

export interface Zone {
  id: number;
  sourceId: string;
  designator: string | null;
  name: string;
  zoneType: ZoneType;
  rawType: string | null;
  icao: string | null;
  aerodromeName: string | null;
  lower: VerticalLimit;
  upper: VerticalLimit;
  activation: string | null;
  contact: string | null;
  notes: string | null;
  validFrom: string | null;
  validTo: string | null;
  centroid: Position;
  geometry: Polygon | MultiPolygon;
}

export type ZoneSummary = Omit<Zone, 'geometry'>;

export type PathType = 'footpath' | 'bridleway' | 'restricted_byway' | 'boat' | 'core_path';

export interface RightOfWay {
  id: number;
  authorityCode: string;
  authorityName: string;
  attribution: string;
  sourceRef: string | null;
  pathType: PathType;
  routeNo: string | null;
  routeName: string | null;
  parish: string | null;
  lengthM: number;
  geometry: LineString;
}

export interface RightOfWayHit extends RightOfWay {
  distanceM: number;
  nearestPoint: Position;
}

export type RestrictionKind = 'landowner' | 'byelaw' | 'pspo' | 'policy' | 'access_land' | 'designation';
/** site: the polygon is the land the rule applies to; authority: a council-wide policy note carried on the council boundary. */
export type RestrictionScope = 'site' | 'authority';

export interface LandRestriction {
  id: number;
  sourceId: string;
  entryId: string | null;
  kind: RestrictionKind;
  owner: string;
  name: string;
  accessClass: string | null;
  takeoffBanned: boolean;
  landingBanned: boolean | null;
  summary: string | null;
  sourceUrl: string | null;
  lastVerified: string | null;
  scope: RestrictionScope;
}

export type Country = 'england' | 'wales' | 'scotland' | 'northern_ireland';

export type ParkingKind = 'car_park' | 'layby' | 'rest_area' | 'street_side';

export interface Parking {
  id: number;
  osmId: string | null;
  kind: ParkingKind;
  name: string | null;
  /** OSM access tag: yes, public, customers, permissive, private, no ... */
  access: string | null;
  fee: string | null;
  capacity: number | null;
  surface: string | null;
  operator: string | null;
  lon: number;
  lat: number;
}

export interface ParkingHit extends Parking {
  distanceM: number;
}
export type HazardKind = 'railway' | 'motorway' | 'trunk_road' | 'power_line' | 'helipad' | 'military';

/** A ground hazard from OpenStreetMap: a line (railway, road, power line), a point (helipad) or a polygon (military land). */
export interface Hazard {
  id: number;
  osmId: string | null;
  kind: HazardKind;
  name: string | null;
  operator: string | null;
  ref: string | null;
  /** The point itself, or the centroid of a line or polygon. */
  lon: number;
  lat: number;
}

export interface HazardHit extends Hazard {
  distanceM: number;
}

export type AdminKind = 'lad';

export interface AdminArea {
  id: number;
  code: string;
  name: string;
  kind: AdminKind;
  country: Country | null;
}

export type ProwCoverage = 'england_wales' | 'scotland' | 'northern_ireland' | 'unknown';

export interface GazetteerHit {
  id: number;
  name: string;
  icao: string | null;
  kind: 'aerodrome' | 'zone';
  lon: number;
  lat: number;
  zoneId: number | null;
}

export interface PackSource {
  id: string;
  name: string;
  url: string;
  licence: string;
  attribution: string;
  fetchedAt: string;
  effectiveFrom: string | null;
  effectiveTo: string | null;
  version: string | null;
  featureCount: number;
  notes: string | null;
}

export interface PackMeta {
  schemaVersion: number;
  packTag: string;
  builtAt: string;
  buildCommit: string | null;
  region: string;
  bbox: [number, number, number, number] | null;
  airacEffective: string | null;
  airacNext: string | null;
  counts: Record<string, number>;
  attribution: string[];
  licences: Record<string, string>;
  warnings: string[];
  sources: PackSource[];
}

export type GeocodeSource = 'postcodes.io' | 'os_names' | 'nominatim' | 'input';

export interface GeocodeCandidate {
  name: string;
  lat: number;
  lon: number;
  source: GeocodeSource;
  confidence: number;
  bbox?: [number, number, number, number];
  type?: string;
}

export interface GeocodeResult {
  query: string;
  usedQuery: string;
  usedFallback: boolean;
  candidates: GeocodeCandidate[];
  providersTried: string[];
}

export interface ResolvedLocation {
  name: string;
  lat: number;
  lon: number;
  source: GeocodeSource;
  resolvedFrom?: { original: string; used: string };
  alternatives?: GeocodeCandidate[];
}

export type LocationResolution =
  | { status: 'resolved'; location: ResolvedLocation }
  | { status: 'ambiguous'; query: string; candidates: GeocodeCandidate[] }
  | { status: 'not_found'; query: string };

export interface Notam {
  id: string;
  series: string | null;
  number: string | null;
  year: string | null;
  fir: string | null;
  qCode: string | null;
  traffic: string | null;
  purpose: string | null;
  scope: string | null;
  lowerFl: number | null;
  upperFl: number | null;
  centre: Position | null;
  radiusNm: number | null;
  radiusKm: number | null;
  centreSource: 'itemE' | 'qline' | null;
  wholeFir: boolean;
  validFrom: Date | null;
  validTo: Date | 'PERM' | null;
  estimated: boolean;
  schedule: string | null;
  itemA: string | null;
  itemE: string;
  itemF: string | null;
  itemG: string | null;
  cancelled: boolean;
}

export interface NotamHit extends Notam {
  distanceKm: number;
}

export type Severity = 0 | 1 | 2 | 3 | 4 | 5;

export interface Verdict {
  severity: Severity;
  line: string;
  zoneId: number | null;
  landownerLine: string | null;
}

export type ToolResponse = {
  content: Array<{ type: 'text'; text: string }>;
  _meta?: Record<string, unknown>;
  isError?: boolean;
};

export type OutputFormat = 'text' | 'json' | 'brief';

export type BBox = [number, number, number, number];
export type { Geometry, LineString, MultiPolygon, Polygon, Position };
