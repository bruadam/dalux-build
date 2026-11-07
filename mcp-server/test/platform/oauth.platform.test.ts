import { createHash, randomBytes } from 'node:crypto';
import { createAuthorizationCode, encryptSecret, type Db } from '@dalux-platform/db';
import { createTestDatabase, type TestDatabase } from '../../../platform/db/test/testDatabase';

jest.setTimeout(30_000);

jest.mock('dalux-build-api', () => ({
  createClient: () => ({
    projects: {
      listProjects: async () => ({ items: [{ projectId: 'p1', projectName: 'One' }] }),
      getProject: async () => ({ data: { projectId: 'p1', projectName: 'One' } }),
    },
    tasks: {
      getTask: async (_projectId: string, taskId: string) => ({ data: { taskId, subject: 'A task' } }),
    },
    fileAreas: {},
    folders: {},
    files: {},
  }),
}));

import { buildHttpApp } from '../../src/http';
import { Platform } from '../../src/platform/platform';

const ISSUER = 'https://mcp.example.com';
const REDIRECT_URI = 'https://claude.ai/api/mcp/auth_callback';
const ENCRYPTION_KEY = Buffer.alloc(32, 7);

let t: TestDatabase;
let webDb: Db;
let mcpDb: Db;
const ids: Record<string, string> = {};

beforeAll(async () => {
  t = await createTestDatabase();
  webDb = t.as('web');
  mcpDb = t.as('mcp');
  const insert = async (table: string, row: Record<string, unknown>) => {
    const columns = Object.keys(row);
    const { rows } = await t.owner.query(
      `INSERT INTO ${table} (${columns.join(', ')}) VALUES (${columns.map((_, i) => `$${i + 1}`).join(', ')}) RETURNING id`,
      Object.values(row),
    );
    return rows[0].id as string;
  };
  ids.site = await insert('connections', {
    name: 'Site',
    slug: 'site',
    base_url: 'https://node1.field.dalux.com/service/api',
    api_key_encrypted: encryptSecret('key-site', ENCRYPTION_KEY),
    api_key_last4: 'site',
  });
  ids.alice = await insert('accounts', { type: 'personal', email: 'alice@example.com', name: 'Alice' });
  await insert('grants', { account_id: ids.alice, connection_id: ids.site, capabilities: ['projects:read', 'tasks:read'] });
  await t.owner.query('SELECT refresh_effective_access()');
});

afterAll(() => t.drop());

const app = () => buildHttpApp({ platform: new Platform(mcpDb, ENCRYPTION_KEY), publicUrl: ISSUER }).handleRequest;
let handle: ReturnType<typeof app>;
beforeAll(() => {
  handle = app();
});

