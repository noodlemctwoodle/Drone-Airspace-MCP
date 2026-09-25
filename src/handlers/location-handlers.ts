import type { OutputFormat, ResolvedLocation, Zone } from '../types.js';
import type { HandlerDependencies, ToolHandler } from './deps.js';
import { ambiguousResponse, brief, notFoundResponse, respond } from './respond.js';
import { resolveLocation } from '../services/location-resolver.js';
import { validateLocationArgs, type LocationArgs } from '../tools/schemas.js';
import { UserFacingError } from '../core/errors.js';
import { splitByRelevance } from '../services/airspace/vertical.js';
import { localAuthorityLines, splitLandRestrictions } from '../services/land-rules.js';
import { buildVerdict } from '../services/airspace/verdict.js';
import { renderReport, type ReportSection } from '../formatters/report.js';
import { renderRestriction, renderZone, zoneToJson } from '../formatters/zones.js';
import { attributionLines, attributionSentence, type SourceId } from '../formatters/attribution.js';
import { formatCoord } from '../formatters/units.js';
import { mapUrl } from '../map/view-data.js';
import { CAVEAT_AIRSPACE_ONLY_BELOW_120M, CAVEAT_BAN_LAYER_INCOMPLETE, CAVEAT_NOTAMS_NOT_INCLUDED, CAVEAT_NOT_BRIEFING } from './caveats.js';

export function sourceOfLocation(loc: ResolvedLocation): SourceId | null {
  switch (loc.source) {
    case 'nominatim':
      return 'nominatim';
    case 'os_names':
      return 'os_names';
    case 'postcodes.io':
      return 'postcodes_io';
    default:
      return null;
  }
}

export function locationLine(loc: ResolvedLocation): string {
  if (loc.source === 'input') return `${formatCoord(loc.lat, loc.lon)} (coordinates as given)`;
  return `${loc.name} (${formatCoord(loc.lat, loc.lon)}) via ${loc.source}`;
}

export function locationNotes(loc: ResolvedLocation): string[] {
  const notes: string[] = [];
  if (loc.resolvedFrom) notes.push(`"${loc.resolvedFrom.original}" was not found; results are for "${loc.resolvedFrom.used}".`);
  if (loc.alternatives && loc.alternatives.length > 0) {
    notes.push(`Other matches: ${loc.alternatives.map((a) => a.name).join(' | ')}. Pass lat/lon to pick one.`);
  }
  return notes;
}

/** Shared resolve step. Returns a ToolResponse when the caller should stop (ambiguous / not found). */
export async function resolveOrRespond(
  deps: HandlerDependencies,
  tool: string,
  args: LocationArgs,
  format: OutputFormat
): Promise<{ location: ResolvedLocation } | { response: ReturnType<typeof ambiguousResponse> }> {
  const problem = validateLocationArgs(args);
  if (problem) throw new UserFacingError(problem);
  const resolution = await resolveLocation(args, deps.geocoder);
  if (resolution.status === 'ambiguous') return { response: ambiguousResponse(format, tool, resolution.query, resolution.candidates) };
  if (resolution.status === 'not_found') return { response: notFoundResponse(format, tool, resolution.query) };
  return { location: resolution.location };
}

