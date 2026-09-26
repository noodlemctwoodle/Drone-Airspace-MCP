import circle from '@turf/circle';
import booleanPointInPolygon from '@turf/boolean-point-in-polygon';
import booleanIntersects from '@turf/boolean-intersects';
import bboxPolygon from '@turf/bbox-polygon';
import { lineString, point } from '@turf/helpers';
import pointToLineDistance from '@turf/point-to-line-distance';
import nearestPointOnLine from '@turf/nearest-point-on-line';
import type { PackRepository, ZonesAtOptions } from '../../src/pack/repository.js';
import distance from '@turf/distance';
import type { AdminArea, BBox, GazetteerHit, Geometry, Hazard, HazardHit, LandRestriction, LineString, PackMeta, Parking, ParkingHit, Polygon, Position, ProwCoverage, RightOfWay, RightOfWayHit, Zone } from '../../src/types.js';

const square = (w: number, s: number, e: number, n: number): Polygon => ({
  type: 'Polygon',
  coordinates: [[[w, s], [e, s], [e, n], [w, n], [w, s]]],
});

/** Bristol-ish test world: an FRZ circle, a prohibited square, a danger area, a high-level zone. */
export const FIXTURE_ZONES: Zone[] = [
  {
    id: 1,
    sourceId: 'nats_uas',
    designator: 'EGGD',
    name: 'BRISTOL FRZ',
    zoneType: 'frz',
    rawType: 'OTHER:FRZ',
    icao: 'EGGD',
    aerodromeName: 'BRISTOL',
    lower: { ft: 0, ref: 'sfc', raw: 'SFC' },
    upper: { ft: 2000, ref: 'amsl', raw: '2000 FT AMSL' },
    activation: 'H24',
    contact: 'Bristol ATC 01275 473 500',
    notes: null,
    validFrom: null,
    validTo: null,
    centroid: [-2.7191, 51.3827],
    geometry: circle([-2.7191, 51.3827], 4.6, { steps: 64, units: 'kilometers' }).geometry,
  },
  {
    id: 2,
    sourceId: 'nats_uas',
    designator: 'EG P106',
    name: 'HINKLEY POINT',
    zoneType: 'prohibited',
    rawType: 'P',
    icao: null,
    aerodromeName: null,
    lower: { ft: 0, ref: 'sfc', raw: 'SFC' },
    upper: { ft: 2000, ref: 'amsl', raw: '2000 FT AMSL' },
    activation: null,
    contact: null,
    notes: 'Nuclear site',
    validFrom: null,
    validTo: null,
    centroid: [-3.13, 51.208],
    geometry: square(-3.15, 51.19, -3.11, 51.225),
  },
  {
    id: 3,
    sourceId: 'nats_uas',
    designator: 'EG D118',
    name: 'PENDINE',
    zoneType: 'danger',
    rawType: 'D',
    icao: null,
    aerodromeName: null,
    lower: { ft: 0, ref: 'sfc', raw: 'SFC' },
    upper: { ft: 5500, ref: 'fl', raw: 'FL55' },
    activation: 'By NOTAM',
    contact: 'Pendine Range 01994 452 200',
    notes: null,
    validFrom: null,
    validTo: null,
    centroid: [-4.55, 51.7],
    geometry: square(-4.65, 51.65, -4.45, 51.75),
  },
  {
    id: 4,
    sourceId: 'nats_uas',
    designator: 'EG R999',
    name: 'HIGH LEVEL TEST',
    zoneType: 'restricted',
    rawType: 'R',
    icao: null,
    aerodromeName: null,
    lower: { ft: 6500, ref: 'fl', raw: 'FL65' },
    upper: { ft: 24500, ref: 'fl', raw: 'FL245' },
    activation: null,
    contact: null,
    notes: null,
    validFrom: null,
    validTo: null,
    centroid: [-2.7191, 51.3827],
    geometry: square(-3.5, 51.0, -2.0, 51.8),
  },
  {
    id: 5,
    sourceId: 'nats_uas',
    designator: 'EGR1U136',
    name: 'HMP PORTLAND',
    zoneType: 'prison',
    rawType: 'R/FRZ',
    icao: null,
    aerodromeName: null,
    lower: { ft: 0, ref: 'sfc', raw: '0 FT SFC' },
    upper: { ft: 700, ref: 'amsl', raw: '700 FT MSL' },
    activation: null,
    contact: 'HMPPS (drone.RFZapplication@justice.gov.uk)',
    notes: 'Unmanned aircraft flight not permitted unless permission has been granted by HMPPS. HMPPS email: drone.RFZapplication@justice.gov.uk. SI 2023/1101',
    validFrom: null,
    validTo: null,
    centroid: [-2.4327, 50.5487],
    geometry: square(-2.44, 50.543, -2.425, 50.554),
  },
];

