import type { Position } from '../../../src/types.js';

export interface KmlZone {
  name: string;
  designator: string | null;
  rings: Position[][];
  description: string;
}

/**
 * The NATS KML is only used for cross-checking the AIXM parse, so a light
 * regex reader is enough: one Placemark per zone, Polygon or MultiGeometry.
 */
export function parseNatsKml(kml: string): KmlZone[] {
  const out: KmlZone[] = [];
  const placemarks = kml.match(/<Placemark[\s\S]*?<\/Placemark>/g) ?? [];
  for (const pm of placemarks) {
    const name = /<name>([^<]*)<\/name>/.exec(pm)?.[1]?.trim();
    if (!name) continue;
    const coordBlocks = pm.match(/<coordinates>([\s\S]*?)<\/coordinates>/g) ?? [];
    const rings: Position[][] = [];
    for (const block of coordBlocks) {
      const inner = block.replace(/<\/?coordinates>/g, '').trim();
      const ring: Position[] = [];
      for (const tuple of inner.split(/\s+/)) {
        const [lon, lat] = tuple.split(',').map(Number);
        if (Number.isFinite(lon) && Number.isFinite(lat)) ring.push([lon, lat]);
      }
      if (ring.length >= 4) rings.push(ring);
    }
    if (rings.length === 0) continue;
    const description = /<description>([\s\S]*?)<\/description>/.exec(pm)?.[1] ?? '';
    const designator = /^(EG[A-Z0-9]+)\s/.exec(name)?.[1] ?? null;
    out.push({ name, designator, rings, description });
  }
  return out;
}