export function createCheckLocationHandler(deps: HandlerDependencies): ToolHandler {
  return async (args) => {
    const format = (args.format as OutputFormat) ?? 'text';
    const includeAbove = args.include_above_120m === true;
    const resolved = await resolveOrRespond(deps, 'check_location', args as LocationArgs, format);
    if ('response' in resolved) return resolved.response;
    const loc = resolved.location;
    const pack = deps.pack.require();

    const zones = await deps.airspace.atPoint(loc.lon, loc.lat);
    const { relevant, above } = splitByRelevance(zones);
    const restrictions = await pack.landRestrictionsAt(loc.lon, loc.lat);
    const council = await pack.adminAreaAt(loc.lon, loc.lat);
    const land = splitLandRestrictions(restrictions);
    const verdict = buildVerdict(relevant, restrictions);
    const used = new Set<SourceId>(['airspace']);
    if (land.rules.length > 0) used.add(land.rules.some((r) => r.sourceId === 'byelaws') ? 'byelaws' : 'landowner');
    if (land.policies.length > 0) used.add('byelaws');
    if (council) used.add('lad');
    const locSource = sourceOfLocation(loc);
    if (locSource) used.add(locSource);
    const attribution = attributionLines(used, await pack.meta());
    const caveats = [CAVEAT_AIRSPACE_ONLY_BELOW_120M, CAVEAT_NOTAMS_NOT_INCLUDED, CAVEAT_BAN_LAYER_INCOMPLETE, CAVEAT_NOT_BRIEFING];

    const data = {
      tool: 'check_location',
      generatedAt: deps.now().toISOString(),
      location: loc,
      verdict,
      zones: relevant.map((z) => zoneToJson(z)),
      zonesAbove120m: includeAbove ? above.map((z) => zoneToJson(z)) : above.length,
      landownerRules: land.rules,
      localAuthority: council ? { code: council.code, name: council.name, policies: land.policies } : null,
      caveats,
      attribution,
    };
    return respond(format, data, () => {
      const sections: ReportSection[] = [
        { title: `Airspace restrictions at this point (${relevant.length})`, lines: relevant.map(renderZone) },
      ];
      if (includeAbove) sections.push({ title: `Zones only above 400 ft (${above.length})`, lines: above.map(renderZone) });
      else if (above.length > 0) sections.push({ title: 'Zones only above 400 ft', lines: [`${above.length} zone(s) start above 400 ft; pass include_above_120m to list them.`] });
      sections.push({ title: `Landowner rules at this point (${land.rules.length})`, lines: land.rules.map(renderRestriction) });
      sections.push({ title: 'Local authority', lines: localAuthorityLines(council, land.policies) });
      const headline = verdict.landownerLine ? `${verdict.line}\n${verdict.landownerLine}` : verdict.line;
      return renderReport({ headline, notes: locationNotes(loc), location: locationLine(loc), sections, caveats, attribution });
    }, () =>
      brief(
        loc.resolvedFrom ? `I could not find ${loc.resolvedFrom.original}, so this is for ${loc.resolvedFrom.used}` : null,
        `At ${loc.name.split(',').slice(0, 2).join(',')}: ${verdict.line}`,
        verdict.landownerLine,
        relevant.length > 1 ? `${relevant.length} restrictions apply in total` : null,
        'This does not include temporary NOTAMs',
        attributionSentence(used)
      ),
      { view: { lat: loc.lat, lon: loc.lon, radiusM: 1500 }, mapUrl: mapUrl(deps.config.publicUrl, { lat: loc.lat, lon: loc.lon, radiusM: 1500 }) }
    );
  };
}

export function createGeocodeHandler(deps: HandlerDependencies): ToolHandler {
  return async (args) => {
    const format = (args.format as OutputFormat) ?? 'text';
    const query = String(args.query ?? '').trim();
    if (!query) throw new UserFacingError('query is required.');
    const limit = typeof args.limit === 'number' ? args.limit : 5;
    const result = await deps.geocoder.geocode(query, limit);
    const used = new Set<SourceId>();
    for (const c of result.candidates) {
      const s = sourceOfLocation({ ...c, source: c.source } as ResolvedLocation);
      if (s) used.add(s);
    }
    const attribution = attributionLines(used, await deps.pack.metaOrNull());
    const data = { tool: 'geocode', ...result, attribution };
    return respond(format, data, () => {
      if (result.candidates.length === 0) return `No UK location found for "${query}". Try a nearby town or postcode.\n\nAttribution: none`;
      const lines = [`${result.candidates.length} match${result.candidates.length > 1 ? 'es' : ''} for "${query}"${result.usedFallback ? ` (searched as "${result.usedQuery}")` : ''}:`];
      result.candidates.forEach((c, i) => {
        lines.push(`  ${i + 1}. ${c.name} (${formatCoord(c.lat, c.lon)}) [${c.source}, confidence ${c.confidence.toFixed(2)}${c.type ? `, ${c.type}` : ''}]`);
      });
      lines.push('');
      lines.push(`Attribution: ${attribution.join('; ') || 'none'}`);
      return lines.join('\n');
    }, () =>
      result.candidates.length === 0
        ? brief(`I could not find ${query} in the UK`)
        : brief(`Best match for ${query}: ${result.candidates[0].name}`, result.candidates.length > 1 ? `${result.candidates.length - 1} other possible matches` : null)
    );
  };
}

export function zonesJson(zones: Zone[]) {
  return zones.map((z) => zoneToJson(z));
}
