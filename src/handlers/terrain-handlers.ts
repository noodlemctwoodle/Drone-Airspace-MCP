import type { OutputFormat, Position } from '../types.js';
import type { HandlerDependencies, ToolHandler } from './deps.js';
import { brief, respond } from './respond.js';
import { locationLine, locationNotes, resolveOrRespond, sourceOfLocation } from './location-handlers.js';
import { resolveWaypoints, type Waypoint } from './route-handlers.js';
import type { LocationArgs } from '../tools/schemas.js';
import { UserFacingError } from '../core/errors.js';
import { routeLengthKm, sampleAlongLine, toLineString } from '../services/airspace/geometry.js';
import { analyseTerrain, bearingDeg, gridAround, type TerrainSample } from '../services/terrain/profile.js';
import { compassPoint } from '../services/weather/assessment.js';
import { renderReport, type ReportSection } from '../formatters/report.js';
import { attributionLines, attributionSentence, type SourceId } from '../formatters/attribution.js';
import { formatCoord, formatDistance, formatKm } from '../formatters/units.js';
import { mapUrl } from '../map/view-data.js';
import { CAVEAT_120M_SURFACE, CAVEAT_NOT_BRIEFING, CAVEAT_TERRAIN } from './caveats.js';

const MAX_ROUTE_KM = 100;
const MAX_SAMPLES = 400;

