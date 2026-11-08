import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Pool } from 'pg';
import { createDb, DB_ROLES, encryptSecret, runMigrations, type Db } from '@dalux-platform/db';

jest.setTimeout(30_000);

/**
 * Security review of platform mode (SECURITY-ANALYSIS.md, PRD 7.4 and success criteria 5, 6, 12):
 * shared caches, secrets in logs and audit rows, OAuth endpoints, header mode.
 */

const MARKER = 'SECRET-CONTENT-OF-GRANTED-FILE';
const FOLDERS = [
  { folderId: 'fA', folderName: 'Top', parentFolderId: null },
  { folderId: 'fB', folderName: 'Granted', parentFolderId: 'fA' },
  { folderId: 'fC', folderName: 'Other', parentFolderId: 'fA' },
];
const FILES = [
  { fileId: 'x1', fileName: 'granted.ifc', fileAreaId: 'fa1', folderId: 'fB' },
  { fileId: 'x4', fileName: 'notes.md', fileAreaId: 'fa1', folderId: 'fA' },
  { fileId: 'x7', fileName: 'withdrawn.ifc', fileAreaId: 'fa1', folderId: 'fB' },
  { fileId: 'x8', fileName: 'budget-granted.md', fileAreaId: 'fa1', folderId: 'fB', downloadLink: 'link:x8', contentHash: 'v1' },
  { fileId: 'x9', fileName: 'budget-other.md', fileAreaId: 'fa1', folderId: 'fC', downloadLink: 'link:x9', contentHash: 'v1' },
];

const daluxCalls: string[] = [];
jest.mock('dalux-build-api', () => ({
  createClient: () => ({
    projects: {
      listProjects: async () => ({ items: [{ projectId: 'p1' }] }),
      getProject: async () => ({ data: { projectId: 'p1' } }),
    },
    fileAreas: { getFileAreas: async () => ({ items: [{ fileAreaId: 'fa1' }] }) },
    folders: { listFolders: async () => ({ items: FOLDERS }) },
    files: {
      listFiles: async () => ({ items: FILES }),
      getFile: async (_p: string, _a: string, fileId: string, options?: { download?: boolean; savePath?: string }) => {
        daluxCalls.push(`getFile ${fileId}${options?.download ? ' download' : ''}`);
        const data = FILES.find((f) => f.fileId === fileId);
        // Dalux no longer lets this key read x7 (its access was withdrawn).
        if (!data || fileId === 'x7') throw new Error(`Resource not found: files/${fileId}`);
        if (!options?.download) return { data };
        const fs = require('node:fs');
        fs.mkdirSync(options.savePath, { recursive: true });
        const downloadedFilePath = require('node:path').join(options.savePath, data.fileName);
        fs.writeFileSync(downloadedFilePath, `${'SECRET-CONTENT-OF-GRANTED-FILE'}\n`);
        return { data, downloadedFilePath };
      },
      downloadFileFromLink: async (_link: string, name: string, dir: string) => {
        const target = require('node:path').join(dir, name);
        require('node:fs').writeFileSync(target, `# ${name}\n\nThe budget figures are in file ${name}.\n`);
        return target;
      },
    },
  }),
}));

import { buildHttpApp } from '../../src/http';
import { setAccountIndexStores } from '../../src/store';
import { postgresIndexStores } from '../../src/store/postgres';
import { hashApiToken, Platform } from '../../src/platform/platform';

const ADMIN_URL = process.env.TEST_DATABASE_URL ?? 'postgres://migrator:migrator@localhost:54329/platform_test';
const ROLE_PASSWORD = 'test-password';
const ENCRYPTION_KEY = Buffer.alloc(32, 5);
const BASE = 'http://localhost';
const PUBLIC_URL = 'https://mcp.example.com';
const DALUX_KEYS = { siteA: 'dalux-key-site-a-SECRET', siteB: 'dalux-key-site-b-SECRET' };

let admin: Pool;
let owner: Pool;
let mcpDb: Db;
let workerDb: Db;
let cacheDir: string;
let dbName: string;
const ids: Record<string, string> = {};
const tokens: Record<string, string> = {};
const logged: string[] = [];

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

