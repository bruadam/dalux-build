import { randomUUID } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Pool } from 'pg';
import { createDb, DB_ROLES, encryptSecret, runMigrations, type Db } from '@dalux-platform/db';

jest.setTimeout(30_000);

const SECRET_DOCUMENT_TEXT = 'The crane foundation needs rebar inspection.';
const DALUX_API_KEY = 'key-site-a';

jest.mock('dalux-build-api', () => {
  class NotFoundError extends Error {
    constructor(message: string) {
      super(message);
      this.name = 'NotFoundError';
    }
  }
  class RateLimitError extends Error {
    constructor(message: string) {
      super(message);
      this.name = 'RateLimitError';
    }
  }
  const FILES = [
    { fileId: 'x1', fileName: 'granted.pdf', fileAreaId: 'fa1', folderId: 'fB' },
    { fileId: 'x2', fileName: 'other.pdf', fileAreaId: 'fa1', folderId: 'fC' },
  ];
  return {
    createClient: () => ({
      projects: {
        listProjects: async () => ({ items: [{ projectId: 'p1', projectName: 'One' }, { projectId: 'p2', projectName: 'Two' }] }),
        getProject: async (projectId: string) => {
          if (projectId === 'gone') throw new NotFoundError('Resource not found: /projects/gone');
          if (projectId === 'busy') throw new RateLimitError('Rate limit exceeded');
          return { data: { projectId } };
        },
      },
      fileAreas: { getFileAreas: async () => ({ items: [{ fileAreaId: 'fa1' }] }) },
      folders: {
        listFolders: async () => ({
          items: [
            { folderId: 'fA', folderName: 'Top', parentFolderId: null },
            { folderId: 'fB', folderName: 'Granted', parentFolderId: 'fA' },
            { folderId: 'fC', folderName: 'Other', parentFolderId: 'fA' },
          ],
        }),
      },
      files: {
        listFiles: async () => ({ items: FILES }),
        getFile: async (_p: string, _a: string, fileId: string, options?: { download?: boolean; savePath?: string }) => {
          const data = FILES.find((f) => f.fileId === fileId);
          if (!options?.download || !data) return { data };
          const fs = require('node:fs');
          fs.mkdirSync(options.savePath, { recursive: true });
          const downloadedFilePath = require('node:path').join(options.savePath, 'notes.md');
          fs.writeFileSync(downloadedFilePath, `# Notes\n\nThe crane foundation needs rebar inspection.\n`);
          return { data: { ...data, fileName: 'notes.md' }, downloadedFilePath };
        },
      },
      tasks: {},
    }),
  };
});

import { checkAccess } from '../../src/access/checkAccess';
import { buildHttpApp } from '../../src/http';
import { setLogSink } from '../../src/observability/log';
import { renderMetrics } from '../../src/observability/metrics';
import { hashApiToken, Platform } from '../../src/platform/platform';
import { PEER_HEADER } from '../../src/platform/requestInfo';

const ADMIN_URL = process.env.TEST_DATABASE_URL ?? 'postgres://migrator:migrator@localhost:54329/platform_test';
const ROLE_PASSWORD = 'test-password';
const ENCRYPTION_KEY = Buffer.alloc(32, 7);
const BASE = 'http://localhost';

let admin: Pool;
let owner: Pool;
let mcpDb: Db;
let cacheDir: string;
let dbName: string;
const ids: Record<string, string> = {};
const tokens: Record<string, string> = {};
const stdout: string[] = [];
const stderr: string[] = [];

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
  await insert('api_tokens', { account_id: ids[account], name, token_hash: hashApiToken(value), prefix: value.slice(0, 12), ...extra });
  return value;
}

