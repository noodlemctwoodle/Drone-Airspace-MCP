import type { OutputFormat } from '../types.js';
import type { HandlerDependencies, ToolHandler } from './deps.js';
import { respond } from './respond.js';
import { UserFacingError } from '../core/errors.js';
import { renderReport } from '../formatters/report.js';
import { renderZone, zoneToJson } from '../formatters/zones.js';
import { attributionLines } from '../formatters/attribution.js';
import { formatCoord } from '../formatters/units.js';

export function createGetAerodromeZoneHandler(deps: HandlerDependencies): ToolHandler {
  return async (args) => {
    const format = (args.format as OutputFormat) ?? 'text';
    const query = String(args.aerodrome ?? '').trim();
    if (!query) throw new UserFacingError('aerodrome is required.');
    const includeGeojson = args.include_geojson === true;
    const pack = deps.pack.require();
    const matches = deps.airspace.aerodrome(query, 5);
    const attribution = attributionLines(['airspace'], pack.meta());
    const data = {
      tool: 'get_aerodrome_zone',
      query,
      matches: matches.map((m) => ({
        name: m.name,
        icao: m.icao,
        centre: { lat: m.primary.centre[1], lon: m.primary.centre[0] },
        radiusKm: Math.round(m.primary.radiusKm * 100) / 100,
        bbox: m.bbox,
        areaKm2: Math.round(m.areaKm2 * 10) / 10,
        zone: zoneToJson(m.primary.zone, includeGeojson),
        components: m.components.map((c) => ({
          zone: zoneToJson(c.zone, includeGeojson),
          centre: { lat: c.centre[1], lon: c.centre[0] },
          radiusKm: Math.round(c.radiusKm * 100) / 100,
          bbox: c.bbox,
          areaKm2: Math.round(c.areaKm2 * 10) / 10,
        })),
      })),
      attribution,
    };
    return respond(format, data, () => {
      if (matches.length === 0) {
        return renderReport({
          headline: `No aerodrome zone found for "${query}". Try the ICAO code (four letters starting EG) or the aerodrome's common name.`,
          sections: [],
          attribution,
        });
      }
      const sections = matches.map((m) => ({
        title: `${m.icao ?? ''} ${m.name}`.trim() + ` (${m.components.length} component${m.components.length > 1 ? 's' : ''}, ${m.areaKm2.toFixed(1)} km2)`,
        lines: [
          `centre ${formatCoord(m.primary.centre[1], m.primary.centre[0])}; main zone extends up to ${m.primary.radiusKm.toFixed(1)} km from centre`,
          `overall bbox [${m.bbox.map((v) => v.toFixed(4)).join(', ')}]`,
          ...m.components.map((c) => renderZone(c.zone)),
          ...(includeGeojson ? m.components.map((c) => `geometry ${c.zone.designator ?? c.zone.id}: ${JSON.stringify(c.zone.geometry)}`) : []),
        ],
      }));
      return renderReport({ headline: `${matches.length} zone${matches.length > 1 ? 's' : ''} for "${query}"`, sections, attribution });
    });
  };
}