export const FIXTURE_CORE_PATH: RightOfWay = {
  id: 150,
  authorityCode: 'S-STIRLING',
  authorityName: 'Stirling Council',
  attribution: 'Core paths: Stirling Council core path plan via the Improvement Service Spatial Hub, Open Government Licence v3. Contains OS data © Crown copyright and database right 2026.',
  sourceRef: 'pub_cpth.2',
  pathType: 'core_path',
  routeNo: 'ST-7',
  routeName: null,
  parish: null,
  lengthM: 2500,
  geometry: { type: 'LineString', coordinates: [[-4.01, 56.5], [-3.99, 56.5], [-3.97, 56.51]] },
};

/** Paths and parking that a spot search must reject: inside the Bristol FRZ and inside the Test Park byelaw circle. */
export const FIXTURE_EXCLUDED_SPOTS: { paths: RightOfWay[]; parking: Parking[] } = {
  paths: [
    { id: 102, authorityCode: 'NS', authorityName: 'North Somerset', attribution: 'Rights of way data provided by the council of North Somerset under the Open Government Licence.', sourceRef: 'NS-1', pathType: 'footpath', routeNo: 'FP 40', routeName: null, parish: 'Wrington', lengthM: 600, geometry: { type: 'LineString', coordinates: [[-2.725, 51.383], [-2.719, 51.3827], [-2.713, 51.382]] } },
    { id: 103, authorityCode: 'BS', authorityName: 'Bristol', attribution: 'Rights of way data provided by the council of Bristol under the Open Government Licence.', sourceRef: 'BS-1', pathType: 'footpath', routeNo: 'FP 9', routeName: null, parish: null, lengthM: 300, geometry: { type: 'LineString', coordinates: [[-2.602, 51.455], [-2.598, 51.455]] } },
  ],
  parking: [{ id: 303, osmId: 'w303', kind: 'car_park', name: 'Airport long stay', access: null, fee: 'yes', capacity: 2000, surface: null, operator: null, lon: -2.72, lat: 51.384 }],
};

export const FIXTURE_PROW: RightOfWay[] = [
  {
    id: 100,
    authorityCode: 'DT',
    authorityName: 'Dorset',
    attribution: 'Rights of way data provided by the council of Dorset under the Open Government Licence. Contains Ordnance Survey data © Crown copyright and database right 2026.',
    sourceRef: 'DT-1',
    pathType: 'footpath',
    routeNo: 'FP 12',
    routeName: 'South West Coast Path',
    parish: 'West Lulworth',
    lengthM: 900,
    geometry: { type: 'LineString', coordinates: [[-2.283, 50.621], [-2.277, 50.6215], [-2.271, 50.622]] },
  },
  {
    id: 101,
    authorityCode: 'DT',
    authorityName: 'Dorset',
    attribution: 'Rights of way data provided by the council of Dorset under the Open Government Licence. Contains Ordnance Survey data © Crown copyright and database right 2026.',
    sourceRef: 'DT-2',
    pathType: 'bridleway',
    routeNo: 'BR 3',
    routeName: null,
    parish: 'West Lulworth',
    lengthM: 1500,
    geometry: { type: 'LineString', coordinates: [[-2.29, 50.63], [-2.27, 50.632]] },
  },
];

