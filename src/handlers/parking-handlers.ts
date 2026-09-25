import type { OutputFormat } from '../types.js';
import type { HandlerDependencies, ToolHandler } from './deps.js';
import { brief, respond } from './respond.js';
import { locationLine, locationNotes, resolveOrRespond, sourceOfLocation } from './location-handlers.js';
import type { LocationArgs } from '../tools/schemas.js';
import { renderReport } from '../formatters/report.js';
import { parkingSentence, renderParking } from '../formatters/parking.js';
import { attributionLines, attributionSentence, type SourceId } from '../formatters/attribution.js';
import { formatDistance } from '../formatters/units.js';
import { mapUrl } from '../map/view-data.js';

export const CAVEAT_PARKING = 'Parking comes from OpenStreetMap and may be out of date; check signs on arrival. Distances are straight-line.';

export function createFindParkingHandler(deps: HandlerDependencies): ToolHandler {
  return async (args) => {
    const format = (args.format as OutputFormat) ?? 'text';
    const resolved = await resolveOrRespond(deps, 'find_parking', args as LocationArgs, format);
    if ('response' in resolved) return resolved.response;
    const loc = resolved.location;
    const n = typeof args.max_results === 'number' ? args.max_results : 5;
    const radiusM = typeof args.search_radius_m === 'number' ? args.search_radius_m : 2000;
    const includePrivate = args.include_private === true;
    const pack = deps.pack.require();
    const hits = await pack.nearestParking(loc.lon, loc.lat, radiusM, n, includePrivate);
    const used = new Set<SourceId>(['parking']);
    const s = sourceOfLocation(loc);
    if (s) used.add(s);
    const attribution = attributionLines(used, await pack.meta());
    const caveats = [CAVEAT_PARKING];
    const data = { tool: 'find_parking', generatedAt: deps.now().toISOString(), location: loc, searchRadiusM: radiusM, includePrivate, parking: hits, caveats, attribution };
    const headline = hits.length === 0 ? `No parking found within ${formatDistance(radiusM)}.` : `Nearest parking: ${parkingSentence(hits[0])}.`;
    return respond(
      format,
      data,
      () => renderReport({ headline, notes: locationNotes(loc), location: locationLine(loc), sections: [{ title: `Parking within ${formatDistance(radiusM)} (${hits.length})`, lines: hits.map(renderParking) }], caveats, attribution }),
      () =>
        brief(
          `Near ${loc.name.split(',').slice(0, 2).join(',')}: ${headline}`,
          hits.length > 1 ? `Also ${hits.slice(1, 3).map(parkingSentence).join(' and ')}` : null,
          'Parking data is from OpenStreetMap, so check signs on arrival',
          attributionSentence(used)
        ),
      { view: { lat: loc.lat, lon: loc.lon, radiusM }, mapUrl: mapUrl(deps.config.publicUrl, { lat: loc.lat, lon: loc.lon, radiusM }) }
    );
  };
}
