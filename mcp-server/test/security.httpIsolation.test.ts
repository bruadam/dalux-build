import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

jest.mock('dalux-build-api', () => ({
  createClient: () => ({
    folders: { listFolders: async () => ({ items: [] }) },
    files: {
      listFiles: async () => ({ items: [{ fileId: 'x1', fileName: 'notes.md', folderId: 'f1', downloadLink: 'link:x1', contentHash: 'v1' }] }),
      downloadFileFromLink: async (_link: string, name: string, dir: string) => {
        const target = require('node:path').join(dir, name);
        require('node:fs').writeFileSync(target, '# Notes\n\nThe crane foundation needs rebar inspection.\n');
        return target;
      },
    },
  }),
}));

import { buildHttpApp } from '../src/http';

const BASE_URL = 'https://node1.field.dalux.com/service/api';
let cache: string;
const saved = process.env.DALUX_MCP_CACHE_DIR;

beforeAll(() => {
  cache = mkdtempSync(path.join(tmpdir(), 'dalux-http-isolation-'));
  process.env.DALUX_MCP_CACHE_DIR = cache;
  delete process.env.MISTRAL_API_KEY;
});
afterAll(() => {
  if (saved === undefined) delete process.env.DALUX_MCP_CACHE_DIR;
  else process.env.DALUX_MCP_CACHE_DIR = saved;
  rmSync(cache, { recursive: true, force: true });
});

async function call(handle: (request: Request) => Promise<Response>, apiKey: string, name: string, args: Record<string, unknown>) {
  const response = await handle(
    new Request('http://localhost/mcp', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
        'MCP-Protocol-Version': '2025-06-18',
        'X-Dalux-Base-Url': BASE_URL,
        'X-Dalux-Api-Key': apiKey,
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }),
    }),
  );
  const text = await response.text();
  const data = text.includes('data: ') ? text.split('\n').filter((l) => l.startsWith('data: ')).map((l) => l.slice(6)).at(-1)! : text;
  return JSON.parse(JSON.parse(data).result.content[0].text);
}

// SECURITY-ANALYSIS #1 for the HTTP transport without the platform: tenants sharing one process.
describe('HTTP transport with several Dalux API keys', () => {
  it('keeps the temporary file-area indexes of different keys apart', async () => {
    const { handleRequest } = buildHttpApp();
    const scope = { projectId: 'p1', fileAreaId: 'fa1' };
    const built = await call(handleRequest, 'key-a', 'build_file_area_index', scope);
    expect(built.indexId).toBeTruthy();

    expect((await call(handleRequest, 'key-a', 'list_file_area_indexes', {})).indexes.map((i: { indexId: string }) => i.indexId)).toEqual([built.indexId]);
    expect((await call(handleRequest, 'key-b', 'list_file_area_indexes', {})).indexes).toEqual([]);
    expect(JSON.stringify(await call(handleRequest, 'key-b', 'drop_file_area_index', { indexId: built.indexId }))).not.toMatch(/dropped":true/);
    expect((await call(handleRequest, 'key-a', 'list_file_area_indexes', {})).indexes).toHaveLength(1);
  });
});