export const FIXTURE_RESTRICTIONS: Array<LandRestriction & { geometry: Polygon }> = [
  {
    id: 200,
    sourceId: 'nt_always_open',
    entryId: '1',
    kind: 'landowner',
    owner: 'National Trust',
    name: 'Brownsea Island',
    accessClass: 'always_open',
    takeoffBanned: true,
    landingBanned: true,
    summary: 'National Trust byelaws prohibit taking off or landing unmanned aircraft on Trust land without permission.',
    sourceUrl: 'https://www.nationaltrust.org.uk/who-we-are/about-us/flying-drones-at-our-places',
    lastVerified: '2026-09-25',
    scope: 'site',
    geometry: square(-1.985, 50.685, -1.96, 50.697),
  },
  {
    id: 201,
    sourceId: 'byelaws',
    entryId: 'test-park',
    kind: 'byelaw',
    owner: 'Test City Council',
    name: 'Test Park',
    accessClass: null,
    takeoffBanned: true,
    landingBanned: null,
    summary: 'Byelaw 12 prohibits the flying of model aircraft and drones in the park.',
    sourceUrl: 'https://example.org/byelaws',
    lastVerified: '2026-09-01',
    scope: 'site',
    geometry: square(-2.61, 51.45, -2.59, 51.46),
  },
];

const COVERAGE: Array<{ country: 'england' | 'wales' | 'scotland' | 'northern_ireland'; geometry: Polygon }> = [
  { country: 'england', geometry: square(-6.5, 49.8, 1.9, 55.8) },
  { country: 'scotland', geometry: square(-8.7, 55.8, -0.5, 60.9) },
];

export const FIXTURE_PARKING: Parking[] = [
  { id: 300, osmId: 'w1', kind: 'car_park', name: 'Durdle Door Car Park', access: null, fee: 'yes', capacity: 400, surface: 'gravel', operator: 'Lulworth Estate', lon: -2.2765, lat: 50.6227 },
  { id: 301, osmId: 'n2', kind: 'layby', name: null, access: null, fee: 'no', capacity: null, surface: null, operator: null, lon: -2.29, lat: 50.63 },
  { id: 302, osmId: 'w3', kind: 'car_park', name: 'Staff Only', access: 'private', fee: null, capacity: null, surface: null, operator: null, lon: -2.277, lat: 50.622 },
];