const spies: jest.SpyInstance[] = [];
beforeAll(async () => {
  for (const method of ['log', 'info', 'warn', 'error'] as const) {
    spies.push(jest.spyOn(console, method).mockImplementation((...args) => void logged.push(args.map(String).join(' '))));
  }
  dbName = `test_${randomUUID().replace(/-/g, '')}`;
  admin = new Pool({ connectionString: ADMIN_URL, max: 1 });
  await admin.query(`CREATE DATABASE ${dbName}`);
  await runMigrations(dbUrl('migrator'), Object.fromEntries(DB_ROLES.map((role) => [role, ROLE_PASSWORD])));
  owner = new Pool({ connectionString: dbUrl('migrator') });
  mcpDb = createDb(dbUrl('mcp'));
  workerDb = createDb(dbUrl('worker'));
  const { search, build } = postgresIndexStores({ mcp: mcpDb, worker: workerDb });
  setAccountIndexStores(search, build);
  cacheDir = mkdtempSync(path.join(tmpdir(), 'dalux-mcp-hardening-'));
  process.env.DALUX_MCP_CACHE_DIR = cacheDir;
  delete process.env.MISTRAL_API_KEY;

  const connection = (slug: string, key: string) =>
    insert('connections', {
      name: slug,
      slug,
      base_url: 'https://node1.field.dalux.com/service/api',
      api_key_encrypted: encryptSecret(key, ENCRYPTION_KEY),
      api_key_last4: key.slice(-4),
    });
  ids.siteA = await connection('site-a', DALUX_KEYS.siteA);
  ids.siteB = await connection('site-b', DALUX_KEYS.siteB);

  const personal = (email: string, extra: Record<string, unknown> = {}) =>
    insert('accounts', { type: 'personal', email, name: email.split('@')[0], ...extra });
  ids.alice = await personal('alice@example.com');
  ids.carol = await personal('carol@example.com');
  ids.erin = await personal('erin@example.com');
  ids.frank = await personal('frank@example.com');
  ids.root = await personal('root@example.com', { role: 'admin' });
  ids.gina = await personal('gina@example.com');
  ids.team = await insert('groups', { name: 'Team' });
  await insert('group_memberships', { group_id: ids.team, account_id: ids.gina });

  const grant = (principal: Record<string, string>, connectionId: string, capabilities: string[], scope = {}) =>
    insert('grants', { ...principal, connection_id: connectionId, capabilities, ...scope });
  await grant({ account_id: ids.alice }, ids.siteA, ['projects:read', 'models:read'], { project_id: 'p1' });
  await grant({ account_id: ids.alice }, ids.siteA, ['files:read'], { project_id: 'p1', file_area_id: 'fa1', folder_id: 'fB' });
  await grant({ account_id: ids.carol }, ids.siteA, ['projects:read', 'models:read'], { project_id: 'p1' });
  await grant({ account_id: ids.carol }, ids.siteA, ['files:read'], { project_id: 'p1', file_area_id: 'fa1', folder_id: 'fC' });
  for (const connectionId of [ids.siteA, ids.siteB]) {
    await grant({ account_id: ids.erin }, connectionId, ['projects:read', 'files:read', 'models:read']);
  }
  await grant({ account_id: ids.root }, ids.siteA, ['projects:read', 'files:read']);
  await grant({ account_id: ids.frank }, ids.siteA, ['projects:read']);
  await grant({ group_id: ids.team }, ids.siteA, ['projects:read']);
  await insert('dalux_user_links', { account_id: ids.alice, connection_id: ids.siteA, dalux_user_id: 'DU-ALICE', source: 'auto' });
  await owner.query('SELECT refresh_effective_access()');

  for (const name of ['alice', 'carol', 'erin', 'frank', 'gina', 'root']) tokens[name] = await token(name, name);
});

