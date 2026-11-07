import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Pool } from 'pg';
import { createDb, DB_ROLES, encryptSecret, runMigrations, type Db } from '@dalux-platform/db';

jest.setTimeout(30_000);

const PROJECTS = [
  { projectId: 'p1', projectName: 'One' },
  { projectId: 'p2', projectName: 'Two' },
];
// fA is the file area's top folder; fB and fC sit below it.
const FOLDERS = [
  { folderId: 'fA', folderName: 'Top', parentFolderId: null },
  { folderId: 'fB', folderName: 'Granted', parentFolderId: 'fA' },
  { folderId: 'fB1', folderName: 'Below granted', parentFolderId: 'fB' },
  { folderId: 'fC', folderName: 'Other', parentFolderId: 'fA' },
];
const FILES = [
  { fileId: 'x1', fileName: 'granted.ifc', fileAreaId: 'fa1', folderId: 'fB1' },
  { fileId: 'x2', fileName: 'other.ifc', fileAreaId: 'fa1', folderId: 'fC' },
  { fileId: 'x3', fileName: 'top.pdf', fileAreaId: 'fa1', folderId: 'fA' },
  { fileId: 'x4', fileName: 'notes.md', fileAreaId: 'fa1', folderId: 'fA', downloadLink: 'link:x4', contentHash: 'v1' },
];

const daluxCalls: string[] = [];
jest.mock('dalux-build-api', () => ({
  createClient: () => ({
    projects: {
      listProjects: async () => ({ items: PROJECTS }),
      getProject: async (projectId: string) => ({ data: PROJECTS.find((p) => p.projectId === projectId) }),
    },
    fileAreas: {
      getFileAreas: async () => ({ items: [{ fileAreaId: 'fa1' }, { fileAreaId: 'fa2' }] }),
    },
    folders: {
      listFolders: async () => {
        daluxCalls.push('listFolders');
        return { items: FOLDERS };
      },
    },
    files: {
      listFiles: async () => ({ items: FILES }),
      getFile: async (_projectId: string, _fileAreaId: string, fileId: string) => {
        daluxCalls.push(`getFile ${fileId}`);
        return { data: FILES.find((f) => f.fileId === fileId) };
      },
      downloadFileFromLink: async (_link: string, name: string, dir: string) => {
        const target = require('node:path').join(dir, name);
        require('node:fs').writeFileSync(target, '# Site notes\n\nThe crane foundation needs rebar inspection.\n');
        return target;
      },
    },
    tasks: {
      getTask: async (_projectId: string, taskId: string) => ({ data: { taskId, subject: 'A task' } }),
    },
  }),
}));

import { buildHttpApp } from '../../src/http';
import { setAccountIndexStores } from '../../src/store';
import { postgresIndexStores } from '../../src/store/postgres';
import { hashApiToken, Platform } from '../../src/platform/platform';

const ADMIN_URL = process.env.TEST_DATABASE_URL ?? 'postgres://migrator:migrator@localhost:54329/platform_test';
const ROLE_PASSWORD = 'test-password';
const ENCRYPTION_KEY = Buffer.alloc(32, 7);
const BASE = 'http://localhost';

let admin: Pool;
let owner: Pool;
let mcpDb: Db;
let workerDb: Db;
let cacheDir: string;
let dbName: string;
const ids: Record<string, string> = {};

function dbUrl(role: string): string {
  const url = new URL(ADMIN_URL);
  url.pathname = `/${dbName}`;
  if (role !== 'migrator') {
    url.username = role;
    url.password = ROLE_PASSWORD;
  }
  return url.toString();
}

async function insert(table: string, row: Record<string, unknown>): Promise<string> {
  const columns = Object.keys(row);
  const { rows } = await owner.query(
    `INSERT INTO ${table} (${columns.join(', ')}) VALUES (${columns.map((_, i) => `$${i + 1}`).join(', ')}) RETURNING *`,
    Object.values(row),
  );
  return rows[0]?.id;
}