beforeAll(async () => {
  dbName = `test_${randomUUID().replace(/-/g, '')}`;
  admin = new Pool({ connectionString: ADMIN_URL, max: 1 });
  await admin.query(`CREATE DATABASE ${dbName}`);
  await runMigrations(dbUrl('migrator'), Object.fromEntries(DB_ROLES.map((role) => [role, ROLE_PASSWORD])));
  owner = new Pool({ connectionString: dbUrl('migrator') });
  mcpDb = createDb(dbUrl('mcp'));
  cacheDir = mkdtempSync(path.join(tmpdir(), 'dalux-mcp-obs-'));
  process.env.DALUX_MCP_CACHE_DIR = cacheDir;
  delete process.env.MISTRAL_API_KEY;

  ids.siteA = await insert('connections', {
    name: 'site-a',
    slug: 'site-a',
    base_url: 'https://node1.field.dalux.com/service/api',
    api_key_encrypted: encryptSecret(DALUX_API_KEY, ENCRYPTION_KEY),
    api_key_last4: 'last',
  });
  ids.siteB = await insert('connections', {
    name: 'site-b',
    slug: 'site-b',
    base_url: 'https://node1.field.dalux.com/service/api',
    api_key_encrypted: encryptSecret('key-site-b', ENCRYPTION_KEY),
    api_key_last4: 'last',
  });
  ids.alice = await insert('accounts', { type: 'personal', email: 'alice@example.com', name: 'Alice' });
  ids.bob = await insert('accounts', { type: 'personal', email: 'bob@example.com', name: 'Bob', role: 'admin' });
  ids.dave = await insert('accounts', { type: 'personal', email: 'dave@example.com', name: 'Dave', status: 'disabled' });
  const grant = (account: string, capabilities: string[], scope = {}) =>
    insert('grants', { account_id: ids[account], connection_id: ids.siteA, capabilities, ...scope });
  await grant('alice', ['projects:read'], { project_id: 'p1' });
  await grant('alice', ['files:read'], { project_id: 'p1', file_area_id: 'fa1', folder_id: 'fB' });
  await grant('bob', ['projects:read', 'files:read']);
  await owner.query('SELECT refresh_effective_access()');

  tokens.alice = await token('alice-laptop', 'alice');
  tokens.revoked = await token('revoked', 'alice', { revoked_at: new Date() });
  tokens.expired = await token('expired', 'alice', { expires_at: new Date(Date.now() - 1000) });
  tokens.siteB = await token('site-b-only', 'alice', { connection_id: ids.siteB });
  tokens.bob = await token('bob', 'bob');
  tokens.dave = await token('dave', 'dave');

  jest.spyOn(process.stdout, 'write').mockImplementation(((chunk: string) => {
    stdout.push(String(chunk));
    return true;
  }) as never);
  jest.spyOn(process.stderr, 'write').mockImplementation(((chunk: string) => {
    stderr.push(String(chunk));
    return true;
  }) as never);
  setLogSink('stdout');
});

