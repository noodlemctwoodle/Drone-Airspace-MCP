import { z } from 'zod';

export const UK_BBOX = { west: -9, south: 49.5, east: 2.5, north: 61 } as const;

export const formatArg = z
  .enum(['text', 'json', 'brief'])
  .default('text')
  .describe('text for a readable report (default), json for structured output, brief for two or three spoken-friendly sentences (use in voice conversations).');

export const placeArg = z
  .string()
  .min(1)
  .max(200)
  .describe('Place name, postcode or landmark in the UK, e.g. "Tyndale Monument", "BS1 6QF", "Durdle Door". Use lat/lon instead if you already have coordinates.');

export const latArg = z.number().min(UK_BBOX.south).max(UK_BBOX.north).describe('Latitude in decimal degrees (WGS84).');
export const lonArg = z.number().min(UK_BBOX.west).max(UK_BBOX.east).describe('Longitude in decimal degrees (WGS84), negative west of Greenwich.');

/** Shared location input: `place` or both `lat` and `lon`, never both forms. */
export const locationInput = {
  place: placeArg.optional(),
  lat: latArg.optional(),
  lon: lonArg.optional(),
};

export interface LocationArgs {
  place?: string;
  lat?: number;
  lon?: number;
}

export function validateLocationArgs(args: LocationArgs): string | null {
  const hasPlace = typeof args.place === 'string' && args.place.trim().length > 0;
  const hasLat = typeof args.lat === 'number';
  const hasLon = typeof args.lon === 'number';
  if (hasPlace && (hasLat || hasLon)) return 'Give either place or lat and lon, not both.';
  if (!hasPlace && !(hasLat && hasLon)) return 'Give a place name, or both lat and lon.';
  return null;
}

export const dateArg = z
  .string()
  .max(40)
  .optional()
  .describe('ISO 8601 date or date-time (UTC assumed when no offset). Defaults to now.');

export const waypointSchema = z.union([
  z.tuple([lonArg, latArg]),
  z.string().min(1).max(200),
]);

export const bboxSchema = z
  .tuple([lonArg, latArg, lonArg, latArg])
  .describe('[west, south, east, north] in decimal degrees.');

export const polygonSchema = z.object({
  type: z.literal('Polygon'),
  coordinates: z.array(z.array(z.tuple([z.number(), z.number()]).rest(z.number())).min(4)).min(1),
});
