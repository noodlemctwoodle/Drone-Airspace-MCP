import { z, type ZodRawShape } from 'zod';
import type { ToolName } from './names.js';
import { a2CertificateArg, bboxSchema, classMarkArg, dateArg, droneModelArg, formatArg, locationInput, polygonSchema, waypointSchema } from './schemas.js';

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
      drone: droneModelArg.optional().describe('Optional drone make and model; adds the open category subcategory and the separation from people that applies to it.'),
      a2_certificate: a2CertificateArg,
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
    name: 'check_weather',
    description:
      'Drone-relevant weather forecast for a UK point from Open-Meteo: wind and gusts at 10 m, wind at 120 m, rain, visibility, cloud, temperature and daylight hours, with an advisory flyability rating per hour ' +
      '(good / caution / poor against typical small-drone limits). Give a place or lat/lon and optionally a date or date-time; defaults to the next few hours.',
    inputSchema: {
      ...locationInput,
      date: dateArg,
      hours: z.number().int().min(1).max(24).default(6).describe('How many hours to report from the start time (a bare date reports daylight hours).'),
      format: formatArg,
    },
    annotations: { readOnlyHint: true, openWorldHint: true, title: 'Check drone weather' },
  },
  {
    name: 'check_drone_rules',
    description:
      'Which UK open category rules apply to a consumer drone: the subcategory (A1 fly over people, A2 near people, A3 far from people), the separation from uninvolved people, whether Flyer ID and Operator ID registration are needed, ' +
      'and when Remote ID is required. Give a model name from the catalogue (DJI, Autel, Potensic, HoverAir, Parrot) or a weight in grams plus any class mark. Rules follow the CAA class marks in force from 2026, including the EU C-class transition to the end of 2027.',
    inputSchema: {
      model: droneModelArg.optional(),
      weight_g: z.number().min(1).max(50_000).optional().describe('Take-off weight in grams, when the model is not in the catalogue or a heavier battery is fitted.'),
      class_mark: classMarkArg,
      has_camera: z.boolean().optional().describe('Whether the aircraft carries a camera. Defaults to the catalogue value, or true.'),
      a2_certificate: a2CertificateArg,
      date: dateArg.describe('Date to assess the rules for; defaults to today. Use it to see what changes at a transition date.'),
      format: formatArg,
    },
    annotations: { readOnlyHint: true, openWorldHint: false, title: 'Check drone rules' },
  },
  {
    name: 'preflight_briefing',
    description:
      'One pre-flight briefing for a UK take-off point and time: a GO, CAUTION or NO-GO status with reasons, from the airspace verdict, live NOTAMs, the weather window, geomagnetic activity, rights of way, parking and, when a drone is named, its open category rules. ' +
      'A live source that cannot be read is reported as an outage, never assumed clear. Give a place or lat/lon; date and hours set the flying window (default now, 3 hours). Set frz_permission when an aerodrome has already agreed the flight.',
    inputSchema: {
      ...locationInput,
      date: dateArg,
      hours: z.number().int().min(1).max(12).default(3).describe('Length of the flying window from the start time.'),
      drone: droneModelArg.optional(),
      a2_certificate: a2CertificateArg,
      frz_permission: z.boolean().default(false).describe('The aerodrome has given permission to fly in its FRZ; the FRZ then counts as caution rather than no-go.'),
      notam_radius_km: z.number().min(0).max(50).default(10).describe('Also list NOTAMs within this distance.'),
      max_paths: z.number().int().min(1).max(10).default(3).describe('Rights of way to list.'),
      format: formatArg,
    },
    annotations: { readOnlyHint: true, openWorldHint: true, title: 'Pre-flight briefing' },
  },
  {
    name: 'check_terrain',
    description:
      'Ground elevation along a route or around a point, against the 120 m rule: the 120 m limit is measured from the surface below the aircraft, so rising ground eats into clearance and falling ground can put a fixed-height flight above the limit. ' +
      'Give waypoints (2 to 50 places or [lon, lat] pairs) for a profile, or a place / lat and lon for the ground within radius_m. Reports the highest and lowest ground relative to the take-off point and warnings for the planned flight height. Elevations from Copernicus GLO-90 via Open-Meteo, about 90 m resolution.',
    inputSchema: {
      waypoints: z.array(waypointSchema).min(2).max(50).optional().describe('Route as place names or [lon, lat] pairs.'),
      ...locationInput,
      radius_m: z.number().int().min(100).max(3000).default(500).describe('Point mode: radius of ground to sample.'),
      step_m: z.number().int().min(25).max(1000).default(100).describe('Route mode: sample spacing along the route.'),
      flight_height_m: z.number().int().min(10).max(120).default(120).describe('Planned height above the take-off point.'),
      format: formatArg,
    },
    annotations: { readOnlyHint: true, openWorldHint: true, title: 'Check terrain' },
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