afterAll(async () => {
  jest.restoreAllMocks();
  setLogSink('off');
  await Promise.all([owner.end(), mcpDb.$client.end()]);
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

/** A fresh platform (and settings cache) behind its own handler. */
function appWith(hops = 1, options: Partial<Parameters<typeof buildHttpApp>[0]> = {}) {
  return buildHttpApp({ platform: new Platform(mcpDb, ENCRYPTION_KEY), trustedProxyHops: hops, ...options });
}

let nextId = 1;
async function send(
  handler: (request: Request) => Promise<Response>,
  value: string | undefined,
  method: string,
  params: Record<string, unknown>,
  headers: Record<string, string> = {},
  path = '/mcp/c/site-a',
) {
  const response = await handler(
    new Request(`${BASE}${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
        'MCP-Protocol-Version': '2025-06-18',
        ...(value ? { Authorization: `Bearer ${value}` } : {}),
        ...headers,
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: nextId++, method, params }),
    }),
  );
  const text = await response.text();
  const data = text.includes('data: ') ? text.split('\n').filter((line) => line.startsWith('data: ')).map((line) => line.slice(6)).at(-1)! : text;
  return { response, body: JSON.parse(data) as Record<string, any> };
}

const callTool = (handler: (r: Request) => Promise<Response>, value: string, name: string, args: Record<string, unknown>, headers: Record<string, string> = {}) =>
  send(handler, value, 'tools/call', { name, arguments: args }, headers);

/** Audit rows and auth events are written after the response, so poll for the expected one. */
async function waitForRow(table: 'audit_log' | 'auth_events', where: string, values: unknown[]) {
  for (let attempt = 0; attempt < 60; attempt++) {
    const { rows } = await owner.query(`SELECT * FROM ${table} WHERE ${where} ORDER BY id DESC`, values);
    if (rows.length) return rows[0];
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`No ${table} row for ${where}`);
}

describe('audit rows', () => {
  it('records who, what, where, from which client and how it went for an allowed call', async () => {
    const handler = appWith().handleRequest;
    const { response } = await callTool(handler, tokens.alice, 'get_file', { projectId: 'p1', fileAreaId: 'fa1', fileId: 'x1' }, {
      'x-forwarded-for': '203.0.113.9',
      [PEER_HEADER]: '172.18.0.4',
      'user-agent': 'Claude-Desktop/1.2',
    });
    const requestId = response.headers.get('x-request-id')!;
    expect(requestId).toMatch(/^[0-9a-f-]{36}$/);
    const row = await waitForRow('audit_log', 'request_id = $1', [requestId]);
    expect(row).toMatchObject({
      kind: 'tool',
      account_id: ids.alice,
      action: 'get_file',
      connection_id: ids.siteA,
      project_id: 'p1',
      file_area_id: 'fa1',
      file_ids: ['x1'],
      file_count: 1,
      status: 'ok',
      client: 'alice-laptop',
      auth_method: 'dxm',
      client_ip: '203.0.113.9',
      forwarded_for: '203.0.113.9',
      user_agent: 'Claude-Desktop/1.2',
      error_code: null,
      denial_reason: null,
      query_text: null,
    });
    expect(row.credential_id).toEqual(expect.any(String));
    expect(row.result_bytes).toBeGreaterThan(0);
    expect(row.dalux_calls).toBeGreaterThanOrEqual(1);
    expect(row.dalux_errors).toBe(0);
  });

  it('records the number of items a list returned', async () => {
    const handler = appWith().handleRequest;
    const { response } = await callTool(handler, tokens.bob, 'list_projects', {});
    const row = await waitForRow('audit_log', 'request_id = $1', [response.headers.get('x-request-id')]);
    expect(row).toMatchObject({ status: 'ok', result_items: 2, result_truncated: false });
  });

  it.each([
    ['get_project', { projectId: 'p2' }, 'missing_capability'],
    ['get_file', { projectId: 'p1', fileAreaId: 'fa1', fileId: 'x2' }, 'no_folder_access'],
  ])('records why %s was denied', async (tool, args, reason) => {
    const handler = appWith().handleRequest;
    const { response, body } = await callTool(handler, tokens.alice, tool, args);
    const requestId = response.headers.get('x-request-id')!;
    const row = await waitForRow('audit_log', 'request_id = $1', [requestId]);
    expect(row).toMatchObject({ status: 'denied', denial_reason: reason, account_id: ids.alice });
    // Support can match the message to the row.
    expect(JSON.stringify(body)).toContain(requestId);
  });

  it('names admin-only denials', () => {
    expect(checkAccess({ account: { id: 'a', role: 'user' }, access: [] }, 'build_file_area_index', {})).toMatchObject({ allowed: false, code: 'admin_only' });
  });

  it('records Dalux errors, rate limits and the error code', async () => {
    const handler = appWith().handleRequest;
    const { response } = await callTool(handler, tokens.bob, 'get_project', { projectId: 'gone' });
    const row = await waitForRow('audit_log', 'request_id = $1', [response.headers.get('x-request-id')]);
    expect(row).toMatchObject({ status: 'error', error_code: 'not_found', dalux_calls: 1, dalux_errors: 1, dalux_rate_limited: 0 });

    const { response: busy } = await callTool(handler, tokens.bob, 'get_project', { projectId: 'busy' });
    const busyRow = await waitForRow('audit_log', 'request_id = $1', [busy.headers.get('x-request-id')]);
    expect(busyRow).toMatchObject({ status: 'error', error_code: 'rate_limited', dalux_rate_limited: 1 });
  });
});

describe('client IP', () => {
  const ipOf = async (handler: (r: Request) => Promise<Response>, headers: Record<string, string>) => {
    const { response } = await callTool(handler, tokens.bob, 'list_projects', {}, headers);
    return waitForRow('audit_log', 'request_id = $1', [response.headers.get('x-request-id')]);
  };

  it('ignores addresses a client puts in front of the trusted proxy', async () => {
    // Caddy appended the real address to what the client sent.
    const row = await ipOf(appWith(1).handleRequest, { 'x-forwarded-for': '6.6.6.6, 198.51.100.7', [PEER_HEADER]: '172.18.0.4' });
    expect(row.client_ip).toBe('198.51.100.7');
    expect(row.forwarded_for).toBe('6.6.6.6, 198.51.100.7');
  });

  it('ignores X-Forwarded-For without a trusted proxy', async () => {
    const row = await ipOf(appWith(0).handleRequest, { 'x-forwarded-for': '6.6.6.6', [PEER_HEADER]: '192.0.2.50' });
    expect(row.client_ip).toBe('192.0.2.50');
  });

  it('takes the peer address from the socket, not from a header the client sends', async () => {
    const app = appWith(0, { localhostOnly: true });
    const port = 38000 + Math.floor(Math.random() * 1000);
    await app.start(port, '127.0.0.1');
    const response = await fetch(`http://127.0.0.1:${port}/mcp/c/site-a`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
        Authorization: `Bearer ${tokens.bob}`,
        [PEER_HEADER]: '9.9.9.9',
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'list_projects', arguments: {} } }),
    });
    await response.text();
    await app.stop();
    const row = await waitForRow('audit_log', 'request_id = $1', [response.headers.get('x-request-id')]);
    expect(['127.0.0.1', '::1']).toContain(row.client_ip);
  });

  it('truncates addresses when ip_logging is truncated', async () => {
    await owner.query(`INSERT INTO settings (id, ip_logging) VALUES (true, 'truncated') ON CONFLICT (id) DO UPDATE SET ip_logging = 'truncated'`);
    const v4 = await ipOf(appWith().handleRequest, { 'x-forwarded-for': '203.0.113.77' });
    expect(v4).toMatchObject({ client_ip: '203.0.113.0/24', forwarded_for: null });
    const v6 = await ipOf(appWith().handleRequest, { 'x-forwarded-for': '2001:db8:abcd:12::1' });
    expect(v6.client_ip).toBe('2001:db8:abcd::/48');
  });

  it('stores no address when ip_logging is off', async () => {
    await owner.query(`UPDATE settings SET ip_logging = 'off'`);
    const row = await ipOf(appWith().handleRequest, { 'x-forwarded-for': '203.0.113.77' });
    expect(row).toMatchObject({ client_ip: null, forwarded_for: null });
    const lines = stdout.join('').split('\n').filter(Boolean).map((line) => JSON.parse(line));
    const line = lines.find((entry) => entry.request_id === row.request_id && entry.event === 'request');
    expect(line.ip).toBeUndefined();
    await owner.query(`UPDATE settings SET ip_logging = 'full'`);
  });
});

