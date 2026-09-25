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

/** Render `data` as JSON or via `renderText`, according to `format`. */
export function respond(format: OutputFormat, data: unknown, renderText: () => string): ToolResponse {
  return format === 'json' ? jsonResponse(data) : textResponse(renderText());
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
  });
}

export function notFoundResponse(format: OutputFormat, tool: string, query: string): ToolResponse {
  const data = { tool, status: 'not_found', query };
  return respond(format, data, () => `No UK location found for "${query}". Try a nearby town or postcode, or give lat/lon.`);
}
