import type { OutputFormat } from '../types.js';
import type { HandlerDependencies, ToolHandler } from './deps.js';
import { respond } from './respond.js';
import { locationLine, locationNotes, resolveOrRespond, sourceOfLocation } from './location-handlers.js';
import type { LocationArgs } from '../tools/schemas.js';
import { parseUserDate } from '../services/notam/validity.js';
import { UserFacingError } from '../core/errors.js';
import { renderReport } from '../formatters/report.js';
import { notamToJson, renderNotam, renderUnlocated } from '../formatters/notams.js';
import { attributionLines, type SourceId } from '../formatters/attribution.js';
import { formatAgeSeconds, formatDateTime } from '../formatters/units.js';
import { CAVEAT_NOTAM_SCHEDULE, CAVEAT_NOT_BRIEFING } from './caveats.js';

export function createCheckNotamsHandler(deps: HandlerDependencies): ToolHandler {
  return async (args) => {
    const format = (args.format as OutputFormat) ?? 'text';
    const resolved = await resolveOrRespond(deps, 'check_notams', args as LocationArgs, format);
    if ('response' in resolved) return resolved.response;
    const loc = resolved.location;
    const radiusKm = typeof args.radius_km === 'number' ? args.radius_km : 0;
    const maxResults = typeof args.max_results === 'number' ? args.max_results : 20;
    let at: Date;
    try {
      at = parseUserDate(typeof args.date === 'string' ? args.date : undefined, deps.now);
    } catch (error) {
      throw new UserFacingError((error as Error).message);
    }
    const q = await deps.notams.nearPoint(loc.lon, loc.lat, radiusKm, at);
    const covering = q.covering.slice(0, maxResults);
    const nearby = q.nearby.slice(0, Math.max(0, maxResults - covering.length));
    const unlocated = q.unlocated.slice(0, 20);
    const used = new Set<SourceId>(['notam']);
    const s = sourceOfLocation(loc);
    if (s) used.add(s);
    const attribution = attributionLines(used, deps.pack.metaOrNull());
    const caveats = [CAVEAT_NOT_BRIEFING];
    if ([...covering, ...nearby].some((n) => n.schedule)) caveats.push(CAVEAT_NOTAM_SCHEDULE);
    if (q.bulletin.stale) caveats.push(`The bulletin could not be refreshed (${q.bulletin.lastError ?? 'unknown error'}); showing a cached copy.`);
    if (at.getTime() > deps.now().getTime() + 7 * 86_400_000) caveats.push('The bulletin only lists NOTAMs valid within the next 7 days; later dates may miss NOTAMs not yet issued.');

    const data = {
      tool: 'check_notams',
      generatedAt: deps.now().toISOString(),
      location: loc,
      at: at.toISOString(),
      radiusKm,
      bulletin: { ...q.bulletin, fetchedAt: q.bulletin.fetchedAt.toISOString(), validFrom: q.bulletin.validFrom?.toISOString() ?? null, validTo: q.bulletin.validTo?.toISOString() ?? null },
      covering: covering.map(notamToJson),
      nearby: nearby.map(notamToJson),
      unlocated: unlocated.map(notamToJson),
      unlocatedTotal: q.unlocated.length,
      caveats,
      attribution,
    };
    return respond(format, data, () => {
      const headline =
        covering.length === 0
          ? `No NOTAM covers this point at ${formatDateTime(at)}.`
          : `${covering.length} NOTAM${covering.length > 1 ? 's' : ''} cover${covering.length > 1 ? '' : 's'} this point at ${formatDateTime(at)}.`;
      const notes = locationNotes(loc);
      notes.push(`Bulletin fetched ${formatDateTime(q.bulletin.fetchedAt)} (cache age ${formatAgeSeconds(q.bulletin.ageSeconds)}), ${q.bulletin.count} NOTAMs in force or upcoming.`);
      const sections = [
        { title: `Covering the point (${covering.length})`, lines: covering.map(renderNotam) },
        { title: `Within ${radiusKm} km of the point (${nearby.length})`, lines: radiusKm > 0 ? nearby.map(renderNotam) : [] },
        {
          title: `Without a usable position (${q.unlocated.length}${q.unlocated.length > unlocated.length ? `, first ${unlocated.length} shown` : ''})`,
          lines: unlocated.map(renderUnlocated),
        },
      ];
      return renderReport({ headline, notes, location: locationLine(loc), sections, caveats, attribution });
    });
  };
}
