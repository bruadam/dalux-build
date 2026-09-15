import { McpServer } from '@modelcontextprotocol/server';
import { Client, InMemoryTransport } from '@modelcontextprotocol/client';
import type { DaluxClient } from 'dalux-build-api';
import { registerIfcViewer, RESOURCE_URI } from '../src/ui/ifcViewer';
import { createModelLinkStore } from '../src/modelLinks';

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

const HOSTING = {
  publicUrl: 'https://mcp.example.com',
  daluxBaseUrl: 'https://acme.dalux.com/api',
  daluxApiKey: 'test-api-key',
};

describe('registerIfcViewer', () => {
  it('always registers the tool (with ui.resourceUri metadata) and the ui:// resource', async () => {
    const server = new McpServer({ name: 'test', version: '0.0.0' });
    registerIfcViewer(server, fakeClient({}), undefined);
    const client = await connectedClient(server);

    const { tools } = await client.listTools();
    const tool = tools.find((t) => t.name === 'view_model_3d');
    expect(tool).toBeDefined();
    expect((tool?._meta as Record<string, unknown> | undefined)?.ui).toMatchObject({ resourceUri: RESOURCE_URI });
    expect((tool?._meta as Record<string, unknown> | undefined)?.['ui/resourceUri']).toBe(RESOURCE_URI);

    const { resources } = await client.listResources();
    const resource = resources.find((r) => r.uri === RESOURCE_URI);
    expect(resource).toBeDefined();
    expect(resource?.mimeType).toBe('text/html;profile=mcp-app');
  });

  it('reads the ui:// resource back as MCP Apps HTML that embeds the bundled viewer script', async () => {
    const server = new McpServer({ name: 'test', version: '0.0.0' });
    registerIfcViewer(server, fakeClient({}), undefined);
    const client = await connectedClient(server);

    const result = await client.readResource({ uri: RESOURCE_URI });
    const [content] = result.contents;
    expect(content.mimeType).toBe('text/html;profile=mcp-app');
    expect('text' in content).toBe(true);
    const text = (content as { text: string }).text;
    expect(text).toContain('id="root"');
    expect(text.length).toBeGreaterThan(1000); // the inlined esbuild bundle
  });

  it('without hosting, the tool reports the viewer needs the HTTP/--public-url deployment', async () => {
    const server = new McpServer({ name: 'test', version: '0.0.0' });
    registerIfcViewer(server, fakeClient({}), undefined);
    const client = await connectedClient(server);

    const result = await client.callTool({
      name: 'view_model_3d',
      arguments: { projectId: 'p1', fileAreaId: 'fa1', fileId: 'f1' },
    });

    expect(result.structuredContent).toEqual({
      available: false,
      message: expect.stringContaining('--public-url'),
    });
    expect(result.isError).toBeFalsy();
  });

  it('with hosting, issues a model ticket and returns a modelUrl for an .ifc file', async () => {
    const getFile = jest.fn().mockResolvedValue({ data: { fileName: 'tower.ifc' } });
    const modelLinks = createModelLinkStore();
    const server = new McpServer({ name: 'test', version: '0.0.0' });
    registerIfcViewer(server, fakeClient({ files: { getFile } }), { ...HOSTING, modelLinks });
    const client = await connectedClient(server);

    const result = await client.callTool({
      name: 'view_model_3d',
      arguments: { projectId: 'p1', fileAreaId: 'fa1', fileId: 'f1' },
    });

    expect(getFile).toHaveBeenCalledWith('p1', 'fa1', 'f1');
    const structured = result.structuredContent as { available: boolean; modelUrl?: string; fileName?: string };
    expect(structured.available).toBe(true);
    expect(structured.fileName).toBe('tower.ifc');
    expect(structured.modelUrl).toMatch(/^https:\/\/mcp\.example\.com\/models\/.+/);

    const token = new URL(structured.modelUrl as string).pathname.slice('/models/'.length);
    expect(modelLinks.consume(token)).toMatchObject({
      daluxBaseUrl: HOSTING.daluxBaseUrl,
      daluxApiKey: HOSTING.daluxApiKey,
      projectId: 'p1',
      fileAreaId: 'fa1',
      fileId: 'f1',
    });
  });

  it('rejects a file that is not an .ifc', async () => {
    const getFile = jest.fn().mockResolvedValue({ data: { fileName: 'spec.pdf' } });
    const server = new McpServer({ name: 'test', version: '0.0.0' });
    registerIfcViewer(server, fakeClient({ files: { getFile } }), { ...HOSTING, modelLinks: createModelLinkStore() });
    const client = await connectedClient(server);

    const result = await client.callTool({
      name: 'view_model_3d',
      arguments: { projectId: 'p1', fileAreaId: 'fa1', fileId: 'f1' },
    });

    expect(result.isError).toBe(true);
    expect(result.structuredContent).toEqual({
      available: false,
      message: expect.stringContaining('not an .ifc file'),
    });
  });

  it('reports not-found when the client returns a plain string message', async () => {
    const getFile = jest.fn().mockResolvedValue('File not found');
    const server = new McpServer({ name: 'test', version: '0.0.0' });
    registerIfcViewer(server, fakeClient({ files: { getFile } }), { ...HOSTING, modelLinks: createModelLinkStore() });
    const client = await connectedClient(server);

    const result = await client.callTool({
      name: 'view_model_3d',
      arguments: { projectId: 'p1', fileAreaId: 'fa1', fileId: 'missing' },
    });

    expect(result.isError).toBe(true);
    expect(result.structuredContent).toEqual({ available: false, message: 'File not found: missing' });
  });
});
