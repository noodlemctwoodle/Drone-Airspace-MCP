import type { BBox, OutputFormat, Polygon, Position, ResolvedLocation } from '../types.js';
import type { HandlerDependencies, ToolHandler } from './deps.js';
import { ambiguousResponse, brief, notFoundResponse, respond } from './respond.js';
import { locationNotes, sourceOfLocation } from './location-handlers.js';
import { resolveLocation } from '../services/location-resolver.js';
import { UserFacingError } from '../core/errors.js';
import { splitByRelevance } from '../services/airspace/vertical.js';
import { routeVerdict } from '../services/airspace/verdict.js';
import { bboxToPolygon, routeLengthKm, toLineString } from '../services/airspace/geometry.js';
import { renderReport, type ReportSection } from '../formatters/report.js';
import { renderZone, zoneToJson } from '../formatters/zones.js';
import { attributionLines, attributionSentence, type SourceId } from '../formatters/attribution.js';
import { formatCoord, formatKm } from '../formatters/units.js';
import area from '@turf/area';
import { CAVEAT_AIRSPACE_ONLY_BELOW_120M, CAVEAT_NOTAMS_NOT_INCLUDED, CAVEAT_NOT_BRIEFING } from './caveats.js';

const MAX_ROUTE_KM = 500;

type Waypoint = [number, number] | string;

