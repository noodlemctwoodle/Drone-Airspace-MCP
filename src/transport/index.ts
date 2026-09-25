import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

export interface MCPTransport {
  start(): Promise<void>;
  stop(): Promise<void>;
}

export type ServerFactory = () => McpServer;
