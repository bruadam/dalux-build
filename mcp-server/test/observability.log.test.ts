import { Client, InMemoryTransport } from '@modelcontextprotocol/client';
import type { DaluxClient } from 'dalux-build-api';
import { buildServer } from '../src/server';
import { setLogSink } from '../src/observability/log';

describe('JSON logs outside platform mode (DALUX_MCP_LOG_JSON=1)', () => {
  const lines: string[] = [];

  beforeEach(() => {
    lines.length = 0;
    jest.spyOn(process.stderr, 'write').mockImplementation(((chunk: string) => {
      lines.push(String(chunk));
      return true;
    }) as never);
    setLogSink('stderr');
  });

  afterEach(() => {
    setLogSink('off');
    jest.restoreAllMocks();
  });

  async function callTool(name: string, args: Record<string, unknown>, dalux: Record<string, unknown>) {
    const server = buildServer(dalux as unknown as DaluxClient);
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: 'test-client', version: '1.0.0' });
    await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
    return client.callTool({ name, arguments: args });
  }

  it('writes one JSON line per tool call to stderr, with no address and no content', async () => {
    await callTool('get_project', { projectId: 'p1' }, { projects: { getProject: async () => ({ data: { projectId: 'p1', projectName: 'Secret name' } }) } });
    const entries = lines.map((line) => JSON.parse(line));
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ level: 'info', tool: 'get_project', status: 'ok', project_id: 'p1' });
    expect(entries[0].ip).toBeUndefined();
    expect(lines.join('')).not.toContain('Secret name');
  });

  it('logs nothing when the sink is off', async () => {
    setLogSink('off');
    await callTool('get_project', { projectId: 'p1' }, { projects: { getProject: async () => ({ data: {} }) } });
    expect(lines).toEqual([]);
  });
});
