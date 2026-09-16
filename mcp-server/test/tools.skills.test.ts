import { McpServer } from '@modelcontextprotocol/server';
import { Client, InMemoryTransport } from '@modelcontextprotocol/client';
import { registerSkills, getSkill, SKILL_TOPICS } from '../src/tools/skills';

/** Connects an in-process MCP client to `server` over a linked in-memory transport pair. */
async function connectedClient(server: McpServer): Promise<Client> {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'test-client', version: '1.0.0' });
  await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
  return client;
}

describe('tools/skills', () => {
  it('getSkill defaults to the overview and lists every topic', () => {
    const result = getSkill({});
    expect(result.topic).toBe('overview');
    expect(result.title).toContain('overview');
    expect(result.availableTopics).toEqual([...SKILL_TOPICS]);
    for (const topic of SKILL_TOPICS) {
      if (topic === 'overview') continue;
      expect(result.content).toContain(topic);
    }
  });

  it.each(SKILL_TOPICS)('getSkill returns non-empty markdown for topic %s', (topic) => {
    const result = getSkill({ topic });
    expect(result.topic).toBe(topic);
    expect(result.content.length).toBeGreaterThan(200);
    expect(result.content.startsWith('#')).toBe(true);
  });
});

describe('registerSkills', () => {
  it('registers the get_skill tool and one resource per topic', async () => {
    const server = new McpServer({ name: 'test', version: '0.0.0' });
    registerSkills(server);
    const client = await connectedClient(server);

    const { tools } = await client.listTools();
    const tool = tools.find((t) => t.name === 'get_skill');
    expect(tool).toBeDefined();
    expect(tool?.description).toContain('call it first');

    const { resources } = await client.listResources();
    expect(resources).toHaveLength(SKILL_TOPICS.length);
    for (const topic of SKILL_TOPICS) {
      const resource = resources.find((r) => r.uri === `dalux-build://skill/${topic}`);
      expect(resource).toBeDefined();
      expect(resource?.mimeType).toBe('text/markdown');
    }
  });

  it('get_skill tool call with no arguments returns the overview', async () => {
    const server = new McpServer({ name: 'test', version: '0.0.0' });
    registerSkills(server);
    const client = await connectedClient(server);

    const result = await client.callTool({ name: 'get_skill', arguments: {} });

    expect(result.isError).toBeFalsy();
    const structured = result.structuredContent as { topic: string; availableTopics: string[] };
    expect(structured.topic).toBe('overview');
    expect(structured.availableTopics).toEqual([...SKILL_TOPICS]);
    const [content] = result.content as Array<{ type: string; text: string }>;
    expect(content.type).toBe('text');
    expect(content.text).toContain('# dalux-build MCP — overview');
  });

  it('get_skill tool call with topic=tasks returns the OData filtering doc', async () => {
    const server = new McpServer({ name: 'test', version: '0.0.0' });
    registerSkills(server);
    const client = await connectedClient(server);

    const result = await client.callTool({ name: 'get_skill', arguments: { topic: 'tasks' } });

    const structured = result.structuredContent as { topic: string; content: string };
    expect(structured.topic).toBe('tasks');
    expect(structured.content).toContain('data/type/typeId eq');
    expect(structured.content).toContain('$filter');
  });

  it('reads a skill resource back as markdown', async () => {
    const server = new McpServer({ name: 'test', version: '0.0.0' });
    registerSkills(server);
    const client = await connectedClient(server);

    const result = await client.readResource({ uri: 'dalux-build://skill/documents' });
    const [content] = result.contents;
    expect(content.mimeType).toBe('text/markdown');
    expect('text' in content).toBe(true);
    expect((content as { text: string }).text).toContain('search_file_content');
  });
});
