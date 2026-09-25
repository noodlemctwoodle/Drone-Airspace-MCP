import { z, type ZodRawShape } from 'zod';
import type { ToolName } from './names.js';
import { bboxSchema, dateArg, formatArg, locationInput, polygonSchema, waypointSchema } from './schemas.js';

export interface ToolDefinition {
  name: ToolName;
  description: string;
  inputSchema: ZodRawShape;
  annotations: { readOnlyHint: true; openWorldHint: boolean; title: string };
}

const includeAbove120m = z
  .boolean()
  .default(false)
  .describe('Also list zones whose lower limit is above 400 ft AGL and so do not affect flying below 120 m.');

export const toolDefinitions: ToolDefinition[] = [
  {
    name: 'check_location',
    description:
      'Check permanent UK airspace restrictions at a single point for drone flying. Give a place name or postcode, or lat/lon. ' +
      'Returns a one-line verdict, then every zone containing the point (aerodrome FRZ, prohibited, restricted, danger, other) ' +
      'with vertical limits, activation notes and contact, and any landowner rule at the point. ' +
      'Does not include NOTAMs; call check_notams for temporary restrictions.',
    inputSchema: { ...locationInput, include_above_120m: includeAbove120m, format: formatArg },
    annotations: { readOnlyHint: true, openWorldHint: true, title: 'Check airspace at a location' },
  },
  {
    name: 'get_aerodrome_zone',
    description:
      "Look up a UK aerodrome's flight restriction zone (FRZ) by name or ICAO code, e.g. \"Bristol\" or \"EGGD\". " +
      'Returns the zone centre, approximate radius, bounding box, vertical limits and contact, optionally with the GeoJSON geometry.',
    inputSchema: {
      aerodrome: z.string().min(2).max(80).describe('Aerodrome name or four-letter ICAO code (UK codes start with EG).'),
      include_geojson: z.boolean().default(false).describe('Include the full zone geometry as GeoJSON.'),
      format: formatArg,
    },
    annotations: { readOnlyHint: true, openWorldHint: false, title: 'Look up an aerodrome FRZ' },
  },
  {
    name: 'check_notams',
    description:
      'Check temporary airspace restrictions (NOTAMs) from the NATS UK pre-flight bulletin that cover a point, optionally within a radius and on a given date. ' +
      'Returns each NOTAM with validity, radius and full text, sorted by distance. NOTAMs without usable coordinates are listed separately so nothing is silently dropped. ' +
      'Informational only; not a substitute for an official NATS pre-flight briefing.',
    inputSchema: {
      ...locationInput,
      radius_km: z.number().min(0).max(50).default(0).describe('Also list NOTAMs whose circle comes within this many km of the point. 0 = only NOTAMs covering the point.'),
      date: dateArg,
      max_results: z.number().int().min(1).max(50).default(20),
      format: formatArg,
    },
    annotations: { readOnlyHint: true, openWorldHint: true, title: 'Check NOTAMs at a location' },
  },
  {
    name: 'check_route',
    description:
      'Check permanent airspace restrictions along a drone route or across an area. Give either waypoints (at least two; each a [lon, lat] pair or a place name) ' +
      'or an area (bbox [west, south, east, north] or a GeoJSON Polygon). Returns the zones crossed, deduplicated, with the distance along the route at which each is first entered. ' +
      'Place-name waypoints are geocoded; ambiguous names are returned for you to resolve.',
    inputSchema: {
      waypoints: z.array(waypointSchema).min(2).max(50).optional().describe('Ordered route points: [lon, lat] pairs or place names.'),
      area: z
        .union([z.object({ bbox: bboxSchema }), polygonSchema])
        .optional()
        .describe('Area to check instead of a route: { bbox: [w, s, e, n] } or a GeoJSON Polygon.'),
      include_above_120m: includeAbove120m,
      format: formatArg,
    },
    annotations: { readOnlyHint: true, openWorldHint: true, title: 'Check airspace along a route or area' },
  },
  {
    name: 'check_takeoff_site',
    description:
      'Assess a potential drone take-off spot in the UK. Returns the airspace verdict at the point, the nearest public rights of way (footpaths, bridleways, byways) with distances and the responsible council, ' +
      'and any known landowner rule (National Trust land, council byelaw) at the point. A public right of way is a strong indicator of legal access; rights-of-way data covers England and Wales only.',
    inputSchema: {
      ...locationInput,
      max_paths: z.number().int().min(1).max(20).default(5).describe('Maximum rights of way to return.'),
      search_radius_m: z.number().int().min(50).max(5000).default(1000).describe('Search radius for rights of way in metres.'),
      format: formatArg,
    },
    annotations: { readOnlyHint: true, openWorldHint: true, title: 'Check a take-off site' },
  },
  {
    name: 'find_parking',
    description:
      'Find car parks, laybys and rest areas near a UK point, nearest first, from OpenStreetMap. Give a place name or postcode, or lat/lon. ' +
      'Returns name, type, distance, fee and access notes. Publicly accessible places only unless include_private is set.',
    inputSchema: {
      ...locationInput,
      max_results: z.number().int().min(1).max(20).default(5),
      search_radius_m: z.number().int().min(100).max(10_000).default(2000).describe('Search radius in metres.'),
      include_private: z.boolean().default(false).describe('Also list parking tagged private, customers-only or permit-only.'),
      format: formatArg,
    },
    annotations: { readOnlyHint: true, openWorldHint: true, title: 'Find parking near a location' },
  },
  {
    name: 'geocode',
    description:
      'Resolve a UK place name, postcode or landmark to coordinates. Use it to disambiguate before running a check when a name could match several places. ' +
      'Returns up to ten candidates with source and confidence.',
    inputSchema: {
      query: z.string().min(1).max(200).describe('Place name, postcode or landmark.'),
      limit: z.number().int().min(1).max(10).default(5),
      format: formatArg,
    },
    annotations: { readOnlyHint: true, openWorldHint: true, title: 'Geocode a UK place' },
  },
  {
    name: 'get_data_status',
    description:
      'Report the data behind this server: airspace pack version and AIRAC effective dates, when each source was fetched and its licence, NOTAM bulletin cache age, ' +
      'geocoding providers available, runtime details, and the attribution strings that must be shown to users.',
    inputSchema: { format: formatArg },
    annotations: { readOnlyHint: true, openWorldHint: false, title: 'Data status and attribution' },
  },
];
