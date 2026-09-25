import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { HandlerDependencies } from './handlers/deps.js';
import { createHandlers } from './handlers/index.js';
import { errorResponse } from './handlers/respond.js';
import { toolDefinitions } from './tools/definitions.js';
import { NAME, VERSION } from './version.js';
import { MAP_CSP, MAP_RESOURCE_MIME, MAP_RESOURCE_URI, mapHtml } from './map/index.js';

/** Tools whose result is best shown on a map (MCP Apps hosts render the app inline). */
const MAP_TOOLS = new Set(['check_location', 'check_takeoff_site', 'check_route', 'find_parking']);

export function createServer(deps: HandlerDependencies): McpServer {
  const server = new McpServer({ name: NAME, version: VERSION });
  const handlers = createHandlers(deps);
  const apiBase = deps.config.publicUrl ?? null;
  server.registerResource(
    'map',
    MAP_RESOURCE_URI,
    {
      title: 'Airspace map',
      description: 'Interactive map of restriction zones, NOTAMs, rights of way, landowner rules and parking around a point or route.',
      mimeType: MAP_RESOURCE_MIME,
      _meta: { ui: { csp: { resourceDomains: [...MAP_CSP.resourceDomains], connectDomains: [...(apiBase ? [apiBase] : []), ...MAP_CSP.connectDomains] }, prefersBorder: true } },
    },
    async () => ({ contents: [{ uri: MAP_RESOURCE_URI, mimeType: MAP_RESOURCE_MIME, text: mapHtml({ mode: 'app', apiBase }) }] })
  );
  for (const def of toolDefinitions) {
    const handler = handlers.get(def.name);
    if (!handler) throw new Error(`No handler registered for tool ${def.name}`);
    server.registerTool(
      def.name,
      {
        title: def.annotations.title,
        description: def.description,
        inputSchema: def.inputSchema,
        annotations: def.annotations,
        ...(MAP_TOOLS.has(def.name) && apiBase ? { _meta: { ui: { resourceUri: MAP_RESOURCE_URI } } } : {}),
      },
      async (args) => {
        try {
          return await handler((args ?? {}) as Record<string, unknown>);
        } catch (error) {
          return errorResponse(error, deps.logger);
        }
      }
    );
  }
  return server;
}