afterAll(async () => {
  spies.forEach((spy) => spy.mockRestore());
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

const newApp = (extra: { publicUrl?: string } = {}) => buildHttpApp({ platform: new Platform(mcpDb, ENCRYPTION_KEY), ...extra });
let handle: ReturnType<typeof newApp>['handleRequest'];
beforeAll(() => {
  handle = newApp().handleRequest;
});
beforeEach(() => {
  daluxCalls.length = 0;
});

let nextId = 1;
async function rpc(path: string, method: string, params: Record<string, unknown>, headers: Record<string, string>, handler = handle) {
  const response = await handler(
    new Request(`${BASE}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', 'MCP-Protocol-Version': '2025-06-18', ...headers },
      body: JSON.stringify({ jsonrpc: '2.0', id: nextId++, method, params }),
    }),
  );
  const text = await response.text();
  const data = text.includes('data: ')
    ? text.split('\n').filter((line) => line.startsWith('data: ')).map((line) => line.slice(6)).at(-1)!
    : text;
  return { status: response.status, body: JSON.parse(data) as Record<string, any>, text };
}

const bearer = (value: string) => ({ Authorization: `Bearer ${value}` });
const IFC_PATH = '/mcp/c/site-a?toolsets=ifc';

async function call(value: string, name: string, args: Record<string, unknown>, route = '/mcp/c/site-a', handler = handle) {
  const { status, body } = await rpc(route, 'tools/call', { name, arguments: args }, bearer(value), handler);
  expect(status).toBe(200);
  const result = body.result as { isError?: boolean; content: { text: string }[] };
  return { isError: result.isError ?? false, text: result.content.map((c) => c.text).join('\n') };
}

const ref = { projectId: 'p1', fileAreaId: 'fa1' };
const downloaded = () => daluxCalls.filter((c) => c.endsWith('download'));

describe('shared file cache (SECURITY-ANALYSIS #1, #4)', () => {
  const cachedFile = (connection: string, fileId: string, name: string) => path.join(cacheDir, 'files', connection, fileId, name);

  it('keeps a downloaded file in a directory of its connection', async () => {
    const result = await call(tokens.alice, 'download_file', { ...ref, fileId: 'x1' });
    expect(result.isError).toBe(false);
    expect(readFileSync(cachedFile(ids.siteA, 'x1', 'granted.ifc'), 'utf-8')).toContain(MARKER);
  });

  it.each([
    ['download_file', 'download_file', {}],
    ['search_file_content', 'search_file_content', { query: 'secret' }],
    ['render_pdf_page', 'render_pdf_page', {}],
  ])('denies %s on a cached file to a user without the folder grant, without touching the cache or downloading', async (_name, tool, extra) => {
    await call(tokens.alice, 'download_file', { ...ref, fileId: 'x1' });
    daluxCalls.length = 0;
    const denied = await call(tokens.carol, tool, { ...ref, fileId: 'x1', ...extra });
    expect(denied).toEqual({ isError: true, text: expect.stringContaining('files:read') });
    expect(denied.text).not.toContain(MARKER);
    expect(downloaded()).toEqual([]);
  });

  it('denies IFC tools on a cached model to a user without the folder grant', async () => {
    await call(tokens.alice, 'download_file', { ...ref, fileId: 'x1' });
    daluxCalls.length = 0;
    const denied = await call(tokens.carol, 'ifc_model_info', { ...ref, fileId: 'x1' }, IFC_PATH);
    expect(denied).toEqual({ isError: true, text: expect.stringContaining('files:read') });
    expect(downloaded()).toEqual([]);
  });

  it('asks Dalux again before serving a cached model, even to a user the platform allows', async () => {
    const dir = path.dirname(cachedFile(ids.siteA, 'x7', 'withdrawn.ifc'));
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, 'withdrawn.ifc'), MARKER);
    const refused = await call(tokens.erin, 'ifc_model_info', { ...ref, fileId: 'x7' }, IFC_PATH);
    expect(refused.isError).toBe(true);
    expect(refused.text).not.toContain(MARKER);
    expect(daluxCalls.some((c) => c.startsWith('getFile x7'))).toBe(true);
  });

  it('does not share downloads between connections', async () => {
    const before = readdirSync(path.join(cacheDir, 'files'));
    expect(before).toEqual([ids.siteA]);
    await call(tokens.erin, 'download_file', { ...ref, fileId: 'x1' }, '/mcp/c/site-b');
    expect(readdirSync(path.join(cacheDir, 'files')).sort()).toEqual([ids.siteA, ids.siteB].sort());
    expect(existsSync(cachedFile(ids.siteB, 'x1', 'granted.ifc'))).toBe(true);
  });

  it('refuses a file id that would leave the cache directory', async () => {
    const result = await call(tokens.erin, 'download_file', { ...ref, fileId: '../../outside' });
    expect(result.isError).toBe(true);
    expect(existsSync(path.join(cacheDir, '..', 'outside'))).toBe(false);
  });
});

describe('shared index (SECURITY-ANALYSIS #1)', () => {
  const search = (name: string) => call(tokens[name], 'search_file_area', { ...ref, query: 'budget figures' });

  it('serves each user only the passages of the folders they are granted, and nothing to users without files:read', async () => {
    const built = await call(tokens.root, 'build_file_area_index', ref);
    expect(built.isError).toBe(false);

    const alice = await search('alice');
    expect(alice.text).toContain('budget-granted.md');
    expect(alice.text).not.toContain('budget-other.md');
    const carol = await search('carol');
    expect(carol.text).toContain('budget-other.md');
    expect(carol.text).not.toContain('budget-granted.md');
    expect(await search('frank')).toEqual({ isError: true, text: expect.stringContaining('files:read') });
  });

  it('hides the index of other users from the listing and refuses build and drop to non-admins', async () => {
    const listing = await call(tokens.alice, 'list_file_area_indexes', {});
    expect(listing.text).not.toContain('budget-other.md');
    for (const tool of ['build_file_area_index', 'drop_file_area_index']) {
      const { body } = await rpc('/mcp/c/site-a', 'tools/call', { name: tool, arguments: ref }, bearer(tokens.alice));
      expect(JSON.stringify(body)).toMatch(/not found|Unknown tool|disabled|unknown/i);
    }
  });
});

describe('secrets and document content', () => {
  const auditText = async () => JSON.stringify((await owner.query('SELECT * FROM audit_log')).rows);

  it('stores tokens only as hashes', async () => {
    const { rows } = await owner.query('SELECT * FROM api_tokens');
    for (const row of rows) {
      expect(row.token_hash).toMatch(/^[0-9a-f]{64}$/);
      for (const value of Object.values(tokens)) expect(JSON.stringify(row)).not.toContain(value);
    }
  });

  it('stores Dalux keys only encrypted', async () => {
    const { rows } = await owner.query('SELECT * FROM connections');
    for (const key of Object.values(DALUX_KEYS)) expect(JSON.stringify(rows)).not.toContain(key);
  });

  it('writes the Dalux user and project to the audit log, and no arguments or document text', async () => {
    await call(tokens.alice, 'search_file_content', { ...ref, fileId: 'x1', query: 'distinctive-query-words' });
    await call(tokens.alice, 'get_project', { projectId: 'p1' });
    let row: Record<string, unknown> | undefined;
    for (let attempt = 0; attempt < 50 && !row; attempt++) {
      row = (await owner.query("SELECT * FROM audit_log WHERE action = 'get_project' AND status = 'ok'")).rows[0];
      if (!row) await new Promise((resolve) => setTimeout(resolve, 50));
    }
    expect(row).toMatchObject({ account_id: ids.alice, dalux_user_id: 'DU-ALICE', project_id: 'p1', connection_id: ids.siteA });
    const text = await auditText();
    expect(text).not.toContain(MARKER);
    expect(text).not.toContain('distinctive-query-words');
  });

  it('keeps tokens, Dalux keys, and document text out of responses and logs', async () => {
    const denied = await rpc('/mcp/c/site-a', 'tools/list', {}, bearer('dxm_not-a-real-token'));
    expect(denied.status).toBe(401);
    expect(denied.text).not.toContain('not-a-real-token');

    const everything = [JSON.stringify(logged), await auditText()].join('\n');
    for (const secret of [...Object.values(tokens), ...Object.values(DALUX_KEYS), MARKER, 'not-a-real-token']) {
      expect(everything).not.toContain(secret);
    }
  });
});

describe('changes take effect within 60 seconds (success criterion 6)', () => {
  const realNow = Date.now;
  afterEach(() => {
    Date.now = realNow;
  });
  const afterOneMinute = () => {
    const later = realNow() + 61_000;
    Date.now = () => later;
  };

  it('blocks a revoked token', async () => {
    expect((await call(tokens.frank, 'get_project', { projectId: 'p1' })).isError).toBe(false);
    await owner.query('UPDATE api_tokens SET revoked_at = now() WHERE token_hash = $1', [hashApiToken(tokens.frank)]);
    afterOneMinute();
    expect((await rpc('/mcp/c/site-a', 'tools/list', {}, bearer(tokens.frank))).status).toBe(401);
  });

  it('blocks a disabled account', async () => {
    expect((await call(tokens.carol, 'get_project', { projectId: 'p1' })).isError).toBe(false);
    await owner.query("UPDATE accounts SET status = 'disabled' WHERE id = $1", [ids.carol]);
    afterOneMinute();
    expect((await rpc('/mcp/c/site-a', 'tools/list', {}, bearer(tokens.carol))).status).toBe(401);
  });

  it('removes access when a group member is removed', async () => {
    expect((await call(tokens.gina, 'get_project', { projectId: 'p1' })).isError).toBe(false);
    await owner.query('DELETE FROM group_memberships WHERE account_id = $1', [ids.gina]);
    await owner.query('SELECT refresh_effective_access()');
    afterOneMinute();
    expect((await call(tokens.gina, 'get_project', { projectId: 'p1' })).isError).toBe(true);
  });
});

describe('OAuth endpoints', () => {
  let oauth: typeof handle;
  beforeAll(() => {
    oauth = newApp({ publicUrl: PUBLIC_URL }).handleRequest;
  });
  const post = (path: string, body: unknown, address = '203.0.113.7') =>
    oauth(
      new Request(`${BASE}${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': `1.2.3.4, ${address}` },
        body: JSON.stringify(body),
      }),
    );

  it.each([
    'http://evil.example/callback',
    'javascript:alert(1)',
    'https://app.example.com/cb, http://evil.example/cb',
    'http://localhost.evil.example/cb',
    'not a url',
  ])('refuses to register the redirect_uri %s', async (uri) => {
    const response = await post('/register', { redirect_uris: uri.split(', ') }, `198.51.100.${Math.floor(Math.random() * 200)}`);
    expect(response.status).toBe(400);
  });

  it('accepts https and loopback redirect URIs', async () => {
    const response = await post('/register', { redirect_uris: ['https://app.example.com/cb', 'http://127.0.0.1:8123/cb'] }, '198.51.100.250');
    expect(response.status).toBe(201);
  });

  it('limits registrations per client address, keyed by the last X-Forwarded-For entry', async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 22; i++) statuses.push((await post('/register', { redirect_uris: ['https://app.example.com/cb'] }, '192.0.2.99')).status);
    expect(statuses.slice(0, 20).every((status) => status === 201)).toBe(true);
    expect(statuses.slice(20)).toEqual([429, 429]);
    expect((await post('/register', { redirect_uris: ['https://app.example.com/cb'] }, '192.0.2.100')).status).toBe(201);
  });

  it('limits the token endpoint per client address', async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 62; i++) statuses.push((await post('/token', { grant_type: 'authorization_code', code: 'nope' }, '192.0.2.50')).status);
    expect(statuses[0]).toBe(400);
    expect(statuses.at(-1)).toBe(429);
  });
});