describe('failed attempts', () => {
  const attempt = async (value: string | undefined, path = '/mcp/c/site-a', headers: Record<string, string> = {}) => {
    const { response, body } = await send(appWith().handleRequest, value, 'tools/list', {}, { 'x-forwarded-for': '198.51.100.20', ...headers }, path);
    const requestId = response.headers.get('x-request-id')!;
    return { status: response.status, body, requestId, row: await waitForRow('auth_events', 'request_id = $1', [requestId]) };
  };

  it('logs an unknown token with its display prefix only', async () => {
    const secret = `dxm_${randomUUID()}${randomUUID()}`;
    const { status, row, body } = await attempt(secret);
    expect(status).toBe(401);
    expect(body.message).toContain(row.request_id);
    expect(row).toMatchObject({ source: 'mcp', reason: 'unknown_token', token_prefix: secret.slice(0, 12), client_ip: '198.51.100.20', connection_slug: 'site-a' });
    expect(JSON.stringify(row)).not.toContain(secret.slice(12));
  });

  it.each([
    ['revoked', 'revoked_token'],
    ['expired', 'expired_token'],
    ['dave', 'account_disabled'],
  ])('logs the %s token as %s with the account', async (name, reason) => {
    const { row } = await attempt(tokens[name]);
    expect(row).toMatchObject({ reason, account_id: name === 'dave' ? ids.dave : ids.alice });
  });

  it('logs a missing token and a non-platform token without any prefix', async () => {
    expect((await attempt(undefined)).row).toMatchObject({ reason: 'missing_token', token_prefix: null });
    const foreign = await attempt('sk-live-1234567890abcdef');
    expect(foreign.row).toMatchObject({ reason: 'malformed_token', token_prefix: null });
  });

  it('logs a wrong connection and an unknown slug', async () => {
    expect((await attempt(tokens.siteB)).row).toMatchObject({ reason: 'wrong_connection', account_id: ids.alice });
    expect((await attempt(tokens.alice, '/mcp/c/nope')).row).toMatchObject({ reason: 'unknown_connection', connection_slug: 'nope' });
  });

  it('counts failures in the metrics', () => {
    expect(renderMetrics()).toMatch(/dalux_mcp_auth_failures_total\{reason="unknown_token"\} [1-9]/);
  });
});

