import type { GeocodeCandidate, OutputFormat, ToolResponse } from '../types.js';
import { errorMessage, UserFacingError } from '../core/errors.js';
import type { Logger } from '../core/logger.js';
import { formatCoord } from '../formatters/units.js';

export function textResponse(text: string): ToolResponse {
  return { content: [{ type: 'text', text }] };
}

export function jsonResponse(value: unknown): ToolResponse {
  return { content: [{ type: 'text', text: JSON.stringify(value, null, 2) }] };
}

/**
 * Render `data` as JSON, as the full text report, or as a brief spoken-friendly
 * summary (falls back to the full report when a tool has no brief renderer).
 */
export interface RespondExtras {
  /** Small descriptor for the map app; never bulky geometry. */
  view?: { lat: number; lon: number; radiusM?: number; route?: number[][]; drone?: string };
  mapUrl?: string | null;
}

export function respond(format: OutputFormat, data: unknown, renderText: () => string, renderBrief?: () => string, extras: RespondExtras = {}): ToolResponse {
  let res: ToolResponse;
  if (format === 'json') res = jsonResponse(extras.mapUrl ? { ...(data as object), mapUrl: extras.mapUrl } : data);
  else if (format === 'brief' && renderBrief) res = textResponse(renderBrief());
  else res = textResponse(extras.mapUrl ? `${renderText()}\nMap: ${extras.mapUrl}` : renderText());
  // Never structuredContent: Claude's connector shows the model structuredContent instead of the text.
  if (extras.view) res._meta = { ui: { view: extras.view } };
  return res;
}

/** Join sentences for speech: one paragraph, no bullets, no coordinates. */
export function brief(...sentences: Array<string | null | undefined | false>): string {
  return sentences
    .filter((s): s is string => typeof s === 'string' && s.trim() !== '')
    .map((s) => s.trim().replace(/\s+/g, ' '))
    .map((s) => (/[.!?]$/.test(s) ? s : `${s}.`))
    .join(' ');
}

export function errorResponse(error: unknown, logger?: Logger): ToolResponse {
  const message = errorMessage(error);
  if (!(error instanceof UserFacingError)) logger?.warn(`tool error: ${message}`);
  return { content: [{ type: 'text', text: `Error: ${message}` }], isError: true };
}

export function ambiguousResponse(format: OutputFormat, tool: string, query: string, candidates: GeocodeCandidate[]): ToolResponse {
  const data = { tool, status: 'ambiguous', query, candidates };
  return respond(format, data, () => {
    const lines = [`Several places match "${query}". Call again with lat/lon or a more specific place.`];
    candidates.forEach((c, i) => {
      lines.push(`  ${i + 1}. ${c.name} (${formatCoord(c.lat, c.lon)}) [${c.source}]`);
    });
    return lines.join('\n');
  }, () => brief(`Several places match ${query}: ${candidates.slice(0, 3).map((c) => c.name.split(',').slice(0, 2).join(',')).join('; ')}`, 'Which one did you mean?'));
}

export function notFoundResponse(format: OutputFormat, tool: string, query: string): ToolResponse {
  const data = { tool, status: 'not_found', query };
  return respond(format, data, () => `No UK location found for "${query}". Try a nearby town or postcode, or give lat/lon.`);
}
