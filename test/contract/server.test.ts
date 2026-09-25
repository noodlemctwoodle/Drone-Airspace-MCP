import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { describe, expect, it } from 'vitest';
import { createServer } from '../../src/server.js';
import { buildTestDeps } from '../helpers/build-deps.js';
import { fakeFetch } from '../helpers/fake-fetch.js';
import { readFileSync } from 'node:fs';

const bristol = JSON.parse(readFileSync(new URL('../fixtures/geocode/nominatim-bristol.json', import.meta.url), 'utf8'));

async function connect() {
  const ff = fakeFetch([{ match: 'nominatim', body: bristol }]);
  const { deps } = buildTestDeps({ fetchImpl: ff.fetch });
  const server = createServer(deps);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const client = new Client({ name: 'test', version: '0' });
  await client.connect(clientTransport);
  return { client, server };
}

describe('MCP server end to end', () => {
  it('lists every tool with schemas', async () => {
    const { client } = await connect();
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(['check_drone_rules', 'check_location', 'check_notams', 'check_route', 'check_takeoff_site', 'check_terrain', 'check_weather', 'find_parking', 'geocode', 'get_aerodrome_zone', 'get_data_status', 'preflight_briefing']);
    const check = tools.find((t) => t.name === 'check_location')!;
    expect(check.inputSchema.properties).toHaveProperty('place');
    expect(check.inputSchema.properties).toHaveProperty('lat');
  });
  it('answers check_location by coordinates and by place', async () => {
    const { client } = await connect();
    const byCoord = await client.callTool({ name: 'check_location', arguments: { lat: 51.3827, lon: -2.7191 } });
    const text = (byCoord.content as Array<{ text: string }>)[0].text;
    expect(text).toContain('Inside EGGD BRISTOL FRZ (FRZ)');
    expect(text).toContain('Attribution:');
    const byPlace = await client.callTool({ name: 'check_location', arguments: { place: 'Bristol', format: 'json' } });
    const json = JSON.parse((byPlace.content as Array<{ text: string }>)[0].text);
    expect(json.location.source).toBe('nominatim');
    expect(json.verdict.severity).toBe(0);
  });
  it('validates arguments through zod', async () => {
    const { client } = await connect();
    const res = await client.callTool({ name: 'check_location', arguments: { lat: 95 } });
    expect(res.isError).toBe(true);
  });
  it('rejects place plus coordinates with a clear message', async () => {
    const { client } = await connect();
    const res = await client.callTool({ name: 'check_location', arguments: { place: 'x', lat: 51, lon: -2 } });
    expect(res.isError).toBe(true);
    expect((res.content as Array<{ text: string }>)[0].text).toMatch(/not both/);
  });
});
