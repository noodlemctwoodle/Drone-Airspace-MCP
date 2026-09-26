import booleanPointInPolygon from '@turf/boolean-point-in-polygon';
import pointToLineDistance from '@turf/point-to-line-distance';
import { lineString, point } from '@turf/helpers';
import type { HazardHit, LandRestriction, MultiPolygon, NotamHit, OutputFormat, Polygon, RightOfWayHit } from '../types.js';
import type { HandlerDependencies, ToolHandler } from './deps.js';
import { brief, respond } from './respond.js';
import { locationLine, locationNotes, resolveOrRespond, sourceOfLocation } from './location-handlers.js';
import { droneSectionLines } from './drone-handlers.js';
import type { LocationArgs } from '../tools/schemas.js';
import { splitByRelevance } from '../services/airspace/vertical.js';
import { distanceKm } from '../services/airspace/geometry.js';
import { metresToDegrees } from '../pack/geometry.js';
import { buildCandidates, type Candidate } from '../services/spots/candidates.js';
import { scoreCandidate } from '../services/spots/scoring.js';
import { isSiteHazard } from '../formatters/hazards.js';
import { landPackIds, splitLandRestrictions } from '../services/land-rules.js';
import { renderReport, type ReportSection } from '../formatters/report.js';
import { attributionLines, attributionSentence, type SourceId } from '../formatters/attribution.js';
import { formatCoord, formatDistance } from '../formatters/units.js';
import { mapUrl } from '../map/view-data.js';
import {
  CAVEAT_AIRSPACE_ONLY_BELOW_120M,
  CAVEAT_BAN_LAYER_INCOMPLETE,
  CAVEAT_NOTAM_SCHEDULE,
  CAVEAT_NOT_BRIEFING,
  CAVEAT_NO_PROW_HERE,
  CAVEAT_PROW_INTERPRETATION,
  CAVEAT_SCOTLAND_ACCESS,
  CAVEAT_SPOTS,
} from './caveats.js';

