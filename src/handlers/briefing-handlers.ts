import type { LandRestriction, NotamHit, OutputFormat } from '../types.js';
import type { HandlerDependencies, ToolHandler } from './deps.js';
import { brief, respond } from './respond.js';
import { locationLine, locationNotes, resolveOrRespond, sourceOfLocation } from './location-handlers.js';
import { droneSectionLines } from './drone-handlers.js';
import { splitLandRestrictions } from '../services/land-rules.js';
import { overallFlyability, renderHour, renderSpaceWeather, selectWeatherWindow, CAVEAT_WEATHER } from './weather-handlers.js';
import type { LocationArgs } from '../tools/schemas.js';
import { UserFacingError } from '../core/errors.js';
import { parseUserDate } from '../services/notam/validity.js';
import { splitByRelevance } from '../services/airspace/vertical.js';
import { buildVerdict } from '../services/airspace/verdict.js';
import { deriveBriefingStatus, type BriefingStatus } from '../services/briefing/status.js';
import type { Forecast } from '../services/weather/open-meteo.js';
import type { SpaceWeather } from '../services/weather/space-weather.js';
import type { NotamQuery } from '../services/notam/index.js';
import { renderReport, type ReportSection } from '../formatters/report.js';
import { renderRestriction, renderZone, zoneToJson } from '../formatters/zones.js';
import { notamToJson, renderNotam } from '../formatters/notams.js';
import { renderRightOfWay, rightOfWayToJson } from '../formatters/rights-of-way.js';
import { renderParking } from '../formatters/parking.js';
import { attributionLines, attributionSentence, type SourceId } from '../formatters/attribution.js';
import { formatDateTime, formatDistance } from '../formatters/units.js';
import { mapUrl } from '../map/view-data.js';
import {
  CAVEAT_AIRSPACE_ONLY_BELOW_120M,
  CAVEAT_BAN_LAYER_INCOMPLETE,
  CAVEAT_BRIEFING_COMPOSITE,
  CAVEAT_DRONE_RULES,
  CAVEAT_NOTAM_SCHEDULE,
  CAVEAT_NOT_BRIEFING,
  CAVEAT_NO_PROW_HERE,
  CAVEAT_PROW_INTERPRETATION,
  CAVEAT_SPACE_WEATHER,
} from './caveats.js';

type Attempt<T> = { ok: true; value: T } | { ok: false; error: string };

/** Live sources may fail; a failure becomes a named outage rather than an exception. */
async function attempt<T>(fn: () => Promise<T>): Promise<Attempt<T>> {
  try {
    return { ok: true, value: await fn() };
  } catch (error) {
    return { ok: false, error: (error as Error).message };
  }
}

const STATUS_WORD: Record<BriefingStatus, string> = { go: 'GO', caution: 'CAUTION', no_go: 'NO-GO' };