export const FIXTURE_META: PackMeta = {
  schemaVersion: 1,
  packTag: 'pack-20260903-test',
  builtAt: '2026-09-25T06:00:00Z',
  buildCommit: 'abc123',
  region: 'test',
  bbox: [-6.5, 49.8, 1.9, 60.9],
  airacEffective: '2026-09-03',
  airacNext: '2026-10-01',
  counts: { zones: 4, rights_of_way: 2, land_restrictions: 2, gazetteer: 1, parking: 3 },
  attribution: ['Airspace: NATS UK AIP ENR 5.1 UAS dataset © NATS Limited'],
  licences: { nats_uas: 'NATS-unspecified', rowmaps: 'OGL-3.0' },
  warnings: [],
  sources: [
    { id: 'nats_uas', name: 'NATS UAS Flight Restrictions', url: 'https://nats-uk.ead-it.com/', licence: 'NATS-unspecified', attribution: 'Airspace: NATS UK AIP ENR 5.1 UAS dataset © NATS Limited', fetchedAt: '2026-09-25T05:00:00Z', effectiveFrom: '2026-09-03', effectiveTo: '2026-09-30', version: '20260903', featureCount: 4, notes: null },
    { id: 'rowmaps', name: 'rowmaps rights of way', url: 'https://www.rowmaps.com/', licence: 'OGL-3.0', attribution: 'Rights of way: council open data via rowmaps.com (OGL v3). Contains Ordnance Survey data © Crown copyright and database right 2026.', fetchedAt: '2026-09-25T05:00:00Z', effectiveFrom: null, effectiveTo: null, version: null, featureCount: 2, notes: null },
    { id: 'nt_always_open', name: 'National Trust Land - Always Open', url: 'https://open-data-national-trust.hub.arcgis.com/', licence: 'OGL-3.0', attribution: 'National Trust Open Data (OGL v3)', fetchedAt: '2026-09-25T05:00:00Z', effectiveFrom: null, effectiveTo: null, version: null, featureCount: 1, notes: null },
    { id: 'osm_parking', name: 'OpenStreetMap parking', url: 'https://download.geofabrik.de/', licence: 'ODbL-1.0', attribution: 'Parking and laybys: © OpenStreetMap contributors (ODbL)', fetchedAt: '2026-09-25T05:00:00Z', effectiveFrom: null, effectiveTo: null, version: null, featureCount: 3, notes: null },
    { id: 'ne_crow_access', name: 'CRoW Act 2000 Access Layer (England)', url: 'https://naturalengland-defra.opendata.arcgis.com/', licence: 'OGL-3.0', attribution: 'Open access land: Natural England open data, Open Government Licence v3', fetchedAt: '2026-09-25T05:00:00Z', effectiveFrom: null, effectiveTo: null, version: '2026-07-21', featureCount: 1, notes: null },
    { id: 'ne_sssi', name: 'Sites of Special Scientific Interest (England)', url: 'https://naturalengland-defra.opendata.arcgis.com/', licence: 'OGL-3.0', attribution: 'SSSI boundaries: Natural England open data, Open Government Licence v3', fetchedAt: '2026-09-25T05:00:00Z', effectiveFrom: null, effectiveTo: null, version: '2026-08-15', featureCount: 1, notes: null },
    { id: 'nrw_open_country', name: 'NRW Open Access: Open Country', url: 'https://datamap.gov.wales/', licence: 'OGL-3.0', attribution: 'Open access land: Natural Resources Wales open data via DataMapWales, Open Government Licence v3', fetchedAt: '2026-09-25T05:00:00Z', effectiveFrom: null, effectiveTo: null, version: null, featureCount: 0, notes: null },
    { id: 'is_core_paths', name: 'Core Paths - Scotland', url: 'https://data.spatialhub.scot/dataset/core_paths-is', licence: 'OGL-3.0', attribution: 'Core paths: Scottish council core path plans via the Improvement Service Spatial Hub, Open Government Licence v3', fetchedAt: '2026-09-25T05:00:00Z', effectiveFrom: null, effectiveTo: null, version: null, featureCount: 1, notes: null },
    { id: 'byelaws', name: 'Council byelaw seed list', url: 'https://github.com/noodlemctwoodle/fpv-airspace', licence: 'MIT', attribution: 'Council byelaws: community-maintained list in this repository', fetchedAt: '2026-09-25T05:00:00Z', effectiveFrom: null, effectiveTo: null, version: null, featureCount: 1, notes: null },
  ],
};

/** Hazards around Durdle Door, all more than 200 m from the test point so briefing tests stay clear. */
/** A council-wide policy note carried on the Dorset boundary; never a ban. */
export const FIXTURE_COUNCIL_POLICY: LandRestriction & { geometry: Polygon } = {
  id: 3,
  sourceId: 'byelaws',
  entryId: 'dorset-policy',
  kind: 'policy',
  owner: 'Dorset Council',
  name: 'Dorset',
  accessClass: null,
  takeoffBanned: true,
  landingBanned: true,
  summary: 'Dorset Council does not permit drone take-off from parks and open spaces it manages without written consent.',
  sourceUrl: 'https://example.org/dorset-drones',
  lastVerified: '2026-09-01',
  scope: 'authority',
  geometry: square(-2.6, 50.5, -1.9, 50.9),
};

/** Open access land and an SSSI on the cliffs west of Durdle Door; the test point at Durdle Door itself is inside neither. */
export const FIXTURE_ACCESS: Array<LandRestriction & { geometry: Polygon }> = [
  { id: 4, sourceId: 'ne_crow_access', entryId: '7001', kind: 'access_land', owner: 'Natural England', name: 'Open country', accessClass: 'open_country', takeoffBanned: false, landingBanned: false, summary: 'Open access land under the CRoW Act 2000: the public may walk here off paths. The access right does not itself ban take-off, but landowner byelaws and any local restriction still apply.', sourceUrl: 'https://www.gov.uk/right-of-way-open-access-land/use-your-right-to-roam', lastVerified: '2026-09-01', scope: 'site', geometry: square(-2.32, 50.61, -2.29, 50.63) },
  { id: 5, sourceId: 'ne_sssi', entryId: '1000000', kind: 'designation', owner: 'Natural England', name: 'Bat\'s Head to Durdle Door', accessClass: 'sssi', takeoffBanned: false, landingBanned: null, summary: 'Site of Special Scientific Interest: intentionally or recklessly disturbing protected wildlife is an offence.', sourceUrl: 'https://designatedsites.naturalengland.org.uk/', lastVerified: '2026-09-01', scope: 'site', geometry: square(-2.32, 50.61, -2.29, 50.63) },
];

