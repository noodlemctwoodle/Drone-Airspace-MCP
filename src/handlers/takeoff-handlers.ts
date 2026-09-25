import type { OutputFormat } from '../types.js';
import type { HandlerDependencies, ToolHandler } from './deps.js';
import { brief, respond } from './respond.js';
import { locationLine, locationNotes, resolveOrRespond, sourceOfLocation } from './location-handlers.js';
import type { LocationArgs } from '../tools/schemas.js';
import { splitByRelevance } from '../services/airspace/vertical.js';
import { buildVerdict } from '../services/airspace/verdict.js';
import { renderReport, type ReportSection } from '../formatters/report.js';
import { droneSectionLines } from './drone-handlers.js';
import { landPackIds, landSourceIds, localAuthorityLines, splitLandRestrictions } from '../services/land-rules.js';
import { renderRestriction, renderZone, zoneToJson } from '../formatters/zones.js';
import { renderRightOfWay, rightOfWayToJson } from '../formatters/rights-of-way.js';
import { parkingSentence, renderParking } from '../formatters/parking.js';
import { attributionLines, attributionSentence, type SourceId } from '../formatters/attribution.js';
import { formatDistance } from '../formatters/units.js';
import { mapUrl } from '../map/view-data.js';
import {
  CAVEAT_BAN_LAYER_INCOMPLETE,
  CAVEAT_NOTAMS_NOT_INCLUDED,
  CAVEAT_NOT_BRIEFING,
  CAVEAT_NO_PROW_HERE,
  CAVEAT_PROW_INTERPRETATION,
} from './caveats.js';

