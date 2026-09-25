export const TOOL_NAMES = [
  'check_location',
  'get_aerodrome_zone',
  'check_notams',
  'check_route',
  'check_takeoff_site',
  'find_parking',
  'geocode',
  'get_data_status',
] as const;

export type ToolName = (typeof TOOL_NAMES)[number];