export function createCheckRouteHandler(deps: HandlerDependencies): ToolHandler {
  return async (args) => {
    const format = (args.format as OutputFormat) ?? 'text';
    const includeAbove = args.include_above_120m === true;
    const waypoints = args.waypoints as Waypoint[] | undefined;
    const areaArg = args.area as { bbox: BBox } | Polygon | undefined;
    if ((waypoints && areaArg) || (!waypoints && !areaArg)) {
      throw new UserFacingError('Give either waypoints (a route) or area, not both.');
    }
    const pack = deps.pack.require();
    const used = new Set<SourceId>(['airspace']);
    const caveats = [CAVEAT_AIRSPACE_ONLY_BELOW_120M, CAVEAT_NOTAMS_NOT_INCLUDED, CAVEAT_NOT_BRIEFING];

    if (waypoints) {
      const resolved: ResolvedLocation[] = [];
      const notes: string[] = [];
      for (const [i, wp] of waypoints.entries()) {
        if (Array.isArray(wp)) {
          const r = await resolveLocation({ lon: wp[0], lat: wp[1] }, deps.geocoder);
          if (r.status === 'resolved') resolved.push(r.location);
          continue;
        }
        const r = await resolveLocation({ place: wp }, deps.geocoder);
        if (r.status === 'ambiguous') return ambiguousResponse(format, 'check_route', `waypoint ${i + 1}: ${r.query}`, r.candidates);
        if (r.status === 'not_found') return notFoundResponse(format, 'check_route', `waypoint ${i + 1}: ${r.query}`);
        resolved.push(r.location);
        const s = sourceOfLocation(r.location);
        if (s) used.add(s);
        notes.push(...locationNotes(r.location).map((n) => `Waypoint ${i + 1}: ${n}`));
      }
      const line = toLineString(resolved.map((l): Position => [l.lon, l.lat]));
      const lengthKm = routeLengthKm(line);
      if (lengthKm > MAX_ROUTE_KM) throw new UserFacingError(`Route is ${lengthKm.toFixed(0)} km; the maximum is ${MAX_ROUTE_KM} km. Split it into shorter legs.`);
      const hits = await deps.airspace.alongRoute(line);
      const { relevant, above } = splitByRelevance(hits.map((h) => h.zone));
      const relevantIds = new Set(relevant.map((z) => z.id));
      const crossings = hits.filter((h) => relevantIds.has(h.zone.id));
      const verdict = routeVerdict(relevant);
      const attribution = attributionLines(used, await pack.meta());
      const data = {
        tool: 'check_route',
        generatedAt: deps.now().toISOString(),
        mode: 'route',
        route: { lengthKm: Math.round(lengthKm * 100) / 100, waypoints: resolved },
        verdict,
        crossings: crossings.map((h) => ({ ...zoneToJson(h.zone), ...h.crossing })),
        zonesAbove120m: includeAbove ? above.map((z) => zoneToJson(z)) : above.length,
        caveats,
        attribution,
      };
      return respond(format, data, () => {
        const sections: ReportSection[] = [
          {
            title: `Route: ${resolved.map((l) => l.name).join(' -> ')} (${formatKm(lengthKm)})`,
            lines: resolved.map((l, i) => `${i + 1}. ${l.name} (${formatCoord(l.lat, l.lon)})`),
          },
          {
            title: `Restrictions crossed (${crossings.length})`,
            lines: crossings.map((h) => {
              const c = h.crossing;
              const enter = c.startsInside ? 'starts inside' : `enters at ${formatKm(c.entersAtKm)} (${formatCoord(c.entersAt[1], c.entersAt[0])})`;
              const exit = c.exitsAtKm === null ? (c.endsInside ? 'ends inside' : '') : `exits at ${formatKm(c.exitsAtKm)}`;
              return `${renderZone(h.zone)}; ${enter}${exit ? `; ${exit}` : ''}; ${formatKm(c.coveredKm)} of route inside`;
            }),
          },
        ];
        if (includeAbove) sections.push({ title: `Zones only above 400 ft (${above.length})`, lines: above.map(renderZone) });
        else if (above.length > 0) sections.push({ title: 'Zones only above 400 ft', lines: [`${above.length} zone(s) start above 400 ft; pass include_above_120m to list them.`] });
        return renderReport({ headline: verdict.line, notes, sections, caveats, attribution });
      }, () =>
        brief(
          `${resolved.every((l) => l.source === 'input') ? 'Your route' : `Route ${resolved.map((l) => l.name.split(',')[0]).join(' to ')}`}, ${formatKm(lengthKm)}: ${verdict.line}`,
          crossings.length > 0 ? `First entered ${crossings[0].crossing.startsInside ? 'at the start' : `after ${formatKm(crossings[0].crossing.entersAtKm)}`}` : null,
          'Temporary NOTAMs are not included',
          attributionSentence(used)
        )
      );
    }

    const areaInput = areaArg as { bbox: BBox } | Polygon;
    const polygon: Polygon = 'bbox' in areaInput ? bboxToPolygon(areaInput.bbox as BBox) : areaInput;
    const zones = await deps.airspace.inArea(polygon);
    const { relevant, above } = splitByRelevance(zones);
    const verdict = routeVerdict(relevant);
    let areaKm2 = 0;
    try {
      areaKm2 = area(polygon) / 1_000_000;
    } catch {
      areaKm2 = 0;
    }
    const attribution = attributionLines(used, await pack.meta());
    const data = {
      tool: 'check_route',
      generatedAt: deps.now().toISOString(),
      mode: 'area',
      area: { areaKm2: Math.round(areaKm2 * 100) / 100, polygon },
      verdict: { ...verdict, line: verdict.line.replace('Route crosses', 'Area contains').replace('along this route', 'in this area') },
      zones: relevant.map((z) => zoneToJson(z)),
      zonesAbove120m: includeAbove ? above.map((z) => zoneToJson(z)) : above.length,
      caveats,
      attribution,
    };
    return respond(format, data, () => {
      const sections: ReportSection[] = [{ title: `Restrictions intersecting the area (${relevant.length}, area ${areaKm2.toFixed(1)} km2)`, lines: relevant.map(renderZone) }];
      if (includeAbove) sections.push({ title: `Zones only above 400 ft (${above.length})`, lines: above.map(renderZone) });
      return renderReport({ headline: data.verdict.line, sections, caveats, attribution });
    }, () => brief(`Area of ${areaKm2.toFixed(1)} square kilometres: ${data.verdict.line}`, 'Temporary NOTAMs are not included', attributionSentence(used)));
  };
}