export function createCheckTakeoffSiteHandler(deps: HandlerDependencies): ToolHandler {
  return async (args) => {
    const format = (args.format as OutputFormat) ?? 'text';
    const resolved = await resolveOrRespond(deps, 'check_takeoff_site', args as LocationArgs, format);
    if ('response' in resolved) return resolved.response;
    const loc = resolved.location;
    const maxPaths = typeof args.max_paths === 'number' ? args.max_paths : 5;
    const radiusM = typeof args.search_radius_m === 'number' ? args.search_radius_m : 1000;
    const droneArg = typeof args.drone === 'string' && args.drone.trim() !== '' ? args.drone.trim() : null;
    const droneInfo = droneArg ? droneSectionLines(droneArg, args.a2_certificate === true, deps.now()) : null;
    const pack = deps.pack.require();

    const zones = await deps.airspace.atPoint(loc.lon, loc.lat);
    const { relevant, above } = splitByRelevance(zones);
    const restrictions = await pack.landRestrictionsAt(loc.lon, loc.lat);
    const council = await pack.adminAreaAt(loc.lon, loc.lat);
    const land = splitLandRestrictions(restrictions);
    const verdict = buildVerdict(relevant, restrictions);
    const coverage = await deps.rightsOfWay.coverageAt(loc.lon, loc.lat);
    const paths = coverage === 'scotland' || coverage === 'northern_ireland' ? [] : await deps.rightsOfWay.nearest(loc.lon, loc.lat, radiusM, maxPaths);
    const takeoffBanned = land.rules.some((r) => r.takeoffBanned);
    const parking = await pack.nearestParking(loc.lon, loc.lat, 2000, 3, false);

    const used = new Set<SourceId>(['airspace']);
    if (paths.length > 0) used.add('prow');
    if (parking.length > 0) used.add('parking');
    for (const s of landSourceIds(land)) used.add(s);
    if (council) used.add('lad');
    const s = sourceOfLocation(loc);
    if (s) used.add(s);
    if (droneInfo?.assessment) used.add('caa_rules');
    const attribution = attributionLines(used, await pack.meta(), landPackIds(land));
    // Per-authority attribution is required by the OGL terms.
    for (const a of new Set(paths.map((p) => p.attribution))) attribution.push(a);

    const caveats = [
      coverage === 'scotland' || coverage === 'northern_ireland' ? CAVEAT_NO_PROW_HERE : CAVEAT_PROW_INTERPRETATION,
      CAVEAT_BAN_LAYER_INCOMPLETE,
      CAVEAT_NOTAMS_NOT_INCLUDED,
      CAVEAT_NOT_BRIEFING,
    ];
    if (coverage === 'unknown') caveats.push('Country coverage could not be determined for this point; rights-of-way results may be empty outside England and Wales.');

    const headlineParts: string[] = [];
    if (takeoffBanned) headlineParts.push('Take-off restricted by landowner rule.');
    headlineParts.push(verdict.line);
    if (verdict.landownerLine) headlineParts.push(verdict.landownerLine);
    if (verdict.accessLine) headlineParts.push(verdict.accessLine);
    if (verdict.advisoryLine) headlineParts.push(verdict.advisoryLine);
    if (paths.length > 0) {
      headlineParts.push(`Nearest public right of way: ${formatDistance(paths[0].distanceM)} away (${paths[0].pathType.replace('_', ' ')}, ${paths[0].authorityName}).`);
    } else if (coverage === 'england_wales' || coverage === 'unknown') {
      headlineParts.push(`No public right of way within ${formatDistance(radiusM)}.`);
    }

    const data = {
      tool: 'check_takeoff_site',
      generatedAt: deps.now().toISOString(),
      location: loc,
      verdict,
      takeoffBannedByLandowner: takeoffBanned,
      zones: relevant.map((z) => zoneToJson(z)),
      zonesAbove120m: above.length,
      landownerRules: land.rules,
      accessLand: land.accessLand,
      designations: land.designations,
      localAuthority: council ? { code: council.code, name: council.name, policies: land.policies } : null,
      rightsOfWay: paths.map(rightOfWayToJson),
      parking,
      coverage: coverage === 'england_wales' ? 'england_wales' : coverage === 'unknown' ? 'unknown' : 'no_prow_data',
      searchRadiusM: radiusM,
      drone: droneInfo ? { query: droneArg, label: droneInfo.label, assessment: droneInfo.assessment } : null,
      caveats,
      attribution,
    };
    return respond(format, data, () => {
      const sections: ReportSection[] = [
        { title: `Nearest public rights of way (${paths.length} within ${formatDistance(radiusM)})`, lines: paths.map(renderRightOfWay) },
        { title: 'Nearest parking (public, within 2 km)', lines: parking.map(renderParking) },
        { title: `Landowner rules at this point (${land.rules.length})`, lines: land.rules.map(renderRestriction) },
        { title: `Open access land (${land.accessLand.length})`, lines: land.accessLand.map(renderRestriction) },
        { title: `Nature and landscape designations (${land.designations.length})`, lines: land.designations.map(renderRestriction) },
        { title: 'Local authority', lines: localAuthorityLines(council, land.policies) },
        { title: `Airspace restrictions at this point (${relevant.length})`, lines: relevant.map(renderZone) },
      ];
      if (above.length > 0) sections.push({ title: 'Zones only above 400 ft', lines: [`${above.length} zone(s) start above 400 ft; see check_location with include_above_120m.`] });
      if (droneInfo) sections.push({ title: 'Your drone', lines: droneInfo.lines });
      return renderReport({ headline: headlineParts.join('\n'), notes: locationNotes(loc), location: locationLine(loc), sections, caveats, attribution });
    }, () =>
      brief(
        loc.resolvedFrom ? `I could not find ${loc.resolvedFrom.original}, so this is for ${loc.resolvedFrom.used}` : null,
        `For take-off near ${loc.name.split(',').slice(0, 2).join(',')}: ${headlineParts.join(' ')}`,
        paths.length > 1 ? `${paths.length} public rights of way within ${formatDistance(radiusM)} in total` : null,
        parking.length > 0 ? `Nearest parking: ${parkingSentence(parking[0])}` : null,
        droneInfo ? droneInfo.lines[0] : null,
        coverage === 'scotland' || coverage === 'northern_ireland' ? 'There is no rights-of-way data for this area' : 'Rights of way are an interpretation of the council definitive map',
        'Check NOTAMs separately and remember the landowner rule layer is incomplete',
        attributionSentence(used)
      ),
      { view: { lat: loc.lat, lon: loc.lon, radiusM: radiusM, ...(droneInfo?.id ? { drone: droneInfo.id } : {}) }, mapUrl: mapUrl(deps.config.publicUrl, { lat: loc.lat, lon: loc.lon, radiusM, drone: droneInfo?.id ?? undefined }) }
    );
  };
}
