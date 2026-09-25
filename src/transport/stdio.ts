import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { Logger } from '../core/logger.js';
import type { MCPTransport } from './index.js';

export class StdioTransport implements MCPTransport {
  private server: McpServer | undefined;

  constructor(
    private readonly createServer: () => McpServer,
    private readonly logger: Logger
  ) {}

  async start(): Promise<void> {
    this.server = this.createServer();
    await this.server.connect(new StdioServerTransport());
    this.logger.info('listening on stdio');
  }

  async stop(): Promise<void> {
    await this.server?.close();
  }
}
