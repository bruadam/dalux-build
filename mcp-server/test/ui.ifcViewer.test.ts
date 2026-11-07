import { McpServer } from '@modelcontextprotocol/server';
import { Client, InMemoryTransport } from '@modelcontextprotocol/client';
import type { DaluxClient } from 'dalux-build-api';
import { registerIfcViewer, RESOURCE_URI } from '../src/ui/ifcViewer';

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

describe('registerIfcViewer', () => {
  async function setup(client: DaluxClient = fakeClient({})): Promise<Client> {
    const server = new McpServer({ name: 'test', version: '0.0.0' });
    registerIfcViewer(server, client);
    return connectedClient(server);
  }

  it('registers view_model_3d (with ui.resourceUri metadata), app-only viewer tools, and the ui:// resource', async () => {
    const client = await setup();

    const { tools } = await client.listTools();
    const tool = tools.find((t) => t.name === 'view_model_3d');
    expect((tool?._meta as Record<string, unknown> | undefined)?.ui).toMatchObject({ resourceUri: RESOURCE_URI });
    expect((tool?._meta as Record<string, unknown> | undefined)?.['ui/resourceUri']).toBe(RESOURCE_URI);
    for (const name of ['ifc_viewer_geometry', 'ifc_viewer_element', 'ifc_viewer_selection']) {
      const appTool = tools.find((t) => t.name === name);
      expect((appTool?._meta as { ui?: { visibility?: string[] } } | undefined)?.ui?.visibility).toEqual(['app']);
    }

    const { resources } = await client.listResources();
    expect(resources.find((r) => r.uri === RESOURCE_URI)?.mimeType).toBe('text/html;profile=mcp-app');
  });

  it('serves MCP Apps HTML that inlines the bundled viewer and needs no CSP domains', async () => {
    const client = await setup();

    const [content] = (await client.readResource({ uri: RESOURCE_URI })).contents;
    expect(content.mimeType).toBe('text/html;profile=mcp-app');
    const text = (content as { text: string }).text;
    expect(text).toContain('id="root"');
    expect(text.length).toBeGreaterThan(1000); // the inlined esbuild bundle
    expect((content._meta as { ui?: { csp?: unknown } } | undefined)?.ui?.csp).toBeUndefined();
  });

  it('rejects a file that is not an .ifc', async () => {
    const getFile = jest.fn().mockResolvedValue({ data: { fileName: 'spec.pdf' } });
    const client = await setup(fakeClient({ files: { getFile } }));

    const result = await client.callTool({ name: 'view_model_3d', arguments: { projectId: 'p1', fileAreaId: 'fa1', fileId: 'f1' } });

    expect(getFile).toHaveBeenCalledWith('p1', 'fa1', 'f1');
    expect(result.isError).toBe(true);
    expect(result.structuredContent).toEqual({ available: false, message: expect.stringContaining('not an .ifc file') });
  });

  it('reports not-found when the client returns a plain string message', async () => {
    const client = await setup(fakeClient({ files: { getFile: jest.fn().mockResolvedValue('File not found') } }));

    const result = await client.callTool({ name: 'view_model_3d', arguments: { projectId: 'p1', fileAreaId: 'fa1', fileId: 'missing' } });

    expect(result.isError).toBe(true);
    expect(result.structuredContent).toEqual({ available: false, message: 'File not found: missing' });
  });
});
