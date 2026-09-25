import type { OutputFormat } from '../types.js';
import type { HandlerDependencies, ToolHandler } from './deps.js';
import { brief, respond } from './respond.js';
import { NAME, VERSION } from '../version.js';
import { sqliteCapabilities } from '../pack/driver.js';
import { renderReport, type ReportSection } from '../formatters/report.js';
import { attributionLines } from '../formatters/attribution.js';
import { formatAgeSeconds, formatDate, formatDateTime } from '../formatters/units.js';

export function createGetDataStatusHandler(deps: HandlerDependencies): ToolHandler {
  return async (args) => {
    const format = (args.format as OutputFormat) ?? 'text';
    const packStatus = deps.pack.status();
    const meta = await deps.pack.metaOrNull();
    const notam = deps.notams.status();
    let sqlite: ReturnType<typeof sqliteCapabilities> | { error: string };
    try {
      sqlite = sqliteCapabilities();
    } catch (error) {
      sqlite = { error: (error as Error).message };
    }
    const now = deps.now();
    const airacExpired = !!(meta?.airacNext && new Date(meta.airacNext).getTime() <= now.getTime());
    const attribution = meta ? [...meta.attribution] : [];
    for (const live of attributionLines(['nominatim', 'postcodes_io', ...(deps.config.osNamesApiKey ? (['os_names'] as const) : []), 'notam'], meta)) {
      if (!attribution.includes(live)) attribution.push(live);
    }
    const data = {
      tool: 'get_data_status',
      generatedAt: now.toISOString(),
      server: { name: NAME, version: VERSION, transport: deps.config.transport, node: process.version, sqlite },
      pack: {
        status: packStatus,
        cacheDir: deps.config.cacheDir,
        manifestUrl: deps.config.packManifestUrl,
        meta,
        airacExpired,
      },
      notam: { ...notam, cachedAt: notam.cachedAt?.toISOString() ?? null },
      geocoding: {
        providers: deps.geocoder.providerNames,
        osNamesEnabled: !!deps.config.osNamesApiKey,
        nominatimUrl: deps.config.nominatimUrl,
      },
      attribution,
    };
    const headline = packStatus.state === 'ready' ? `Data pack ready${airacExpired ? ' but AIRAC cycle has expired' : ''}.` : packStatus.state === 'downloading' ? 'Data pack downloading.' : 'Data pack unavailable; only NOTAM and geocoding tools will work.';
    return respond(format, data, () => {
      const sections: ReportSection[] = [];
      const packLines: string[] = [];
      if (packStatus.state === 'ready' && meta) {
        packLines.push(`pack ${meta.packTag} built ${formatDateTime(meta.builtAt)}, region ${meta.region}, schema v${meta.schemaVersion}`);
        packLines.push(`AIRAC effective ${formatDate(meta.airacEffective)} to ${formatDate(meta.airacNext)}${airacExpired ? ' (EXPIRED: a newer pack should exist; restart to refresh)' : ''}`);
        packLines.push(`counts: ${Object.entries(meta.counts).map(([k, v]) => `${k} ${v}`).join(', ')}`);
        for (const s of meta.sources) {
          packLines.push(`${s.id}: ${s.name}; fetched ${formatDateTime(s.fetchedAt)}; ${s.featureCount} features; licence ${s.licence}${s.version ? `; version ${s.version}` : ''}`);
        }
        if (meta.warnings.length > 0) packLines.push(`build warnings: ${meta.warnings.length} (first: ${meta.warnings[0]})`);
      } else if (packStatus.state === 'downloading') {
        packLines.push(`downloading${packStatus.tag ? ` ${packStatus.tag}` : ''}${packStatus.percent !== null ? `: ${packStatus.percent}%` : ''}; pack-backed tools will answer once it is ready`);
      } else if (packStatus.state === 'unavailable') {
        packLines.push(`unavailable: ${packStatus.reason}`);
      }
      packLines.push(`cache dir ${deps.config.cacheDir}`);
      sections.push({ title: 'Airspace data pack', lines: packLines });
      sections.push({
        title: 'NOTAM bulletin',
        lines: [
          `source ${notam.url}`,
          notam.cachedAt ? `cached ${formatDateTime(notam.cachedAt)} (age ${formatAgeSeconds(notam.ageSeconds)}), ${notam.count} NOTAMs` : 'not fetched yet',
          `cache TTL ${formatAgeSeconds(notam.ttlSeconds)}${notam.lastError ? `; last error: ${notam.lastError}` : ''}`,
        ],
      });
      sections.push({
        title: 'Geocoding',
        lines: [`providers in order: ${deps.geocoder.providerNames.join(', ')}`, `OS Names API ${deps.config.osNamesApiKey ? 'enabled' : 'disabled (set OS_NAMES_API_KEY to enable)'}`],
      });
      sections.push({
        title: 'Runtime',
        lines: [`${NAME} ${VERSION} on Node ${process.version}, transport ${deps.config.transport}`, 'error' in sqlite ? `sqlite: ${sqlite.error}` : `SQLite ${sqlite.version} (rtree ${sqlite.rtree ? 'yes' : 'NO'}, fts5 ${sqlite.fts5 ? 'yes' : 'NO'})`],
      });
      return renderReport({ headline, sections, attribution });
    }, () =>
      brief(
        headline,
        meta ? `Pack ${meta.packTag} covers AIRAC ${formatDate(meta.airacEffective)} to ${formatDate(meta.airacNext)} with ${meta.counts.zones ?? 0} zones and ${meta.counts.rights_of_way ?? 0} rights of way` : null,
        notam.cachedAt ? `The NOTAM bulletin is ${formatAgeSeconds(notam.ageSeconds)} old` : 'No NOTAM bulletin fetched yet',
        `Server version ${VERSION}`
      )
    );
  };
}
