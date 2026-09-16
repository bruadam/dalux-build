import { McpServer } from '@modelcontextprotocol/server';
import { Client, InMemoryTransport } from '@modelcontextprotocol/client';
import type { DaluxClient } from 'dalux-build-api';
import { registerTaskTimeline, RESOURCE_URI } from '../src/ui/taskTimeline';

function fakeClient(overrides: Partial<Record<string, unknown>>): DaluxClient {
  return overrides as unknown as DaluxClient;
}

/** Connects an in-process MCP client to `server` over a linked in-memory transport pair. */
async function connectedClient(server: McpServer): Promise<Client> {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'test-client', version: '1.0.0' });
  await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
  return client;
}

describe('registerTaskTimeline', () => {
  it('registers the tool (with ui.resourceUri metadata) and the ui:// resource', async () => {
    const server = new McpServer({ name: 'test', version: '0.0.0' });
    registerTaskTimeline(server, fakeClient({}));
    const client = await connectedClient(server);

    const { tools } = await client.listTools();
    const tool = tools.find((t) => t.name === 'view_tasks_timeline');
    expect(tool).toBeDefined();
    expect((tool?._meta as Record<string, unknown> | undefined)?.ui).toMatchObject({ resourceUri: RESOURCE_URI });
    expect((tool?._meta as Record<string, unknown> | undefined)?.['ui/resourceUri']).toBe(RESOURCE_URI);

    const { resources } = await client.listResources();
    const resource = resources.find((r) => r.uri === RESOURCE_URI);
    expect(resource).toBeDefined();
    expect(resource?.mimeType).toBe('text/html;profile=mcp-app');
  });

  it('reads the ui:// resource back as MCP Apps HTML that embeds the bundled timeline script', async () => {
    const server = new McpServer({ name: 'test', version: '0.0.0' });
    registerTaskTimeline(server, fakeClient({}));
    const client = await connectedClient(server);

    const result = await client.readResource({ uri: RESOURCE_URI });
    const [content] = result.contents;
    expect(content.mimeType).toBe('text/html;profile=mcp-app');
    expect('text' in content).toBe(true);
    const text = (content as { text: string }).text;
    expect(text).toContain('id="root"');
    expect(text.length).toBeGreaterThan(1000); // the inlined esbuild bundle
  });

  it('normalizes selected tasks into timeline rows', async () => {
    const getTask = jest.fn().mockImplementation((_projectId: string, taskId: string) => {
      if (taskId === 't1') {
        return Promise.resolve({ data: { taskId: 't1', number: 'TASK-1', title: 'Inspect slab', status: 'Open', created: '2026-01-02T08:00:00Z', deadline: '2026-01-10T08:00:00Z' } });
      }
      return Promise.resolve({ data: { taskId: 't2', title: 'No dates yet' } });
    });
    const server = new McpServer({ name: 'test', version: '0.0.0' });
    registerTaskTimeline(server, fakeClient({ tasks: { getTask } }));
    const client = await connectedClient(server);

    const result = await client.callTool({
      name: 'view_tasks_timeline',
      arguments: { projectId: 'p1', taskIds: ['t1', 't2'] },
    });

    expect(getTask).toHaveBeenCalledWith('p1', 't1');
    expect(getTask).toHaveBeenCalledWith('p1', 't2');
    const structured = result.structuredContent as { available: boolean; tasks: unknown[] };
    expect(structured.available).toBe(true);
    expect(structured.tasks).toEqual([
      { taskId: 't1', label: 'TASK-1', title: 'Inspect slab', status: 'Open', created: '2026-01-02T08:00:00Z', deadline: '2026-01-10T08:00:00Z' },
      { taskId: 't2', label: 't2', title: 'No dates yet' },
    ]);
    expect(result.isError).toBeFalsy();
  });

  it('reports skipped tasks that fail to load, keeping the ones that succeed', async () => {
    const getTask = jest.fn().mockImplementation((_projectId: string, taskId: string) => {
      if (taskId === 'missing') return Promise.resolve('Task not found');
      return Promise.resolve({ data: { taskId, number: 'TASK-OK' } });
    });
    const server = new McpServer({ name: 'test', version: '0.0.0' });
    registerTaskTimeline(server, fakeClient({ tasks: { getTask } }));
    const client = await connectedClient(server);

    const result = await client.callTool({
      name: 'view_tasks_timeline',
      arguments: { projectId: 'p1', taskIds: ['ok', 'missing'] },
    });

    const structured = result.structuredContent as { available: boolean; skipped: string[] };
    expect(structured.available).toBe(true);
    expect(structured.skipped).toEqual(['missing']);
    expect(result.isError).toBeFalsy();
  });

  it('errors when every requested task fails to load', async () => {
    const getTask = jest.fn().mockResolvedValue('Task not found');
    const server = new McpServer({ name: 'test', version: '0.0.0' });
    registerTaskTimeline(server, fakeClient({ tasks: { getTask } }));
    const client = await connectedClient(server);

    const result = await client.callTool({
      name: 'view_tasks_timeline',
      arguments: { projectId: 'p1', taskIds: ['missing'] },
    });

    expect(result.isError).toBe(true);
    expect(result.structuredContent).toMatchObject({ available: false, skipped: ['missing'] });
  });
});