describe('Dalux header mode', () => {
  let withHeaderMode: typeof handle;
  beforeAll(async () => {
    await owner.query('INSERT INTO settings (id, header_mode_enabled) VALUES (true, true) ON CONFLICT (id) DO UPDATE SET header_mode_enabled = true');
    withHeaderMode = newApp().handleRequest;
  });

  it.each([
    'http://node1.field.dalux.com/service/api',
    'https://169.254.169.254/latest/meta-data',
    'https://node1.field.dalux.com@evil.example/service/api',
    'https://evil.example/?.dalux.com',
  ])('rejects X-Dalux-Base-Url %s', async (baseUrl) => {
    const { status } = await rpc('/mcp', 'tools/list', {}, { 'X-Dalux-Base-Url': baseUrl, 'X-Dalux-Api-Key': 'k' }, withHeaderMode);
    expect(status).toBe(401);
  });

  it('serves a valid Dalux host', async () => {
    const { status } = await rpc('/mcp', 'tools/list', {}, { 'X-Dalux-Base-Url': 'https://node1.field.dalux.com/service/api', 'X-Dalux-Api-Key': 'k' }, withHeaderMode);
    expect(status).toBe(200);
  });
});

describe('restart (success criterion 5)', () => {
  it('accepts existing API tokens in a fresh server process, which holds no state of its own', async () => {
    const restarted = newApp().handleRequest;
    expect((await rpc('/mcp/c/site-a', 'tools/list', {}, bearer(tokens.alice), restarted)).status).toBe(200);
  });
});
