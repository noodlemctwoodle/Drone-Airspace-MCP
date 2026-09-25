import booleanIntersects from '@turf/boolean-intersects';
import { polygon } from '@turf/helpers';
import area from '@turf/area';
import distance from '@turf/distance';
import { point } from '@turf/helpers';
import type { BBox, LineString, Polygon, Position, Zone } from '../../types.js';
import type { PackRepository } from '../../pack/repository.js';
import { bboxOfGeometry } from '../../pack/geometry.js';
import { crossingOf, type Crossing } from './geometry.js';

export interface RouteHit {
  zone: Zone;
  crossing: Crossing;
}

export interface AerodromeZone {
  zone: Zone;
  centre: Position;
  radiusKm: number;
  bbox: BBox;
  areaKm2: number;
}

export interface AerodromeMatch {
  name: string;
  icao: string | null;
  /** The FRZ circle when present, otherwise the first component. */
  primary: AerodromeZone;
  components: AerodromeZone[];
  bbox: BBox;
  areaKm2: number;
}

export class AirspaceEngine {
  constructor(private readonly pack: PackRepository) {}

  atPoint(lon: number, lat: number): Promise<Zone[]> {
    return this.pack.zonesAt(lon, lat);
  }

  async alongRoute(line: LineString): Promise<RouteHit[]> {
    const candidates = await this.pack.zonesAlongLine(line);
    const hits: RouteHit[] = [];
    const seen = new Set<number>();
    for (const zone of candidates) {
      if (seen.has(zone.id)) continue;
      const crossing = crossingOf(line, zone.geometry);
      if (!crossing) continue;
      seen.add(zone.id);
      hits.push({ zone, crossing });
    }
    hits.sort((a, b) => a.crossing.entersAtKm - b.crossing.entersAtKm);
    return hits;
  }

  async inArea(poly: Polygon): Promise<Zone[]> {
    const box = bboxOfGeometry(poly);
    const feature = polygon(poly.coordinates);
    return (await this.pack.zonesInBbox(box)).filter((z) => {
      try {
        return booleanIntersects(feature, z.geometry);
      } catch {
        return false;
      }
    });
  }

  describe(zone: Zone): AerodromeZone {
    const box = bboxOfGeometry(zone.geometry);
    const centre = zone.centroid;
    let radiusKm = 0;
    const rings = zone.geometry.type === 'Polygon' ? zone.geometry.coordinates : zone.geometry.coordinates.flat();
    for (const ring of rings) {
      for (const pos of ring) {
        const d = distance(point(centre), point(pos), { units: 'kilometers' });
        if (d > radiusKm) radiusKm = d;
      }
    }
    let areaKm2 = 0;
    try {
      areaKm2 = area(zone.geometry) / 1_000_000;
    } catch {
      areaKm2 = 0;
    }
    return { zone, centre, radiusKm, bbox: box, areaKm2 };
  }

  async aerodrome(nameOrIcao: string, n = 5): Promise<AerodromeMatch[]> {
    const hits = await this.pack.findAerodrome(nameOrIcao, n * 2);
    const out: AerodromeMatch[] = [];
    const seen = new Set<string>();
    for (const hit of hits) {
      if (hit.zoneId === null) continue;
      const primaryZone = await this.pack.zoneById(hit.zoneId);
      if (!primaryZone) continue;
      const key = hit.kind === 'aerodrome' ? `a:${hit.name}` : `z:${primaryZone.id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const zones = hit.kind === 'aerodrome' ? await this.pack.zonesByAerodrome(hit.name) : [primaryZone];
      const components = (zones.length > 0 ? zones : [primaryZone]).map((z) => this.describe(z));
      const primary = components.find((c) => c.zone.id === primaryZone.id) ?? components[0];
      const bbox: BBox = [
        Math.min(...components.map((c) => c.bbox[0])),
        Math.min(...components.map((c) => c.bbox[1])),
        Math.max(...components.map((c) => c.bbox[2])),
        Math.max(...components.map((c) => c.bbox[3])),
      ];
      out.push({ name: hit.name, icao: hit.icao ?? primaryZone.icao, primary, components, bbox, areaKm2: components.reduce((a, c) => a + c.areaKm2, 0) });
      if (out.length >= n) break;
    }
    return out;
  }
}