export function createCheckTerrainHandler(deps: HandlerDependencies): ToolHandler {
  return async (args) => {
    const format = (args.format as OutputFormat) ?? 'text';
    const waypoints = args.waypoints as Waypoint[] | undefined;
    const loc = args as LocationArgs;
    const hasPoint = typeof loc.place === 'string' || typeof loc.lat === 'number' || typeof loc.lon === 'number';
    if ((waypoints && hasPoint) || (!waypoints && !hasPoint)) throw new UserFacingError('Give either waypoints (a route) or a place / lat and lon (a point), not both.');
    const flightHeightM = typeof args.flight_height_m === 'number' ? args.flight_height_m : 120;
    const radiusM = typeof args.radius_m === 'number' ? args.radius_m : 500;
    let stepM = typeof args.step_m === 'number' ? args.step_m : 100;
    const used = new Set<SourceId>(['elevation']);
    const caveats = [CAVEAT_TERRAIN, CAVEAT_120M_SURFACE, CAVEAT_NOT_BRIEFING];

    let samples: TerrainSample[];
    let mode: 'route' | 'point';
    let route: { lengthKm: number; waypoints: { name: string; lat: number; lon: number }[]; line: Position[] } | null = null;
    let notes: string[] = [];
    let location: string | undefined;
    let centre: { lat: number; lon: number; name?: string };
    if (waypoints) {
      mode = 'route';
      const wp = await resolveWaypoints(deps, 'check_terrain', waypoints, format);
      if ('response' in wp) return wp.response;
      for (const s of wp.used) used.add(s);
      notes = wp.notes;
      const line = toLineString(wp.resolved.map((l): Position => [l.lon, l.lat]));
      const lengthKm = routeLengthKm(line);
      if (lengthKm > MAX_ROUTE_KM) throw new UserFacingError(`Route is ${lengthKm.toFixed(0)} km; the maximum for a terrain profile is ${MAX_ROUTE_KM} km.`);
      stepM = Math.max(stepM, Math.ceil((lengthKm * 1000) / MAX_SAMPLES));
      const pts = sampleAlongLine(line, stepM);
      const elev = await deps.elevation.elevations(pts.map((p) => ({ lat: p.position[1], lon: p.position[0] })));
      samples = pts.map((p, i) => ({ alongKm: p.alongKm, lat: p.position[1], lon: p.position[0], elevationM: elev[i] }));
      route = { lengthKm: Math.round(lengthKm * 100) / 100, waypoints: wp.resolved.map((l) => ({ name: l.name, lat: l.lat, lon: l.lon })), line: line.coordinates };
      centre = { lat: wp.resolved[0].lat, lon: wp.resolved[0].lon, name: wp.resolved[0].name };
    } else {
      mode = 'point';
      const resolved = await resolveOrRespond(deps, 'check_terrain', loc, format);
      if ('response' in resolved) return resolved.response;
      const l = resolved.location;
      const s = sourceOfLocation(l);
      if (s) used.add(s);
      notes = locationNotes(l);
      location = locationLine(l);
      const grid = gridAround(l.lon, l.lat, radiusM, 7);
      const elev = await deps.elevation.elevations(grid);
      samples = grid.map((g, i) => ({ alongKm: g.distanceKm, lat: g.lat, lon: g.lon, elevationM: elev[i] }));
      centre = { lat: l.lat, lon: l.lon, name: l.name };
    }
    const analysis = analyseTerrain(samples, flightHeightM, mode);
    if (analysis.missingSamples > 0) notes.push(`${analysis.missingSamples} sample${analysis.missingSamples > 1 ? 's' : ''} had no elevation.`);
    const attribution = attributionLines(used, await deps.pack.metaOrNull());
    const where = (s: TerrainSample) => (mode === 'route' ? `${s.alongKm.toFixed(1)} km` : `${Math.round(s.alongKm * 1000)} m to the ${compassPoint(bearingDeg([centre.lon, centre.lat], [s.lon, s.lat]))}`);
    const data = {
      tool: 'check_terrain',
      generatedAt: deps.now().toISOString(),
      mode,
      route: route ? { lengthKm: route.lengthKm, waypoints: route.waypoints } : null,
      centre,
      radiusM: mode === 'point' ? radiusM : null,
      stepM: mode === 'route' ? stepM : null,
      flightHeightM,
      takeoff: { lat: samples[0].lat, lon: samples[0].lon, elevationM: analysis.takeoffElevationM },
      summary: {
        minElevationM: analysis.minElevationM,
        maxElevationM: analysis.maxElevationM,
        maxRiseM: analysis.maxRiseM,
        maxFallM: analysis.maxFallM,
        highest: analysis.highest ? { ...analysis.highest, where: where(analysis.highest) } : null,
        lowest: analysis.lowest ? { ...analysis.lowest, where: where(analysis.lowest) } : null,
      },
      status: analysis.status,
      warnings: analysis.warnings,
      samples: samples.map((s) => ({ alongKm: Math.round(s.alongKm * 1000) / 1000, lat: s.lat, lon: s.lon, elevationM: s.elevationM })),
      caveats,
      attribution,
    };
    const headline = `${analysis.status.toUpperCase()}: ${analysis.headline}`;
    return respond(
      format,
      data,
      () => {
        const sections: ReportSection[] = [];
        if (mode === 'route' && route) {
          const stride = Math.max(1, Math.ceil(samples.length / 24));
          const lines = samples
            .filter((_, i) => i % stride === 0 || i === samples.length - 1)
            .map((s, i) => `${s.alongKm.toFixed(1)} km: ${s.elevationM === null ? '?' : `${Math.round(s.elevationM)} m`}${i === 0 ? ' (take-off)' : s.elevationM !== null && analysis.takeoffElevationM !== null ? ` (${s.elevationM - analysis.takeoffElevationM >= 0 ? '+' : ''}${Math.round(s.elevationM - analysis.takeoffElevationM)})` : ''}`);
          sections.push({ title: `Route: ${route.waypoints.map((w) => w.name).join(' -> ')} (${formatKm(route.lengthKm)})`, lines: route.waypoints.map((w, i) => `${i + 1}. ${w.name} (${formatCoord(w.lat, w.lon)})`) });
          sections.push({ title: `Elevation profile (every ${formatDistance(stepM * stride)})`, lines });
        } else {
          sections.push({
            title: `Ground within ${formatDistance(radiusM)}`,
            lines: [
              `Take-off point: ${analysis.takeoffElevationM === null ? '?' : `${Math.round(analysis.takeoffElevationM)} m`} above sea level.`,
              analysis.highest ? `Highest ground: ${Math.round(analysis.highest.elevationM ?? 0)} m, ${where(analysis.highest)} (${analysis.maxRiseM} m above take-off).` : '',
              analysis.lowest ? `Lowest ground: ${Math.round(analysis.lowest.elevationM ?? 0)} m, ${where(analysis.lowest)} (${analysis.maxFallM} m below take-off).` : '',
            ].filter(Boolean),
          });
        }
        sections.push({ title: `Warnings (${analysis.warnings.length})`, lines: analysis.warnings.map((w) => w.message) });
        return renderReport({ headline, notes, location, sections, caveats, attribution });
      },
      () =>
        brief(
          mode === 'route'
            ? `Terrain along your route rises up to ${analysis.maxRiseM} metres above the take-off point${analysis.highest ? ` after ${analysis.highest.alongKm.toFixed(1)} kilometres` : ''}`
            : `Ground within ${formatDistance(radiusM)} of ${centre.name?.split(',')[0] ?? 'the point'} rises up to ${analysis.maxRiseM} metres above it`,
          analysis.status === 'good' ? `A ${flightHeightM} metre ceiling set at take-off keeps you clear of the ground` : analysis.warnings[0]?.message ?? analysis.headline,
          attributionSentence(used)
        ),
      { view: { lat: centre.lat, lon: centre.lon, radiusM: mode === 'point' ? radiusM : 1000, ...(route ? { route: route.line } : {}) }, mapUrl: mapUrl(deps.config.publicUrl, { lat: centre.lat, lon: centre.lon, radiusM: mode === 'point' ? radiusM : 1000, route: route?.line }) }
    );
  };
}