export function createPreflightBriefingHandler(deps: HandlerDependencies): ToolHandler {
  return async (args) => {
    const format = (args.format as OutputFormat) ?? 'text';
    const resolved = await resolveOrRespond(deps, 'preflight_briefing', args as LocationArgs, format);
    if ('response' in resolved) return resolved.response;
    const loc = resolved.location;
    const dateArg = typeof args.date === 'string' ? args.date : undefined;
    const bareDate = !!dateArg && /^\d{4}-\d{2}-\d{2}$/.test(dateArg.trim());
    let at: Date;
    try {
      at = parseUserDate(dateArg, deps.now);
    } catch (error) {
      throw new UserFacingError((error as Error).message);
    }
    const hours = typeof args.hours === 'number' ? args.hours : 3;
    const notamRadiusKm = typeof args.notam_radius_km === 'number' ? args.notam_radius_km : 10;
    const maxPaths = typeof args.max_paths === 'number' ? args.max_paths : 3;
    const frzPermission = args.frz_permission === true;
    const droneArg = typeof args.drone === 'string' && args.drone.trim() !== '' ? args.drone.trim() : null;
    const droneInfo = droneArg ? droneSectionLines(droneArg, args.a2_certificate === true, deps.now()) : null;
    const pack = deps.pack.require();

    const [zones, restrictions, notamR, weatherR, spaceR, coverage, parking, hazards] = await Promise.all([
      deps.airspace.atPoint(loc.lon, loc.lat),
      pack.landRestrictionsAt(loc.lon, loc.lat),
      attempt<NotamQuery>(() => deps.notams.nearPoint(loc.lon, loc.lat, notamRadiusKm, at)),
      attempt<Forecast>(() => deps.weather.forecast(loc.lat, loc.lon)),
      attempt<SpaceWeather>(() => deps.spaceWeather.latest()),
      deps.rightsOfWay.coverageAt(loc.lon, loc.lat),
      pack.nearestParking(loc.lon, loc.lat, 2000, 3, false),
      pack.hazardsNear(loc.lon, loc.lat, 500, 10),
    ]);
    const paths = coverage === 'scotland' || coverage === 'northern_ireland' ? [] : await deps.rightsOfWay.nearest(loc.lon, loc.lat, 1000, maxPaths);
    const { relevant, above } = splitByRelevance(zones);
    const land = splitLandRestrictions(restrictions);
    const verdict = buildVerdict(relevant, restrictions);
    const window = weatherR.ok ? selectWeatherWindow(weatherR.value, { start: at, hours, bareDate: bareDate && dateArg ? dateArg.trim() : null }) : [];
    const weatherOverall = window.length > 0 ? overallFlyability(window) : null;
    const space = spaceR.ok ? spaceR.value : null;
    const notams = notamR.ok ? notamR.value : null;
    const { status, reasons } = deriveBriefingStatus({
      zones: relevant,
      restrictions: land.rules,
      frzPermission,
      notams: notams ? { covering: notams.covering, nearby: notams.nearby, unlocated: notams.unlocated.length } : null,
      weather: weatherOverall,
      kp: space?.level ?? null,
      hazards,
      coverage,
      pathsWithin1km: paths.length,
      droneSubcategory: droneInfo?.assessment?.subcategory ?? null,
    });

    const used = new Set<SourceId>(['airspace']);
    if (restrictions.some((r: LandRestriction) => r.sourceId.startsWith('nt_'))) used.add('landowner');
    if (restrictions.some((r: LandRestriction) => r.sourceId === 'byelaws')) used.add('byelaws');
    if (notams) used.add('notam');
    if (window.length > 0) used.add('weather');
    if (space) used.add('space_weather');
    if (paths.length > 0) used.add('prow');
    if (parking.length > 0) used.add('parking');
    if (hazards.length > 0) used.add('hazards');
    if (droneInfo?.assessment) used.add('caa_rules');
    const s = sourceOfLocation(loc);
    if (s) used.add(s);
    const attribution = attributionLines(used, await pack.meta());
    for (const a of new Set(paths.map((p) => p.attribution))) attribution.push(a);

    const outages: string[] = [];
    const caveats = [CAVEAT_NOT_BRIEFING, CAVEAT_BRIEFING_COMPOSITE, CAVEAT_AIRSPACE_ONLY_BELOW_120M, CAVEAT_BAN_LAYER_INCOMPLETE];
    if (!notams) {
      const why = notamR.ok ? 'unknown error' : notamR.error;
      outages.push(`notams: ${why}`);
      caveats.push(`NOTAMs could not be fetched (${why}); run check_notams before flying.`);
    } else {
      if ([...notams.covering, ...notams.nearby].some((n: NotamHit) => n.schedule)) caveats.push(CAVEAT_NOTAM_SCHEDULE);
      if (notams.bulletin.stale) caveats.push(`The NOTAM bulletin could not be refreshed (${notams.bulletin.lastError ?? 'unknown error'}); showing a cached copy.`);
      if (at.getTime() > deps.now().getTime() + 7 * 86_400_000) caveats.push('The bulletin only lists NOTAMs valid within the next 7 days; later dates may miss NOTAMs not yet issued.');
    }
    if (!weatherR.ok) {
      outages.push(`weather: ${weatherR.error}`);
      caveats.push(`Weather forecast unavailable (${weatherR.error}); run check_weather later.`);
    } else if (window.length === 0) caveats.push('The requested time is outside the 7-day forecast, so no weather rating is included.');
    else caveats.push(CAVEAT_WEATHER);
    if (!spaceR.ok) {
      outages.push(`space_weather: ${spaceR.error}`);
      caveats.push(CAVEAT_SPACE_WEATHER);
    }
    caveats.push(coverage === 'scotland' || coverage === 'northern_ireland' ? CAVEAT_NO_PROW_HERE : CAVEAT_PROW_INTERPRETATION);
    if (droneInfo) caveats.push(CAVEAT_DRONE_RULES);

    const windowTo = window.length > 0 ? window[window.length - 1].hour.time : null;
    const headlineReasons = reasons.filter((r) => r.level === status && r.code !== 'clear');
    const headline = [`${STATUS_WORD[status]} for ${loc.name.split(',').slice(0, 2).join(',')} at ${formatDateTime(at)} (${hours} h window).`, ...headlineReasons.map((r) => r.text)].join('\n');
    const daily = weatherR.ok && window.length > 0 ? weatherR.value.daily.find((d) => d.date === window[0].hour.time.slice(0, 10)) : undefined;
    const data = {
      tool: 'preflight_briefing',
      generatedAt: deps.now().toISOString(),
      location: loc,
      at: at.toISOString(),
      window: { from: at.toISOString(), hours, to: windowTo },
      status,
      reasons,
      outages,
      airspace: { verdict, zones: relevant.map((z) => zoneToJson(z)), zonesAbove120m: above.length },
      landownerRules: land.rules,
      councilPolicies: land.policies,
      notams: notams
        ? {
            radiusKm: notamRadiusKm,
            covering: notams.covering.slice(0, 10).map(notamToJson),
            nearby: notams.nearby.slice(0, 10).map(notamToJson),
            unlocatedTotal: notams.unlocated.length,
            bulletin: { ...notams.bulletin, fetchedAt: notams.bulletin.fetchedAt.toISOString(), validFrom: notams.bulletin.validFrom?.toISOString() ?? null, validTo: notams.bulletin.validTo?.toISOString() ?? null },
          }
        : null,
      weather: window.length > 0 ? { overall: weatherOverall, daylight: daily ? { sunrise: daily.sunrise, sunset: daily.sunset } : null, hours: window.map((a) => ({ ...a.hour, flyability: a.flyability, reasons: a.reasons })) } : null,
      spaceWeather: space ? { kp: space.latest.kp, time: space.latest.time, level: space.level, note: space.note } : null,
      access: { coverage, rightsOfWay: paths.map(rightOfWayToJson), parking, hazards },
      drone: droneInfo ? { query: droneArg, label: droneInfo.label, assessment: droneInfo.assessment } : null,
      caveats,
      attribution,
    };
    const tag = (level: string) => `[${level === 'no_go' ? 'no-go' : level}]`;
    return respond(
      format,
      data,
      () => {
        const sections: ReportSection[] = [
          { title: 'Findings', lines: reasons.map((r) => `${tag(r.level)} ${r.text}`) },
          { title: `Airspace restrictions at this point (${relevant.length})`, lines: relevant.map(renderZone) },
          { title: `Landowner rules at this point (${land.rules.length})`, lines: [...land.rules.map(renderRestriction), ...land.policies.map((p) => `Council policy (${p.owner}): ${p.summary ?? ''}`)] },
          { title: `NOTAMs covering the point (${notams ? notams.covering.length : 'unavailable'})`, lines: notams ? [...notams.covering.slice(0, 5).map(renderNotam), ...(notams.covering.length > 5 ? [`+${notams.covering.length - 5} more; see check_notams.`] : [])] : ['The bulletin could not be read.'] },
          { title: `NOTAMs within ${notamRadiusKm} km (${notams ? notams.nearby.length : 'unavailable'})`, lines: notams ? notams.nearby.slice(0, 5).map(renderNotam) : [] },
          { title: `Weather ${window.length > 0 ? window[0].hour.time.slice(0, 10) : ''} (local time, wind in m/s)`, lines: [...window.map(renderHour), ...(space ? [renderSpaceWeather(space)] : [])] },
          {
            title: 'Access',
            lines: [
              ...paths.map(renderRightOfWay),
              ...parking.map(renderParking),
              ...hazards.map((h) => `${formatDistance(h.distanceM)}: ${h.kind.replace('_', ' ')}${h.name ? ` (${h.name})` : ''}`),
            ],
          },
        ];
        if (above.length > 0) sections.push({ title: 'Zones only above 400 ft', lines: [`${above.length} zone(s) start above 400 ft; see check_location with include_above_120m.`] });
        if (droneInfo) sections.push({ title: 'Your drone', lines: droneInfo.lines });
        return renderReport({ headline, notes: locationNotes(loc), location: locationLine(loc), sections, caveats, attribution });
      },
      () =>
        brief(
          `Preflight for ${loc.name.split(',').slice(0, 2).join(',')}: ${STATUS_WORD[status].toLowerCase().replace('-', ' ')}`,
          ...headlineReasons.slice(0, 3).map((r) => r.text),
          window.length > 0 ? `Weather ${weatherOverall} from ${window[0].hour.time.slice(11, 16)}, wind ${window[0].hour.windMs?.toFixed(0) ?? '?'} metres per second` : null,
          outages.length > 0 ? `${outages.length} live source${outages.length > 1 ? 's' : ''} could not be read, so check those separately` : null,
          'Check the full NOTAM list and remember this is not an official briefing',
          attributionSentence(used)
        ),
      { view: { lat: loc.lat, lon: loc.lon, radiusM: 1500, ...(droneInfo?.id ? { drone: droneInfo.id } : {}) }, mapUrl: mapUrl(deps.config.publicUrl, { lat: loc.lat, lon: loc.lon, radiusM: 1500, drone: droneInfo?.id ?? undefined }) }
    );
  };
}