function post(path: string, body: Record<string, string>, handler = handle): Promise<Response> {
  return handler(
    new Request(`${ISSUER}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(body).toString(),
    }),
  );
}

let nextId = 1;
async function rpc(token: string, method: string, params: Record<string, unknown> = {}, handler = handle) {
  const response = await handler(
    new Request(`${ISSUER}/mcp/c/site`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
        'MCP-Protocol-Version': '2025-06-18',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: nextId++, method, params }),
    }),
  );
  const text = await response.text();
  const data = text.includes('data: ') ? text.split('\n').filter((l) => l.startsWith('data: ')).at(-1)!.slice(6) : text;
  return { status: response.status, headers: response.headers, body: JSON.parse(data) };
}

const pkce = () => {
  const verifier = randomBytes(32).toString('base64url');
  return { verifier, challenge: createHash('sha256').update(verifier).digest('base64url') };
};

let clientId: string;

/** What the consent page does when the user approves (platform/web `approveAuthorization`). */
async function consent(capabilities: string[] | null = null) {
  const { verifier, challenge } = pkce();
  const code = await createAuthorizationCode(webDb, {
    clientId,
    accountId: ids.alice,
    connectionId: ids.site,
    redirectUri: REDIRECT_URI,
    codeChallenge: challenge,
    capabilities,
  });
  return { code, verifier };
}

async function exchange(code: string, verifier: string, redirectUri = REDIRECT_URI) {
  const response = await post('/token', {
    grant_type: 'authorization_code',
    code,
    code_verifier: verifier,
    client_id: clientId,
    redirect_uri: redirectUri,
  });
  return { status: response.status, body: (await response.json()) as Record<string, any> };
}

async function refresh(refreshToken: string) {
  const response = await post('/token', { grant_type: 'refresh_token', refresh_token: refreshToken, client_id: clientId });
  return { status: response.status, body: (await response.json()) as Record<string, any> };
}

describe('platform OAuth: discovery and registration', () => {
  it('serves authorization-server metadata with refresh and revocation', async () => {
    const response = await handle(new Request(`${ISSUER}/.well-known/oauth-authorization-server`));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      issuer: ISSUER,
      authorization_endpoint: `${ISSUER}/authorize`,
      token_endpoint: `${ISSUER}/token`,
      registration_endpoint: `${ISSUER}/register`,
      revocation_endpoint: `${ISSUER}/revoke`,
      grant_types_supported: ['authorization_code', 'refresh_token'],
      code_challenge_methods_supported: ['S256'],
    });
  });

  it('serves protected-resource metadata per MCP endpoint and points 401s at it', async () => {
    const metadata = await handle(new Request(`${ISSUER}/.well-known/oauth-protected-resource/mcp/c/site`));
    expect(await metadata.json()).toMatchObject({ resource: `${ISSUER}/mcp/c/site`, authorization_servers: [ISSUER] });

    const { status, headers } = await rpc('', 'tools/list');
    expect(status).toBe(401);
    expect(headers.get('www-authenticate')).toContain(`resource_metadata="${ISSUER}/.well-known/oauth-protected-resource/mcp/c/site"`);
  });

  it.each(['/register', '/token', '/revoke'])('answers the CORS preflight on %s', async (path) => {
    const response = await handle(new Request(`${ISSUER}${path}`, { method: 'OPTIONS' }));
    expect(response.status).toBe(204);
    expect(response.headers.get('access-control-allow-origin')).toBe('*');
    expect(response.headers.get('access-control-allow-methods')).toContain('POST');
  });

  it('registers a client (RFC 7591) and stores it', async () => {
    const response = await handle(
      new Request(`${ISSUER}/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ client_name: 'Claude', redirect_uris: [REDIRECT_URI] }),
      }),
    );
    expect(response.status).toBe(201);
    expect(response.headers.get('access-control-allow-origin')).toBe('*');
    const body = (await response.json()) as Record<string, any>;
    expect(body).toMatchObject({ client_name: 'Claude', redirect_uris: [REDIRECT_URI], token_endpoint_auth_method: 'none' });
    clientId = body.client_id;
    const { rows } = await t.owner.query('SELECT name FROM oauth_clients WHERE id = $1', [clientId]);
    expect(rows[0].name).toBe('Claude');
  });

  it('rejects a non-https redirect URI', async () => {
    const response = await handle(
      new Request(`${ISSUER}/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ redirect_uris: ['http://evil.example.com/cb'] }),
      }),
    );
    expect(response.status).toBe(400);
  });
});

describe('platform OAuth: code exchange', () => {
  it('rejects a wrong redirect_uri and burns the code', async () => {
    const { code, verifier } = await consent();
    expect((await exchange(code, verifier, 'https://evil.example.com/cb')).body.error).toBe('invalid_grant');
    expect((await exchange(code, verifier)).body.error).toBe('invalid_grant');
  });

  it('rejects a wrong PKCE verifier', async () => {
    const { code } = await consent();
    const { status, body } = await exchange(code, pkce().verifier);
    expect(status).toBe(400);
    expect(body).toMatchObject({ error: 'invalid_grant', error_description: expect.stringContaining('code_verifier') });
  });

  it('rejects an expired code', async () => {
    const { code, verifier } = await consent();
    await t.owner.query(`UPDATE oauth_codes SET expires_at = now() - interval '1 second' WHERE used_at IS NULL`);
    expect((await exchange(code, verifier)).body.error).toBe('invalid_grant');
  });
});

describe('platform OAuth: full flow', () => {
  let first: Record<string, any>;
  let second: Record<string, any>;

  it('exchanges a code for a 1 h access token and a refresh token, stored hashed', async () => {
    const { code, verifier } = await consent();
    const { status, body } = await exchange(code, verifier);
    expect(status).toBe(200);
    expect(body).toMatchObject({ token_type: 'Bearer', expires_in: 3600 });
    expect(body.access_token).toMatch(/^dxo_/);
    expect(body.refresh_token).toMatch(/^dxr_/);
    first = body;

    const { rows } = await t.owner.query(
      `SELECT t.token_hash, t.kind, extract(epoch FROM t.expires_at - t.created_at) AS ttl
       FROM oauth_tokens t JOIN oauth_sessions s ON s.id = t.session_id WHERE s.client_id = $1 ORDER BY t.kind`,
      [clientId],
    );
    expect(rows.map((r) => r.kind)).toEqual(['access', 'refresh']);
    expect(rows.map((r) => Math.round(Number(r.ttl)))).toEqual([3600, 30 * 86400]);
    expect(rows.map((r) => r.token_hash)).not.toContain(body.access_token);
  });

  it('a code works only once', async () => {
    const { code, verifier } = await consent();
    expect((await exchange(code, verifier)).status).toBe(200);
    expect((await exchange(code, verifier)).body.error).toBe('invalid_grant');
  });

  it('calls MCP tools with the access token, with the account access', async () => {
    const tools = await rpc(first.access_token, 'tools/list');
    expect(tools.status).toBe(200);
    expect(tools.body.result.tools.map((tool: { name: string }) => tool.name)).toContain('list_projects');
    const call = await rpc(first.access_token, 'tools/call', { name: 'list_projects', arguments: {} });
    expect(call.body.result.isError ?? false).toBe(false);

    let audited: Record<string, unknown> | undefined;
    for (let attempt = 0; attempt < 50 && !audited; attempt++) {
      await new Promise((resolve) => setTimeout(resolve, 50));
      ({ rows: [audited] } = await t.owner.query(`SELECT client, status FROM audit_log WHERE action = 'list_projects' AND account_id = $1`, [ids.alice]));
    }
    expect(audited).toMatchObject({ client: 'OAuth: Claude', status: 'ok' });
  });

  it('rotates the refresh token on use', async () => {
    const { status, body } = await refresh(first.refresh_token);
    expect(status).toBe(200);
    expect(body.refresh_token).not.toBe(first.refresh_token);
    second = body;
    expect((await rpc(second.access_token, 'tools/list')).status).toBe(200);
  });

  it('revokes the whole session when a used refresh token comes back', async () => {
    const { status, body } = await refresh(first.refresh_token);
    expect(status).toBe(400);
    expect(body.error_description).toContain('already used');
    expect((await refresh(second.refresh_token)).body.error).toBe('invalid_grant');
    expect((await rpc(second.access_token, 'tools/list', {}, app())).status).toBe(401);
  });

  it('applies revocation within 60 s on a running server', async () => {
    const { code, verifier } = await consent();
    const { body } = await exchange(code, verifier);
    expect((await rpc(body.access_token, 'tools/list')).status).toBe(200);
    await t.owner.query('UPDATE oauth_sessions SET revoked_at = now() WHERE revoked_at IS NULL');

    const now = Date.now();
    const clock = jest.spyOn(Date, 'now').mockReturnValue(now + 61_000);
    try {
      const { status, body: error } = await rpc(body.access_token, 'tools/list');
      expect(status).toBe(401);
      expect(error.message).toContain('revoked');
    } finally {
      clock.mockRestore();
    }
  });

  it('revokes through the RFC 7009 endpoint', async () => {
    const { code, verifier } = await consent();
    const { body } = await exchange(code, verifier);
    const response = await post('/revoke', { token: body.refresh_token, client_id: clientId });
    expect(response.status).toBe(200);
    expect(response.headers.get('access-control-allow-origin')).toBe('*');
    expect((await refresh(body.refresh_token)).body.error).toBe('invalid_grant');
    expect((await rpc(body.access_token, 'tools/list', {}, app())).status).toBe(401);
    expect((await post('/revoke', { token: 'dxr_unknown' })).status).toBe(200);
  });

  it('narrows access to the capabilities chosen at consent', async () => {
    const { code, verifier } = await consent(['projects:read']);
    const { body } = await exchange(code, verifier);
    const call = await rpc(body.access_token, 'tools/call', { name: 'view_tasks_timeline', arguments: { projectId: 'p1', taskIds: ['t1'] } });
    const text = JSON.stringify(call.body);
    expect(text).toContain('tasks:read');
  });
});