async function token(name: string, account: string, extra: Record<string, unknown> = {}): Promise<string> {
  const value = `dxm_${name}_${randomUUID()}`;
  await insert('api_tokens', { account_id: ids[account], name, token_hash: hashApiToken(value), prefix: value.slice(0, 8), ...extra });
  return value;
}

const tokens: Record<string, string> = {};

beforeAll(async () => {
  dbName = `test_${randomUUID().replace(/-/g, '')}`;
  admin = new Pool({ connectionString: ADMIN_URL, max: 1 });
  await admin.query(`CREATE DATABASE ${dbName}`);
  await runMigrations(dbUrl('migrator'), Object.fromEntries(DB_ROLES.map((role) => [role, ROLE_PASSWORD])));
  owner = new Pool({ connectionString: dbUrl('migrator') });
  mcpDb = createDb(dbUrl('mcp'));
  workerDb = createDb(dbUrl('worker'));
  const { search, build } = postgresIndexStores({ mcp: mcpDb, worker: workerDb });
  setAccountIndexStores(search, build);
  cacheDir = mkdtempSync(path.join(tmpdir(), 'dalux-mcp-platform-'));
  process.env.DALUX_MCP_CACHE_DIR = cacheDir;
  delete process.env.MISTRAL_API_KEY;

  const connection = (slug: string) =>
    insert('connections', {
      name: slug,
      slug,
      base_url: 'https://node1.field.dalux.com/service/api',
      api_key_encrypted: encryptSecret(`key-${slug}`, ENCRYPTION_KEY),
      api_key_last4: 'last',
    });
  ids.siteA = await connection('site-a');
  ids.siteB = await connection('site-b');

  ids.alice = await insert('accounts', { type: 'personal', email: 'alice@example.com', name: 'Alice' });
  ids.bob = await insert('accounts', { type: 'personal', email: 'bob@example.com', name: 'Bob', role: 'admin' });
  ids.dave = await insert('accounts', { type: 'personal', email: 'dave@example.com', name: 'Dave', status: 'disabled' });
  ids.robot = await insert('accounts', { type: 'robot', name: 'Triage bot', owner_account_id: ids.alice });
  ids.bots = await insert('groups', { name: 'Bots' });
  await insert('group_memberships', { group_id: ids.bots, account_id: ids.robot });

  const grant = (principal: Record<string, string>, connectionId: string, capabilities: string[], scope = {}) =>
    insert('grants', { ...principal, connection_id: connectionId, capabilities, ...scope });
  await grant({ account_id: ids.alice }, ids.siteA, ['projects:read', 'models:read', 'tasks:read'], { project_id: 'p1' });
  await grant({ account_id: ids.alice }, ids.siteA, ['files:read'], { project_id: 'p1', file_area_id: 'fa1', folder_id: 'fB' });
  await grant({ account_id: ids.alice }, ids.siteB, ['projects:read'], { project_id: 'p9' });
  await grant({ account_id: ids.bob }, ids.siteA, ['projects:read', 'files:read', 'tasks:read']);
  await grant({ group_id: ids.bots }, ids.siteA, ['tasks:read'], { project_id: 'p1' });
  await owner.query('SELECT refresh_effective_access()');

  tokens.alice = await token('alice', 'alice');
  tokens.revoked = await token('revoked', 'alice', { revoked_at: new Date() });
  tokens.expired = await token('expired', 'alice', { expires_at: new Date(Date.now() - 1000) });
  tokens.siteB = await token('site-b-only', 'alice', { connection_id: ids.siteB });
  tokens.tasksOnly = await token('tasks-only', 'alice', { capabilities: ['tasks:read'] });
  tokens.bob = await token('bob', 'bob');
  tokens.dave = await token('dave', 'dave');
  tokens.robot = await token('robot', 'robot');
});