describe('what is never recorded', () => {
  const QUERY = 'confidential-hospital-wing';
  const tables = async () =>
    JSON.stringify([
      (await owner.query('SELECT * FROM audit_log')).rows,
      (await owner.query('SELECT * FROM auth_events')).rows,
    ]);

  async function exercise() {
    const handler = appWith().handleRequest;
    await callTool(handler, tokens.bob, 'search_files_by_name', { projectId: 'p1', fileAreaId: 'fa1', query: QUERY });
    await callTool(handler, tokens.bob, 'download_file', { projectId: 'p1', fileAreaId: 'fa1', fileId: 'x1' });
    const { response } = await callTool(handler, tokens.bob, 'search_files_by_name', { projectId: 'p1', fileAreaId: 'fa1', query: `${QUERY}-last` });
    await waitForRow('audit_log', 'request_id = $1', [response.headers.get('x-request-id')]);
    await new Promise((resolve) => setTimeout(resolve, 200));
  }

  it('keeps tokens, keys, search text and document text out of the tables, logs and stderr while log_query_text is off', async () => {
    await exercise();
    const everything = [await tables(), stdout.join(''), stderr.join('')].join('\n');
    for (const secret of [QUERY, SECRET_DOCUMENT_TEXT, 'rebar inspection', DALUX_API_KEY, ...Object.values(tokens)]) {
      expect(everything).not.toContain(secret);
    }
    const { rows } = await owner.query(`SELECT count(*)::int AS n FROM audit_log WHERE query_text IS NOT NULL`);
    expect(rows[0].n).toBe(0);
  });

  it('records the search text only while log_query_text is on, and still not in the logs', async () => {
    await owner.query(`UPDATE settings SET log_query_text = true`);
    stdout.length = 0;
    await exercise();
    const { rows } = await owner.query(`SELECT query_text FROM audit_log WHERE query_text IS NOT NULL`);
    expect(rows.length).toBeGreaterThan(0);
    expect(rows[0].query_text).toContain(QUERY);
    expect(stdout.join('')).not.toContain(QUERY);
    expect(await tables()).not.toContain('rebar inspection');
    await owner.query(`UPDATE settings SET log_query_text = false`);
  });
});