async function attempt<T>(fn: () => Promise<T>): Promise<{ ok: true; value: T } | { ok: false; error: string }> {
  try {
    return { ok: true, value: await fn() };
  } catch (error) {
    return { ok: false, error: (error as Error).message };
  }
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

export function createFindTakeoffSpotsHandler(deps: HandlerDependencies): ToolHandler {
  return async (args) => {
    const format = (args.format as OutputFormat) ?? 'text';
    const resolved = await resolveOrRespond(deps, 'find_takeoff_spots', args as LocationArgs, format);
    if ('response' in resolved) return resolved.response;
    const loc = resolved.location;
    const radiusM = typeof args.search_radius_m === 'number' ? args.search_radius_m : 3000;
    const maxResults = typeof args.max_results === 'number' ? args.max_results : 3;
    const droneArg = typeof args.drone === 'string' && args.drone.trim() !== '' ? args.drone.trim() : null;
    const droneInfo = droneArg ? droneSectionLines(droneArg, args.a2_certificate === true, deps.now()) : null;
    const a3 = droneInfo?.assessment?.subcategory === 'A3';
    const pack = deps.pack.require();
    const coverage = await deps.rightsOfWay.coverageAt(loc.lon, loc.lat);
    const scotlandPaths = coverage === 'scotland' && (await deps.rightsOfWay.hasCorePaths());
    const { dLat, dLon } = metresToDegrees(radiusM, loc.lat);
    const bbox: [number, number, number, number] = [loc.lon - dLon, loc.lat - dLat, loc.lon + dLon, loc.lat + dLat];

    const [paths, parking, land, hazards, notamR] = await Promise.all([
      coverage === 'northern_ireland' || (coverage === 'scotland' && !scotlandPaths) ? Promise.resolve([] as RightOfWayHit[]) : pack.nearestRightsOfWay(loc.lon, loc.lat, radiusM, 40),
      pack.nearestParking(loc.lon, loc.lat, radiusM, 15, false),
      pack.landRestrictionsInBbox(bbox, 100),
      pack.hazardsNear(loc.lon, loc.lat, radiusM + 200, 200),
      attempt(() => deps.notams.nearPoint(loc.lon, loc.lat, radiusM / 1000 + 5, deps.now())),
    ]);
    const accessLand = land.filter((l) => l.kind === 'access_land' && !l.takeoffBanned) as Array<LandRestriction & { geometry: Polygon | MultiPolygon }>;
    const candidates = buildCandidates(loc, radiusM, paths, parking, accessLand);
    const notams: NotamHit[] = notamR.ok ? [...notamR.value.covering, ...notamR.value.nearby] : [];

    const here = (c: Candidate) => point([c.lon, c.lat]);
    const scored: Array<{ candidate: Candidate; score: number; reasons: string[]; excluded: string | null; nearestPathM: number | null; nearestParkingM: number | null; notamIds: string[]; zoneNames: string[] }> = [];
    const touchedLand = new Set<LandRestriction>();
    for (const group of chunk(candidates, 10)) {
      const results = await Promise.all(
        group.map(async (c) => {
          const [zones, restrictions] = await Promise.all([deps.airspace.atPoint(c.lon, c.lat), pack.landRestrictionsAt(c.lon, c.lat)]);
          const relevant = splitByRelevance(zones).relevant;
          for (const r of restrictions) touchedLand.add(r);
          const p = here(c);
          const nearestPathM = paths.length ? Math.round(Math.min(...paths.map((x) => pointToLineDistance(p, lineString(x.geometry.coordinates), { units: 'meters' })))) : null;
          const nearestParkingM = parking.length ? Math.round(Math.min(...parking.map((x) => distanceKm([c.lon, c.lat], [x.lon, x.lat]) * 1000))) : null;
          let nearestHazard: HazardHit | null = null;
          let nearestSite: HazardHit | null = null;
          for (const h of hazards) {
            const d = Math.round(distanceKm([c.lon, c.lat], [h.lon, h.lat]) * 1000);
            if (isSiteHazard(h)) {
              if (!nearestSite || d < nearestSite.distanceM) nearestSite = { ...h, distanceM: d };
            } else if (!nearestHazard || d < nearestHazard.distanceM) nearestHazard = { ...h, distanceM: d };
          }
          const covering = notams.filter((n) => n.centre && n.radiusKm !== null && distanceKm([c.lon, c.lat], n.centre) <= n.radiusKm);
          const onAccessLand = accessLand.some((a) => booleanPointInPolygon(p, a.geometry));
          const s = scoreCandidate({ zones: relevant, restrictions, notamCovering: covering, nearestPathM, nearestParkingM, nearestHazard, nearestSite, onAccessLand, distanceFromCentreM: c.distanceFromCentreM, radiusM, a3 });
          return { candidate: c, ...s, nearestPathM, nearestParkingM, notamIds: covering.map((n) => n.id), zoneNames: relevant.map((z) => z.name) };
        })
      );
      scored.push(...results);
    }
    const kept = scored.filter((s) => !s.excluded).sort((a, b) => b.score - a.score || a.candidate.distanceFromCentreM - b.candidate.distanceFromCentreM || a.candidate.lon - b.candidate.lon || a.candidate.lat - b.candidate.lat);
    const spots = kept.slice(0, maxResults);
    const excludedCounts = new Map<string, number>();
    for (const s of scored) if (s.excluded) excludedCounts.set(s.excluded, (excludedCounts.get(s.excluded) ?? 0) + 1);
    const excluded = [...excludedCounts.entries()].map(([reason, count]) => ({ reason, count })).sort((a, b) => b.count - a.count || a.reason.localeCompare(b.reason));

    const used = new Set<SourceId>(['airspace']);
    if (paths.length > 0) used.add('prow');
    if (parking.length > 0) used.add('parking');
    if (notamR.ok) used.add('notam');
    if (hazards.length > 0) used.add('hazards');
    const landSplit = splitLandRestrictions([...touchedLand, ...accessLand]);
    if (landSplit.rules.length > 0) used.add(landSplit.rules.some((r) => r.sourceId === 'byelaws') ? 'byelaws' : 'landowner');
    if (landSplit.accessLand.length > 0) used.add('access_land');
    if (droneInfo?.assessment) used.add('caa_rules');
    const s = sourceOfLocation(loc);
    if (s) used.add(s);
    const attribution = attributionLines(used, await pack.meta(), landPackIds(landSplit));
    const usedPathAuthorities = new Set(paths.filter((p) => spots.some((sp) => sp.candidate.source === 'prow' && sp.candidate.label.includes(p.routeNo ?? '\u0000'))).map((p) => p.attribution));
    for (const a of usedPathAuthorities) attribution.push(a);

    const caveats = [CAVEAT_SPOTS, scotlandPaths ? CAVEAT_SCOTLAND_ACCESS : coverage === 'scotland' || coverage === 'northern_ireland' ? CAVEAT_NO_PROW_HERE : CAVEAT_PROW_INTERPRETATION, CAVEAT_BAN_LAYER_INCOMPLETE, CAVEAT_AIRSPACE_ONLY_BELOW_120M];
    if (!notamR.ok) caveats.push(`NOTAMs could not be fetched (${notamR.error}); spots are scored without them, run check_notams before flying.`);
    else if (notams.some((n) => n.schedule)) caveats.push(CAVEAT_NOTAM_SCHEDULE);
    if (a3 && !hazards.some(isSiteHazard)) caveats.push('No schools, parks or similar sites are mapped here; as an A3 pilot keep 150 m from residential, commercial, industrial and recreational areas yourself.');
    caveats.push(CAVEAT_NOT_BRIEFING);

    const name = loc.name.split(',').slice(0, 2).join(',');
    const headline = spots.length > 0
      ? `Best ${spots.length} take-off spot${spots.length > 1 ? 's' : ''} within ${formatDistance(radiusM)} of ${name}.`
      : candidates.length === 0
        ? `No candidate take-off spots within ${formatDistance(radiusM)}: no public rights of way, parking or access land found. Try a larger radius or check_takeoff_site at a point you know.`
        : `No suitable take-off spot within ${formatDistance(radiusM)}: every candidate is excluded (${excluded.map((e) => `${e.reason} x${e.count}`).join('; ')}).`;
    const data = {
      tool: 'find_takeoff_spots',
      generatedAt: deps.now().toISOString(),
      location: loc,
      searchRadiusM: radiusM,
      candidatesConsidered: candidates.length,
      spots: spots.map((s, i) => ({ rank: i + 1, lat: s.candidate.lat, lon: s.candidate.lon, score: s.score, distanceM: s.candidate.distanceFromCentreM, via: { source: s.candidate.source, label: s.candidate.label }, reasons: s.reasons, nearestPathM: s.nearestPathM, nearestParkingM: s.nearestParkingM, notamIds: s.notamIds, zoneNames: s.zoneNames })),
      excluded,
      coverage: coverage === 'england_wales' ? 'england_wales' : coverage === 'unknown' ? 'unknown' : scotlandPaths ? 'scotland_core_paths' : 'no_prow_data',
      drone: droneInfo ? { query: droneArg, label: droneInfo.label, assessment: droneInfo.assessment } : null,
      caveats,
      attribution,
    };
    const viewSpots = spots.map((s, i) => ({ lat: s.candidate.lat, lon: s.candidate.lon, rank: i + 1, label: s.candidate.label.slice(0, 60) }));
    return respond(
      format,
      data,
      () => {
        const sections: ReportSection[] = spots.map((s, i) => ({
          title: `${i + 1}. ${s.candidate.label}, ${formatDistance(s.candidate.distanceFromCentreM)} from ${name} (${formatCoord(s.candidate.lat, s.candidate.lon)}), score ${s.score}`,
          lines: s.reasons.length ? s.reasons : ['no bonuses or penalties applied'],
        }));
        if (excluded.length > 0) sections.push({ title: `Not suitable (${scored.length - kept.length})`, lines: excluded.map((e) => `${e.count}: ${e.reason}`) });
        if (droneInfo) sections.push({ title: 'Your drone', lines: droneInfo.lines });
        return renderReport({ headline, notes: [...locationNotes(loc), `${candidates.length} candidates considered.`], location: locationLine(loc), sections, caveats, attribution });
      },
      () =>
        brief(
          spots.length > 0 ? `The best spot near ${name} is on ${spots[0].candidate.label}, ${formatDistance(spots[0].candidate.distanceFromCentreM)} away${spots[0].reasons.length ? `: ${spots[0].reasons.slice(0, 2).join(', ')}` : ''}` : headline,
          spots.length > 1 ? `Second choice: ${spots[1].candidate.label}, ${formatDistance(spots[1].candidate.distanceFromCentreM)} away` : null,
          'A right of way gives a right to pass, not to stop and fly, so be considerate',
          attributionSentence(used)
        ),
      { view: { lat: loc.lat, lon: loc.lon, radiusM, spots: viewSpots, ...(droneInfo?.id ? { drone: droneInfo.id } : {}) }, mapUrl: mapUrl(deps.config.publicUrl, { lat: loc.lat, lon: loc.lon, radiusM, drone: droneInfo?.id ?? undefined, spots: viewSpots }) }
    );
  };
}