afterAll(async () => {
  await Promise.all([owner.end(), mcpDb.$client.end(), workerDb.$client.end()]);
  rmSync(cacheDir, { recursive: true, force: true });
  for (let attempt = 0; ; attempt++) {
    try {
      await admin.query(`DROP DATABASE ${dbName}`);
      break;
    } catch (error) {
      if ((error as { code?: string }).code !== '55006' || attempt === 50) throw error;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
  await admin.end();
});

function app() {
  return buildHttpApp({ platform: new Platform(mcpDb, ENCRYPTION_KEY) });
}

let handle: ReturnType<typeof app>['handleRequest'];
beforeAll(() => {
  handle = app().handleRequest;
});
beforeEach(() => {
  daluxCalls.length = 0;
});

let nextId = 1;
async function rpc(
  path: string,
  method: string,
  params: Record<string, unknown>,
  headers: Record<string, string>,
  handler = handle,
): Promise<{ status: number; body: Record<string, any> }> {
  const response = await handler(
    new Request(`${BASE}${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
        'MCP-Protocol-Version': '2025-06-18',
        ...headers,
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: nextId++, method, params }),
    }),
  );
  const text = await response.text();
  const data = text.includes('data: ')
    ? text
        .split('\n')
        .filter((line) => line.startsWith('data: '))
        .map((line) => line.slice(6))
        .at(-1)!
    : text;
  return { status: response.status, body: JSON.parse(data) };
}

const bearer = (value: string) => ({ Authorization: `Bearer ${value}` });

async function listTools(value: string, path = '/mcp/c/site-a'): Promise<string[]> {
  const { body } = await rpc(path, 'tools/list', {}, bearer(value));
  return body.result.tools.map((t: { name: string }) => t.name);
}

async function call(value: string, name: string, args: Record<string, unknown>, path = '/mcp/c/site-a') {
  const { status, body } = await rpc(path, 'tools/call', { name, arguments: args }, bearer(value));
  expect(status).toBe(200);
  const result = body.result as { isError?: boolean; content: { text: string }[] };
  return { isError: result.isError ?? false, text: result.content.map((c) => c.text).join('\n') };
}

describe('platform mode: authentication', () => {
  it('accepts a valid API token', async () => {
    expect(await listTools(tokens.alice)).toContain('list_projects');
  });

  it.each([
    ['revoked', 'revoked'],
    ['expired', 'expired'],
    ['dave', 'not active'],
  ])('rejects the %s token', async (name, message) => {
    const { status, body } = await rpc('/mcp/c/site-a', 'tools/list', {}, bearer(tokens[name]));
    expect(status).toBe(401);
    expect(body.message).toContain(message);
  });

  it('rejects unknown and non-platform tokens', async () => {
    expect((await rpc('/mcp/c/site-a', 'tools/list', {}, bearer('dxm_unknown'))).status).toBe(401);
    expect((await rpc('/mcp/c/site-a', 'tools/list', {}, bearer('some-oauth-token'))).status).toBe(401);
    expect((await rpc('/mcp/c/site-a', 'tools/list', {}, {})).status).toBe(401);
  });

  it('allows robot accounts', async () => {
    const result = await call(tokens.robot, 'view_tasks_timeline', { projectId: 'p1', taskIds: ['t1'] });
    expect(result.isError).toBe(false);
  });

  it('records last use of a token', async () => {
    const { rows } = await owner.query('SELECT last_used_at FROM api_tokens WHERE name = $1', ['alice']);
    expect(rows[0].last_used_at).not.toBeNull();
  });
});

describe('platform mode: connections', () => {
  it('refuses a token restricted to another connection', async () => {
    const { status, body } = await rpc('/mcp/c/site-a', 'tools/list', {}, bearer(tokens.siteB));
    expect(status).toBe(403);
    expect(body.error).toBe('wrong_connection');
  });

  it('uses the token connection on /mcp', async () => {
    const result = await call(tokens.siteB, 'get_project', { projectId: 'p9' }, '/mcp');
    expect(result.isError).toBe(false);
  });

  it('asks for a slug on /mcp when the account reaches several connections', async () => {
    const { status, body } = await rpc('/mcp', 'tools/list', {}, bearer(tokens.alice));
    expect(status).toBe(400);
    expect(body.message).toContain('site-a, site-b');
  });

  it('uses the only reachable connection on /mcp', async () => {
    expect(await listTools(tokens.bob, '/mcp')).toContain('list_projects');
  });

  it('returns 404 for an unknown slug or path', async () => {
    expect((await rpc('/mcp/c/nope', 'tools/list', {}, bearer(tokens.alice))).status).toBe(404);
    expect((await rpc('/other', 'tools/list', {}, bearer(tokens.alice))).status).toBe(404);
  });
});

describe('platform mode: access', () => {
  it('names the missing capability', async () => {
    const result = await call(tokens.alice, 'get_project', { projectId: 'p2' });
    expect(result).toEqual({ isError: true, text: expect.stringContaining('projects:read') });
  });

  it('narrows access to the token capabilities', async () => {
    const result = await call(tokens.tasksOnly, 'get_project', { projectId: 'p1' });
    expect(result).toEqual({ isError: true, text: expect.stringContaining('projects:read') });
  });

  it('filters listings to what the caller can see', async () => {
    expect((await call(tokens.alice, 'list_projects', {})).text).toContain('"p1"');
    expect((await call(tokens.alice, 'list_projects', {})).text).not.toContain('"p2"');

    const files = (await call(tokens.alice, 'list_files', { projectId: 'p1', fileAreaId: 'fa1' })).text;
    expect(files).toContain('x1');
    expect(files).not.toContain('x2');
    expect(files).not.toContain('x3');

    const folders = JSON.parse((await call(tokens.alice, 'list_folders', { projectId: 'p1', fileAreaId: 'fa1' })).text);
    expect(folders.items.map((f: { folderId: string }) => f.folderId)).toEqual(['fB', 'fB1']);

    const areas = (await call(tokens.alice, 'list_file_areas', { projectId: 'p1' })).text;
    expect(areas).toContain('fa1');
    expect(areas).not.toContain('fa2');
  });

  it('checks a file against its folder', async () => {
    expect((await call(tokens.alice, 'get_file', { projectId: 'p1', fileAreaId: 'fa1', fileId: 'x1' })).isError).toBe(false);
    const denied = await call(tokens.alice, 'get_file', { projectId: 'p1', fileAreaId: 'fa1', fileId: 'x2' });
    expect(denied).toEqual({ isError: true, text: expect.stringContaining('files:read') });
  });

  it('requires files:read on the folder for IFC tools (G1)', async () => {
    const denied = await call(tokens.alice, 'ifc_model_info', { projectId: 'p1', fileAreaId: 'fa1', fileId: 'x2' });
    expect(denied).toEqual({ isError: true, text: expect.stringContaining('files:read') });
    const bobDenied = await call(tokens.bob, 'ifc_model_info', { projectId: 'p1', fileAreaId: 'fa1', fileId: 'x1' });
    expect(bobDenied).toEqual({ isError: true, text: expect.stringContaining('models:read') });
  });

  it('checks the 3D viewer app-only tools like the other IFC tools (G1)', async () => {
    const denied = await call(tokens.alice, 'ifc_viewer_selection', { projectId: 'p1', fileAreaId: 'fa1', fileId: 'x2', selectionId: 'sel_x' });
    expect(denied).toEqual({ isError: true, text: expect.stringContaining('files:read') });
    const bobDenied = await call(tokens.bob, 'ifc_viewer_geometry', { projectId: 'p1', fileAreaId: 'fa1', fileId: 'x1', chunk: 0 });
    expect(bobDenied).toEqual({ isError: true, text: expect.stringContaining('models:read') });
  });

  it('hides admin-only tools from non-admins', async () => {
    const aliceTools = await listTools(tokens.alice);
    expect(aliceTools).not.toContain('build_file_area_index');
    expect(aliceTools).not.toContain('drop_task_index');
    const { body } = await rpc('/mcp/c/site-a', 'tools/call', { name: 'drop_task_index', arguments: {} }, bearer(tokens.alice));
    expect(JSON.stringify(body)).toMatch(/not found|drop_task_index/i);

    const bobTools = await listTools(tokens.bob);
    expect(bobTools).toEqual(expect.arrayContaining(['build_file_area_index', 'drop_task_index']));
  });
});

describe('platform mode: audit', () => {
  /** Audit rows are written after the response, so poll for the expected one. */
  async function auditRow(match: Record<string, string>) {
    const keys = Object.keys(match);
    const where = keys.map((key, i) => `${key} = $${i + 1}`).join(' AND ');
    for (let attempt = 0; attempt < 50; attempt++) {
      const { rows } = await owner.query(`SELECT * FROM audit_log WHERE ${where}`, Object.values(match));
      if (rows.length) return rows[0];
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    return undefined;
  }

  it('writes one row per tool call without arguments', async () => {
    await call(tokens.alice, 'get_folder_tree', { projectId: 'p2', fileAreaId: 'fa1' });
    const row = await auditRow({ action: 'get_folder_tree', status: 'denied' });
    expect(row).toMatchObject({
      kind: 'tool',
      account_id: ids.alice,
      connection_id: ids.siteA,
      project_id: 'p2',
      capability: 'files:read',
      status: 'denied',
      client: 'alice',
    });
    expect(row.duration_ms).toEqual(expect.any(Number));
  });

  it('records successful calls as ok', async () => {
    await call(tokens.alice, 'get_project', { projectId: 'p1' });
    const row = await auditRow({ action: 'get_project', status: 'ok', project_id: 'p1' });
    expect(row).toMatchObject({ account_id: ids.alice, connection_id: ids.siteA, capability: 'projects:read' });
  });
});

describe('platform mode: Dalux header mode', () => {
  const headersFor = (apiKey: string) => ({
    'X-Dalux-Base-Url': 'https://node1.field.dalux.com/service/api',
    'X-Dalux-Api-Key': apiKey,
  });
  const scope = { projectId: 'p1', fileAreaId: 'fa1' };
  let handleWithHeaderMode: typeof handle;

  async function headerCall(apiKey: string, name: string, args: Record<string, unknown>) {
    const { status, body } = await rpc('/mcp', 'tools/call', { name, arguments: args }, headersFor(apiKey), handleWithHeaderMode);
    expect(status).toBe(200);
    return JSON.parse(body.result.content[0].text);
  }
  const indexIds = (listing: { indexes: { indexId: string }[] }) => listing.indexes.map((index) => index.indexId);

  it('is off by default', async () => {
    const { status } = await rpc('/mcp', 'tools/list', {}, headersFor('key-a'));
    expect(status).toBe(401);
  });

  it('serves header requests when an admin turned it on', async () => {
    await owner.query(
      'INSERT INTO settings (id, header_mode_enabled) VALUES (true, true) ON CONFLICT (id) DO UPDATE SET header_mode_enabled = true',
    );
    handleWithHeaderMode = app().handleRequest;
    const { status, body } = await rpc('/mcp', 'tools/list', {}, headersFor('key-a'), handleWithHeaderMode);
    expect(status).toBe(200);
    expect(body.result.tools.map((t: { name: string }) => t.name)).toContain('build_file_area_index');
  });

  it('builds and searches a temporary file index per credentials, apart from the Postgres indexes', async () => {
    const accountBuild = await call(tokens.bob, 'build_file_area_index', scope);
    expect(accountBuild.isError).toBe(false);
    const accountIndexes = indexIds(JSON.parse((await call(tokens.bob, 'list_file_area_indexes', {})).text));
    expect(accountIndexes).toHaveLength(1);

    const built = await headerCall('key-a', 'build_file_area_index', scope);
    expect(built.indexId).toBeTruthy();
    const hits = await headerCall('key-a', 'search_file_area', { ...scope, query: 'crane foundation' });
    expect(JSON.stringify(hits)).toContain('crane foundation');

    expect(indexIds(await headerCall('key-a', 'list_file_area_indexes', {}))).toEqual([built.indexId]);
    expect(indexIds(await headerCall('key-b', 'list_file_area_indexes', {}))).toEqual([]);
    expect(indexIds(JSON.parse((await call(tokens.bob, 'list_file_area_indexes', {})).text))).toEqual(accountIndexes);
  });
});
