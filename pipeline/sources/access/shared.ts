import simplify from '@turf/simplify';
import booleanValid from '@turf/boolean-valid';
import type { MultiPolygon, Polygon } from '../../../src/types.js';
import { roundGeometry } from '../../lib/geometry.js';

/** Above this size a simplified ring is kept even when the validity test fails: the raw shape would cost more than the layer is worth. */
const KEEP_SIMPLIFIED_ABOVE_BYTES = 50_000;

/**
 * Simplify a land polygon to about `metres` and round it. Small polygons keep
 * their original shape when simplification breaks validity; large ones keep
 * the simplified shape regardless, because these layers only feed
 * point-in-polygon tests and a self-touching ring costs nothing there.
 */
export function tidyLandGeometry(g: Polygon | MultiPolygon, metres = 10): Polygon | MultiPolygon {
  let geometry: Polygon | MultiPolygon = g;
  if (metres > 0) {
    try {
      const simplified = simplify(g, { tolerance: metres / 111_320, highQuality: false }) as Polygon | MultiPolygon;
      const usable = simplified.coordinates.length > 0;
      if (usable && (booleanValid(simplified) || JSON.stringify(g).length > KEEP_SIMPLIFIED_ABOVE_BYTES)) geometry = simplified;
    } catch {
      geometry = g;
    }
  }
  return roundGeometry(geometry);
}

export function isPolygonal(g: unknown): g is Polygon | MultiPolygon {
  return !!g && typeof g === 'object' && ((g as { type?: string }).type === 'Polygon' || (g as { type?: string }).type === 'MultiPolygon');
}

export function firstString(props: Record<string, unknown>, keys: string[]): string | null {
  for (const k of keys) {
    const v = props[k];
    if (typeof v === 'string' && v.trim() !== '') return v.trim();
  }
  return null;
}