export const FIXTURE_HAZARDS: Array<Hazard & { geometry: Geometry }> = [
  { id: 900, osmId: 'w900', kind: 'power_line', name: null, operator: 'SSEN', ref: null, lon: -2.277, lat: 50.6265, geometry: { type: 'LineString', coordinates: [[-2.29, 50.6265], [-2.264, 50.6265]] } },
  { id: 901, osmId: 'n901', kind: 'helipad', name: 'Lulworth Camp helipad', operator: 'MOD', ref: null, lon: -2.25, lat: 50.63, geometry: { type: 'Point', coordinates: [-2.25, 50.63] } },
  { id: 902, osmId: 'w902', kind: 'railway', name: 'Great Western Main Line', operator: 'Network Rail', ref: null, lon: -2.5813, lat: 51.449, geometry: { type: 'LineString', coordinates: [[-2.6, 51.449], [-2.56, 51.449]] } },
];

export const FIXTURE_ADMIN_AREAS: Array<AdminArea & { geometry: Polygon }> = [
  { id: 1, code: 'E06000059', name: 'Dorset', kind: 'lad', country: 'england', geometry: square(-2.6, 50.5, -1.9, 50.9) },
  { id: 2, code: 'E06000023', name: 'Bristol, City of', kind: 'lad', country: 'england', geometry: square(-2.75, 51.38, -2.5, 51.55) },
];

export class FakePackRepository implements PackRepository {
  closed = false;
  private readonly hazards = FIXTURE_HAZARDS;
  private readonly adminAreas = FIXTURE_ADMIN_AREAS;
  constructor(
    private readonly zones: Zone[] = FIXTURE_ZONES,
    private readonly prow: RightOfWay[] = [...FIXTURE_PROW, FIXTURE_CORE_PATH, ...FIXTURE_EXCLUDED_SPOTS.paths],
    private readonly restrictions: Array<LandRestriction & { geometry: Polygon }> = [...FIXTURE_RESTRICTIONS, FIXTURE_COUNCIL_POLICY, ...FIXTURE_ACCESS],
    private readonly metaValue: PackMeta = FIXTURE_META
  ) {}

