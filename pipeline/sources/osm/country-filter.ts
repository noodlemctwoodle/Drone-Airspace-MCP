import booleanPointInPolygon from '@turf/boolean-point-in-polygon';
import { point } from '@turf/helpers';
import path from 'node:path';
import { stat } from 'node:fs/promises';
import { readNdjson } from '../../lib/ndjson.js';
import type { CountryPolygon } from '../countries/ons.js';

export type PointFilter = (lon: number, lat: number) => boolean;

/** A point-in-country test from the ONS boundaries; `null` when the country is not in the rows. */
export function makeCountryFilter(rows: CountryPolygon[], country: CountryPolygon['country']): PointFilter | null {
  const polys = rows.filter((r) => r.country === country).map((r) => r.geometry);
  if (polys.length === 0) return null;
  return (lon, lat) => {
    const p = point([lon, lat]);
    return polys.some((g) => booleanPointInPolygon(p, g));
  };
}

/** The same test read from `coverage.ndjson`, which the `countries` source writes earlier in the build. */
export async function loadCountryFilter(normalisedDir: string, country: CountryPolygon['country']): Promise<PointFilter | null> {
  const file = path.join(normalisedDir, 'coverage.ndjson');
  if (!(await stat(file).then(() => true, () => false))) return null;
  const rows: CountryPolygon[] = [];
  for await (const r of readNdjson<CountryPolygon>(file)) rows.push(r);
  return makeCountryFilter(rows, country);
}
