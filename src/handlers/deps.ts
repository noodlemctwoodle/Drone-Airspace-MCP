import type { Config } from '../core/config.js';
import type { Logger } from '../core/logger.js';
import type { PackRepository } from '../pack/repository.js';
import type { AirspaceEngine } from '../services/airspace/airspace-engine.js';
import type { Geocoder } from '../services/geocoder/index.js';
import type { NotamService } from '../services/notam/index.js';
import type { RightsOfWayService } from '../services/rights-of-way.js';
import type { OpenMeteoClient } from '../services/weather/open-meteo.js';
import type { PackMeta, ToolResponse } from '../types.js';

export type PackState =
  | { state: 'ready'; tag: string; path: string }
  | { state: 'downloading'; percent: number | null; tag: string | null }
  | { state: 'unavailable'; reason: string };

/** Access to the pack that may still be downloading at startup. */
export interface PackAccess {
  /** Throws PackUnavailableError with a clear message when the pack is not ready. */
  require(): PackRepository;
  current(): PackRepository | undefined;
  status(): PackState;
  metaOrNull(): Promise<PackMeta | null>;
}

export interface HandlerDependencies {
  config: Config;
  logger: Logger;
  pack: PackAccess;
  geocoder: Geocoder;
  notams: NotamService;
  airspace: AirspaceEngine;
  rightsOfWay: RightsOfWayService;
  weather: OpenMeteoClient;
  now: () => Date;
}

export type ToolHandler = (args: Record<string, unknown>) => Promise<ToolResponse>;
