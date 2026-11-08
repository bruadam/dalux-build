import type { DaluxClient } from 'dalux-build-api';
import type { Db } from '@dalux-platform/db';
import { Client, InMemoryTransport } from '@modelcontextprotocol/client';
import { buildServer } from '../src/server';
import { buildHttpApp } from '../src/http';
import { DEFAULT_TOOLSETS, parseToolsets, TOOLSET_NAMES, TOOLSETS, type Toolset } from '../src/toolsets';

async function listedTools(toolsets?: readonly Toolset[]): Promise<{ client: Client; names: string[] }> {
  // memory tools exist only in platform mode, which has a database
  const server = buildServer({} as DaluxClient, { toolsets, memoryDb: {} as Db });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'test-client', version: '1.0.0' });
  await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
  const { tools } = await client.listTools();
  return { client, names: tools.map((tool) => tool.name) };
}

describe('parseToolsets', () => {
  it('uses the default for an empty selection', () => {
    expect(parseToolsets(undefined)).toEqual(DEFAULT_TOOLSETS);
    expect(parseToolsets(' ')).toEqual(DEFAULT_TOOLSETS);
  });

  it('always adds core and expands default and all', () => {
    expect(parseToolsets('ifc')).toEqual(['core', 'ifc']);
    expect(parseToolsets('default, ifc')).toEqual([...DEFAULT_TOOLSETS, 'ifc']);
    expect(parseToolsets('all')).toEqual(TOOLSET_NAMES);
  });

  it('rejects an unknown toolset', () => {
    expect(() => parseToolsets('files,bim')).toThrow('Unknown toolset "bim"');
  });
});

describe('toolset selection', () => {
  it('puts every registered tool in exactly one toolset', async () => {
    const { names } = await listedTools(TOOLSET_NAMES);
    const grouped = Object.values(TOOLSETS).flat();
    expect(new Set(grouped).size).toBe(grouped.length);
    expect([...grouped].sort()).toEqual([...names].sort());
  });

  it('lists only the default toolsets by default', async () => {
    const { names } = await listedTools();
    expect(names.sort()).toEqual(DEFAULT_TOOLSETS.flatMap((toolset) => TOOLSETS[toolset]).sort());
  });

  it('refuses to call a tool outside the enabled toolsets', async () => {
    const { client, names } = await listedTools(['core']);
    expect(names).not.toContain('list_files');
    await expect(
      client.callTool({ name: 'list_files', arguments: { projectId: 'p', fileAreaId: 'a' } }),
    ).rejects.toThrow('Tool list_files not found');
  });
});

describe('HTTP ?toolsets=', () => {
  const headers = {
    'content-type': 'application/json',
    accept: 'application/json, text/event-stream',
    'x-dalux-base-url': 'https://node1.field.dalux.com/service/api/',
    'x-dalux-api-key': 'key',
  };

  it('answers 400 for an unknown toolset', async () => {
    const { handleRequest } = buildHttpApp({});
    const response = await handleRequest(
      new Request('http://localhost/mcp?toolsets=bim', { method: 'POST', headers, body: '{}' }),
    );
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: 'invalid_toolsets' });
  });
});
