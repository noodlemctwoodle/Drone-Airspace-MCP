import type { OutputFormat } from '../types.js';
import type { HandlerDependencies, ToolHandler } from './deps.js';
import { brief, respond } from './respond.js';
import { locationLine, locationNotes, resolveOrRespond, sourceOfLocation } from './location-handlers.js';
import type { LocationArgs } from '../tools/schemas.js';
import { splitByRelevance } from '../services/airspace/vertical.js';
import { buildVerdict } from '../services/airspace/verdict.js';
import { renderReport, type ReportSection } from '../formatters/report.js';
import { renderRestriction, renderZone, zoneToJson } from '../formatters/zones.js';
import { renderRightOfWay, rightOfWayToJson } from '../formatters/rights-of-way.js';
import { attributionLines, attributionSentence, type SourceId } from '../formatters/attribution.js';
import { formatDistance } from '../formatters/units.js';
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
    const pack = deps.pack.require();

    const zones = await deps.airspace.atPoint(loc.lon, loc.lat);
    const { relevant, above } = splitByRelevance(zones);
    const restrictions = await pack.landRestrictionsAt(loc.lon, loc.lat);
    const verdict = buildVerdict(relevant, restrictions);
    const coverage = await deps.rightsOfWay.coverageAt(loc.lon, loc.lat);
    const paths = coverage === 'scotland' || coverage === 'northern_ireland' ? [] : await deps.rightsOfWay.nearest(loc.lon, loc.lat, radiusM, maxPaths);
    const takeoffBanned = restrictions.some((r) => r.takeoffBanned);

    const used = new Set<SourceId>(['airspace']);
    if (paths.length > 0) used.add('prow');
    if (restrictions.some((r) => r.sourceId.startsWith('nt_'))) used.add('landowner');
    if (restrictions.some((r) => r.sourceId === 'byelaws')) used.add('byelaws');
    const s = sourceOfLocation(loc);
    if (s) used.add(s);
    const attribution = attributionLines(used, await pack.meta());
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
      landownerRules: restrictions,
      rightsOfWay: paths.map(rightOfWayToJson),
      coverage: coverage === 'england_wales' ? 'england_wales' : coverage === 'unknown' ? 'unknown' : 'no_prow_data',
      searchRadiusM: radiusM,
      caveats,
      attribution,
    };
    return respond(format, data, () => {
      const sections: ReportSection[] = [
        { title: `Nearest public rights of way (${paths.length} within ${formatDistance(radiusM)})`, lines: paths.map(renderRightOfWay) },
        { title: `Landowner rules at this point (${restrictions.length})`, lines: restrictions.map(renderRestriction) },
        { title: `Airspace restrictions at this point (${relevant.length})`, lines: relevant.map(renderZone) },
      ];
      if (above.length > 0) sections.push({ title: 'Zones only above 400 ft', lines: [`${above.length} zone(s) start above 400 ft; see check_location with include_above_120m.`] });
      return renderReport({ headline: headlineParts.join('\n'), notes: locationNotes(loc), location: locationLine(loc), sections, caveats, attribution });
    }, () =>
      brief(
        loc.resolvedFrom ? `I could not find ${loc.resolvedFrom.original}, so this is for ${loc.resolvedFrom.used}` : null,
        `For take-off near ${loc.name.split(',').slice(0, 2).join(',')}: ${headlineParts.join(' ')}`,
        paths.length > 1 ? `${paths.length} public rights of way within ${formatDistance(radiusM)} in total` : null,
        coverage === 'scotland' || coverage === 'northern_ireland' ? 'There is no rights-of-way data for this area' : 'Rights of way are an interpretation of the council definitive map',
        'Check NOTAMs separately and remember the landowner rule layer is incomplete',
        attributionSentence(used)
      )
    );
  };
}
