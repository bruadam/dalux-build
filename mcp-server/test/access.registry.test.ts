import { Client, InMemoryTransport } from '@modelcontextprotocol/client';
import type { DaluxClient } from 'dalux-build-api';

import type { RequestContext } from '../src/access/context';
import { CAPABILITIES, TOOL_ACCESS } from '../src/access/registry';
import { buildServer } from '../src/server';

async function registeredTools(context?: RequestContext) {
  const getProject = jest.fn(async () => ({ data: { projectId: 'p1' } }));
  const server = buildServer({ projects: { getProject } } as unknown as DaluxClient, { context });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'test-client', version: '1.0.0' });
  await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
  return { client, getProject };
}

describe('tool access registry', () => {
  it('declares a capability for every registered tool, and nothing else', async () => {
    const { client } = await registeredTools();
    const { tools } = await client.listTools();
    const names = tools.map((tool) => tool.name).sort();

    expect(Object.keys(TOOL_ACCESS).sort()).toEqual(names);
    for (const name of names) {
      expect([...CAPABILITIES, 'none']).toContain(TOOL_ACCESS[name].capability);
    }
  });

  it('flags only the index build and drop tools as admin-only', () => {
    const adminOnly = Object.entries(TOOL_ACCESS)
      .filter(([, access]) => access.adminOnly)
      .map(([name]) => name)
      .sort();
    expect(adminOnly).toEqual(['build_file_area_index', 'build_task_index', 'drop_file_area_index', 'drop_task_index']);
  });

  it('refuses a tool call outside the caller\'s access before calling Dalux', async () => {
    const context: RequestContext = {
      account: { id: 'a1', role: 'user' },
      connection: { id: 'c1' },
      access: [{ connectionId: 'c1', capability: 'projects:read', projectId: 'p1', fileAreaId: null, folderId: null }],
    };
    const { client, getProject } = await registeredTools(context);

    const denied = await client.callTool({ name: 'get_project', arguments: { projectId: 'p2' } });
    expect(denied.isError).toBe(true);
    expect(JSON.stringify(denied.content)).toContain('projects:read');
    expect(getProject).not.toHaveBeenCalled();

    const allowed = await client.callTool({ name: 'get_project', arguments: { projectId: 'p1' } });
    expect(allowed.isError).toBeFalsy();
    expect(getProject).toHaveBeenCalledTimes(1);
  });
});
