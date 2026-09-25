import type { ToolName } from '../tools/names.js';
import type { HandlerDependencies, ToolHandler } from './deps.js';
import { createCheckLocationHandler, createGeocodeHandler } from './location-handlers.js';
import { createGetAerodromeZoneHandler } from './aerodrome-handlers.js';
import { createCheckNotamsHandler } from './notam-handlers.js';
import { createCheckRouteHandler } from './route-handlers.js';
import { createCheckTakeoffSiteHandler } from './takeoff-handlers.js';
import { createGetDataStatusHandler } from './status-handlers.js';
import { createFindParkingHandler } from './parking-handlers.js';
import { createCheckWeatherHandler } from './weather-handlers.js';
import { createCheckDroneRulesHandler } from './drone-handlers.js';
import type { ToolResponse } from '../types.js';

export type { HandlerDependencies, ToolHandler } from './deps.js';

export function createHandlers(deps: HandlerDependencies): Map<ToolName, ToolHandler> {
  const handlers = new Map<ToolName, ToolHandler>();
  handlers.set('check_location', createCheckLocationHandler(deps));
  handlers.set('get_aerodrome_zone', createGetAerodromeZoneHandler(deps));
  handlers.set('check_notams', createCheckNotamsHandler(deps));
  handlers.set('check_route', createCheckRouteHandler(deps));
  handlers.set('check_takeoff_site', createCheckTakeoffSiteHandler(deps));
  handlers.set('find_parking', createFindParkingHandler(deps));
  handlers.set('check_weather', createCheckWeatherHandler(deps));
  handlers.set('check_drone_rules', createCheckDroneRulesHandler(deps));
  handlers.set('geocode', createGeocodeHandler(deps));
  handlers.set('get_data_status', createGetDataStatusHandler(deps));
  return handlers;
}

export async function handleToolRequest(name: string, args: Record<string, unknown>, handlers: Map<ToolName, ToolHandler>): Promise<ToolResponse> {
  const handler = handlers.get(name as ToolName);
  if (!handler) throw new Error(`Unknown tool: ${name}`);
  return handler(args);
}