  async meta(): Promise<PackMeta> {
    return this.metaValue;
  }
  async zonesAt(lon: number, lat: number, opts: ZonesAtOptions = {}): Promise<Zone[]> {
    const pt = point([lon, lat]);
    return this.zones.filter((z) => (!opts.types || opts.types.includes(z.zoneType)) && booleanPointInPolygon(pt, z.geometry));
  }
  async zonesInBbox(bbox: BBox): Promise<Zone[]> {
    const poly = bboxPolygon(bbox);
    return this.zones.filter((z) => booleanIntersects(poly, z.geometry));
  }
  async zonesAlongLine(line: LineString): Promise<Zone[]> {
    const f = lineString(line.coordinates);
    return this.zones.filter((z) => booleanIntersects(f, z.geometry));
  }
  async zoneById(id: number): Promise<Zone | undefined> {
    return this.zones.find((z) => z.id === id);
  }
  async nearestRightsOfWay(lon: number, lat: number, limitMetres = 500, n = 5): Promise<RightOfWayHit[]> {
    const pt = point([lon, lat]);
    return this.prow
      .map((p) => {
        const f = lineString(p.geometry.coordinates);
        const distanceM = pointToLineDistance(pt, f, { units: 'meters' });
        return { ...p, distanceM: Math.round(distanceM), nearestPoint: nearestPointOnLine(f, pt).geometry.coordinates as Position };
      })
      .filter((p) => p.distanceM <= limitMetres)
      .sort((a, b) => a.distanceM - b.distanceM)
      .slice(0, n);
  }
  async prowCoverageAt(lon: number, lat: number): Promise<ProwCoverage> {
    const pt = point([lon, lat]);
    for (const c of COVERAGE) {
      if (booleanPointInPolygon(pt, c.geometry)) return c.country === 'england' || c.country === 'wales' ? 'england_wales' : c.country;
    }
    return 'unknown';
  }
  async landRestrictionsAt(lon: number, lat: number): Promise<LandRestriction[]> {
    const pt = point([lon, lat]);
    return this.restrictions.filter((r) => booleanPointInPolygon(pt, r.geometry)).map(({ geometry: _g, ...rest }) => rest);
  }
  async findAerodrome(nameOrIcao: string, n = 5): Promise<GazetteerHit[]> {
    const q = nameOrIcao.trim().toLowerCase();
    return this.zones
      .filter((z) => z.icao && (z.icao.toLowerCase() === q || (z.aerodromeName ?? '').toLowerCase().includes(q)))
      .slice(0, n)
      .map((z) => ({ id: z.id, name: z.aerodromeName ?? z.name, icao: z.icao, kind: 'aerodrome', lon: z.centroid[0], lat: z.centroid[1], zoneId: z.id }));
  }
  async landRestrictionsInBbox(bbox: BBox): Promise<Array<LandRestriction & { geometry: Polygon }>> {
    const poly = bboxPolygon(bbox);
    return this.restrictions.filter((r) => booleanIntersects(poly, r.geometry));
  }
  async hazardsNear(lon: number, lat: number, limitMetres = 500, n = 12): Promise<HazardHit[]> {
    const here = point([lon, lat]);
    return this.hazards
      .map((h) => ({ ...h, distanceM: Math.round(h.geometry.type === 'LineString' ? pointToLineDistance(here, lineString(h.geometry.coordinates), { units: 'meters' }) : distance(here, point([h.lon, h.lat]), { units: 'meters' })) }))
      .filter((h) => h.distanceM <= limitMetres)
      .sort((a, b) => a.distanceM - b.distanceM)
      .slice(0, n)
      .map(({ geometry: _g, ...rest }) => rest);
  }
  async hazardsInBbox(bbox: BBox, _limit?: number, kinds?: readonly string[]): Promise<Array<Hazard & { geometry: Geometry }>> {
    const poly = bboxPolygon(bbox);
    return this.hazards.filter((h) => booleanIntersects(poly, h.geometry) && (!kinds || kinds.length === 0 || kinds.includes(h.kind)));
  }
  async adminAreaAt(lon: number, lat: number): Promise<AdminArea | null> {
    const here = point([lon, lat]);
    const a = this.adminAreas.find((x) => booleanPointInPolygon(here, x.geometry)) ?? this.adminAreas.find((x) => pointToLineDistance(here, lineString(x.geometry.coordinates[0]), { units: 'meters' }) <= 1000);
    return a ? { id: a.id, code: a.code, name: a.name, kind: a.kind, country: a.country } : null;
  }
  async nearestParking(lon: number, lat: number, limitMetres = 2000, n = 5, includePrivate = false): Promise<ParkingHit[]> {
    return [...FIXTURE_PARKING, ...FIXTURE_EXCLUDED_SPOTS.parking].filter((p) => includePrivate || !(p.access && /^(private|no|customers|permit)$/.test(p.access)))
      .map((p) => ({ ...p, distanceM: Math.round(distance([lon, lat], [p.lon, p.lat], { units: 'meters' })) }))
      .filter((p) => p.distanceM <= limitMetres)
      .sort((a, b) => a.distanceM - b.distanceM)
      .slice(0, n);
  }
  async zonesByAerodrome(aerodromeName: string): Promise<Zone[]> {
    return this.zones.filter((z) => (z.aerodromeName ?? '').toLowerCase() === aerodromeName.toLowerCase());
  }
  close(): void {
    this.closed = true;
  }
}
