import { z } from 'zod';
import { Client, InMemoryTransport } from '@modelcontextprotocol/client';
import type { DaluxClient } from 'dalux-build-api';
import { buildServer, TOOLS, toolResultContent } from '../src/server';
import { DEFAULT_TOOLSETS, TOOLSET_NAMES, type Toolset } from '../src/toolsets';

async function connectedClient(
  dalux: Partial<Record<string, unknown>>,
  toolsets: readonly Toolset[] = TOOLSET_NAMES,
): Promise<Client> {
  const server = buildServer(dalux as unknown as DaluxClient, { toolsets });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'test-client', version: '1.0.0' });
  await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
  return client;
}

const DEFAULT_BUDGET = 68_000;
const ALL_BUDGET = 68_000;

describe('tools/list schemas', () => {
  it('carry no $schema dialect key or safe-integer bounds, on any tool', async () => {
    const client = await connectedClient({});
    const { tools } = await client.listTools();

    expect(tools.length).toBeGreaterThan(TOOLS.length);
    const listed = JSON.stringify(tools.map((tool) => [tool.inputSchema, tool.outputSchema]));
    expect(listed).not.toContain('$schema');
    expect(listed).not.toContain(String(Number.MAX_SAFE_INTEGER));
  });

  // MCP Apps hosts "MUST NOT include tools in the agent's tool list when their visibility does not include
  // \"model\"" (ext-apps specification/2026-01-26/apps.mdx, Visibility), so app-only tools cost no model context.
  async function modelToolsChars(toolsets: readonly Toolset[]): Promise<number> {
    const { tools } = await (await connectedClient({}, toolsets)).listTools();
    const modelTools = tools.filter((tool) => {
      const visibility = (tool._meta?.ui as { visibility?: string[] } | undefined)?.visibility;
      return !(visibility?.length === 1 && visibility[0] === 'app');
    });
    return JSON.stringify(modelTools).length;
  }

  // Measured size plus about 5%; ~4.3 chars per o200k token for this payload.
  it('stay within the tools/list size budget', async () => {
    expect(await modelToolsChars(DEFAULT_TOOLSETS)).toBeLessThanOrEqual(DEFAULT_BUDGET);
    expect(await modelToolsChars(TOOLSET_NAMES)).toBeLessThanOrEqual(ALL_BUDGET);
  });

  it('still validates arguments against the original schema', async () => {
    const listProjects = jest.fn().mockResolvedValue({ items: [{ projectId: 'p1' }] });
    const client = await connectedClient({ projects: { listProjects } });

    const rejected = await client.callTool({ name: 'list_projects', arguments: { limit: 0 } });
    const accepted = await client.callTool({ name: 'list_projects', arguments: { limit: 1 } });

    expect(rejected.isError).toBe(true);
    expect(listProjects).toHaveBeenCalledTimes(1);
    expect(accepted.isError).toBeFalsy();
    expect(JSON.parse((accepted.content as { text: string }[])[0].text)).toMatchObject({ items: [{ projectId: 'p1' }] });
  });
});

describe('TOOLS registry', () => {
  it('has 68 tools with unique names', () => {
    expect(TOOLS).toHaveLength(68);
    const names = TOOLS.map((t) => t.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it('every tool has a non-empty description and a zod object input schema', () => {
    for (const tool of TOOLS) {
      expect(tool.description.length).toBeGreaterThan(0);
      expect(tool.inputSchema).toBeInstanceOf(z.ZodObject);
      expect(typeof tool.handler).toBe('function');
    }
  });

  it('does not expose any mutating (create/update/delete) operation', () => {
    // These write to (or delete from) the local disposable cache, not to
    // Dalux — no project data is mutated by any of them. report_feedback is
    // the one deliberate exception (a real GitHub issue on this server's own
    // repo, not Dalux) — it doesn't match this naming pattern, but see the
    // dedicated test below for its confirmation gate.
    const allowlist = new Set([
      'download_file',
      'search_pdf_content',
      'search_file_content',
      'build_file_area_index',
      'drop_file_area_index',
    ]);
    for (const tool of TOOLS) {
      if (allowlist.has(tool.name)) continue;
      expect(tool.name).not.toMatch(/^(create|update|delete|upload|finish)_/);
    }
  });

  it('gates report_feedback\'s input schema on an optional confirmed flag', () => {
    const tool = TOOLS.find((t) => t.name === 'report_feedback');
    expect(tool).toBeDefined();
    const shape = (tool!.inputSchema as z.ZodObject<z.ZodRawShape>).shape;
    expect(shape.confirmed).toBeInstanceOf(z.ZodOptional);
  });
});

describe('toolResultContent', () => {
  it('renders a plain result as a single text block', () => {
    expect(toolResultContent({ found: true })).toEqual([{ type: 'text', text: '{"found":true}' }]);
  });

  it('renders an `image` field as an image content block plus the rest as text', () => {
    const result = toolResultContent({ image: { mimeType: 'image/png', data: 'AAAA' }, page: 1 });
    expect(result).toEqual([
      { type: 'image', mimeType: 'image/png', data: 'AAAA' },
      { type: 'text', text: '{"page":1}' },
    ]);
  });

  it('renders a `resource` field as plain text — this MCP host has no support for embedded-resource content blocks', () => {
    // download_file/download_task_attachment used to emit a `resource` content block for arbitrary
    // binary content; at least one real MCP host hard-errors on it regardless of mimeType, so
    // tools/documents.ts and tools/tasks.ts no longer produce a `resource` field at all (see
    // inlineText.ts/downloadLinks.ts for what replaced it). This just guards against it silently
    // coming back — an object with a `resource` field should fall through to the plain-text path.
    const result = toolResultContent({ resource: { uri: 'x', mimeType: 'application/pdf', blob: 'AAAA' }, found: true });
    expect(result).toEqual([{ type: 'text', text: '{"resource":{"uri":"x","mimeType":"application/pdf","blob":"AAAA"},"found":true}' }]);
  });
});
