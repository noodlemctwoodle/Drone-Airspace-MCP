import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { HandlerDependencies } from './handlers/deps.js';
import { createHandlers } from './handlers/index.js';
import { errorResponse } from './handlers/respond.js';
import { toolDefinitions } from './tools/definitions.js';
import { NAME, VERSION } from './version.js';

export function createServer(deps: HandlerDependencies): McpServer {
  const server = new McpServer({ name: NAME, version: VERSION });
  const handlers = createHandlers(deps);
  for (const def of toolDefinitions) {
    const handler = handlers.get(def.name);
    if (!handler) throw new Error(`No handler registered for tool ${def.name}`);
    server.registerTool(
      def.name,
      { title: def.annotations.title, description: def.description, inputSchema: def.inputSchema, annotations: def.annotations },
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
