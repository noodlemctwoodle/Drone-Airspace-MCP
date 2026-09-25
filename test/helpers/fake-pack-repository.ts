import circle from '@turf/circle';
import booleanPointInPolygon from '@turf/boolean-point-in-polygon';
import booleanIntersects from '@turf/boolean-intersects';
import bboxPolygon from '@turf/bbox-polygon';
import { lineString, point } from '@turf/helpers';
import pointToLineDistance from '@turf/point-to-line-distance';
import nearestPointOnLine from '@turf/nearest-point-on-line';
import type { PackRepository, ZonesAtOptions } from '../../src/pack/repository.js';
import distance from '@turf/distance';
import type { BBox, GazetteerHit, LandRestriction, LineString, PackMeta, Parking, ParkingHit, Polygon, Position, ProwCoverage, RightOfWay, RightOfWayHit, Zone } from '../../src/types.js';

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
];

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
    { id: 'byelaws', name: 'Council byelaw seed list', url: 'https://github.com/noodlemctwoodle/Drone-Airspace-MCP', licence: 'MIT', attribution: 'Council byelaws: community-maintained list in this repository', fetchedAt: '2026-09-25T05:00:00Z', effectiveFrom: null, effectiveTo: null, version: null, featureCount: 1, notes: null },
  ],
};

export class FakePackRepository implements PackRepository {
  closed = false;
  constructor(
    private readonly zones: Zone[] = FIXTURE_ZONES,
    private readonly prow: RightOfWay[] = FIXTURE_PROW,
    private readonly restrictions = FIXTURE_RESTRICTIONS,
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
  async nearestParking(lon: number, lat: number, limitMetres = 2000, n = 5, includePrivate = false): Promise<ParkingHit[]> {
    return FIXTURE_PARKING.filter((p) => includePrivate || !(p.access && /^(private|no|customers|permit)$/.test(p.access)))
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