describe('structured logs and metrics', () => {
  it('writes one JSON line per request with the request id and no secrets', async () => {
    stdout.length = 0;
    const { response } = await callTool(appWith().handleRequest, tokens.bob, 'get_project', { projectId: 'p1' }, { 'x-forwarded-for': '203.0.113.5' });
    const requestId = response.headers.get('x-request-id')!;
    const lines = stdout.join('').split('\n').filter(Boolean).map((line) => JSON.parse(line)).filter((entry) => entry.request_id === requestId);
    expect(lines.map((entry) => entry.event ?? 'tool')).toEqual(expect.arrayContaining(['request']));
    const tool = lines.find((entry) => entry.tool === 'get_project');
    expect(tool).toMatchObject({ level: 'info', account_id: ids.bob, auth_method: 'dxm', connection: 'site-a', project_id: 'p1', status: 'ok', ip: '203.0.113.5' });
    expect(tool.timestamp).toEqual(expect.any(String));
    expect(tool.duration_ms).toEqual(expect.any(Number));
    expect(stdout.join('')).not.toContain(tokens.bob);
  });

  it('exposes call, denial, latency and Dalux counters without per-account labels', async () => {
    const text = renderMetrics();
    expect(text).toMatch(/dalux_mcp_tool_calls_total\{status="ok",tool="get_project"\} [1-9]/);
    expect(text).toMatch(/dalux_mcp_denials_total\{reason="missing_capability"\} [1-9]/);
    expect(text).toMatch(/dalux_mcp_tool_duration_seconds_bucket\{le="0.05"\}/);
    expect(text).toMatch(/dalux_mcp_dalux_errors_total [1-9]/);
    expect(text).toMatch(/dalux_mcp_dalux_rate_limited_total [1-9]/);
    expect(text).toMatch(/dalux_mcp_active_sessions [1-9]/);
    for (const id of [ids.alice, ids.bob]) expect(text).not.toContain(id);
  });

  it('does not route /metrics through Caddy or publish its port', () => {
    const caddyfile = readFileSync(path.join(__dirname, '../../../platform/Caddyfile'), 'utf8')
      .split('\n')
      .filter((line) => !line.trimStart().startsWith('#'))
      .join('\n');
    const compose = readFileSync(path.join(__dirname, '../../../platform/compose.yaml'), 'utf8')
      .split('\n')
      .filter((line) => !line.trimStart().startsWith('#'))
      .join('\n');
    expect(caddyfile).not.toContain('metrics');
    expect(caddyfile).not.toContain('9464');
    expect(compose).not.toContain('9464');
  });
});

describe('audit writes', () => {
  it('do not break the tool call when the insert fails, and are logged and counted', async () => {
    await owner.query(`ALTER TABLE audit_log ADD CONSTRAINT audit_log_test_fail CHECK (false) NOT VALID`);
    try {
      const logged = jest.spyOn(console, 'error').mockImplementation(() => undefined);
      const { body } = await callTool(appWith().handleRequest, tokens.bob, 'get_project', { projectId: 'p1' });
      expect(body.result.isError).toBeFalsy();
      for (let attempt = 0; attempt < 60 && !logged.mock.calls.length; attempt++) {
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      expect(logged.mock.calls.flat().join(' ')).toContain('[audit] failed to record tool call');
      logged.mockRestore();
      expect(renderMetrics()).toMatch(/dalux_mcp_audit_write_failures_total [1-9]/);
    } finally {
      await owner.query(`ALTER TABLE audit_log DROP CONSTRAINT audit_log_test_fail`);
    }
  });
});
