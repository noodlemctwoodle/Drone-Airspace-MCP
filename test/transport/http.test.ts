import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createLogger } from '../../src/core/logger.js';
import { createServer } from '../../src/server.js';
import { StreamableHttpTransport } from '../../src/transport/http.js';
import { buildTestDeps } from '../helpers/build-deps.js';

describe('streamable http transport', () => {
  const { deps } = buildTestDeps();
  const transport = new StreamableHttpTransport(() => createServer(deps), createLogger('silent'), 0, () => ({ version: 'test', pack: deps.pack.status(), notamCacheAgeSeconds: null }), '127.0.0.1');
  beforeAll(() => transport.start());
  afterAll(() => transport.stop());

  it('serves healthz', async () => {
    const res = await fetch(`http://127.0.0.1:${transport.port}/healthz`);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, version: 'test' });
  });
  it('rejects GET /mcp', async () => {
    const res = await fetch(`http://127.0.0.1:${transport.port}/mcp`);
    expect(res.status).toBe(405);
  });
  it('completes an MCP session over HTTP', async () => {
    const client = new Client({ name: 'test', version: '0' });
    await client.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${transport.port}/mcp`)));
    const { tools } = await client.listTools();
    expect(tools.length).toBe(7);
    const r = await client.callTool({ name: 'get_data_status', arguments: {} });
    expect((r.content as Array<{ text: string }>)[0].text).toContain('Data pack ready');
    await client.close();
  });
});
