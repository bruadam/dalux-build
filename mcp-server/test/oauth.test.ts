import { randomBytes, createHash } from 'node:crypto';
import { buildHttpApp } from '../src/http';

const ISSUER = 'https://mcp.example.com';
const REDIRECT_URI = 'https://claude.ai/api/mcp/oauth/callback';
const DALUX_BASE_URL = 'https://acme.dalux.com/api';
const DALUX_API_KEY = 'test-api-key';

function pkcePair(): { codeVerifier: string; codeChallenge: string } {
  const codeVerifier = randomBytes(32).toString('base64url');
  const codeChallenge = createHash('sha256').update(codeVerifier).digest('base64url');
  return { codeVerifier, codeChallenge };
}

async function registerClient(handleRequest: (r: Request) => Promise<Response>): Promise<string> {
  const response = await handleRequest(
    new Request(`${ISSUER}/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ redirect_uris: [REDIRECT_URI] }),
    }),
  );
  expect(response.status).toBe(201);
  const body = (await response.json()) as { client_id: string };
  return body.client_id;
}

async function authorizeAndGetCode(
  handleRequest: (r: Request) => Promise<Response>,
  clientId: string,
  codeChallenge: string,
  overrides: Partial<{ daluxBaseUrl: string; daluxApiKey: string; redirectUri: string }> = {},
): Promise<Response> {
  const form = new URLSearchParams({
    client_id: clientId,
    redirect_uri: overrides.redirectUri ?? REDIRECT_URI,
    state: 'xyz',
    code_challenge: codeChallenge,
    dalux_base_url: overrides.daluxBaseUrl ?? DALUX_BASE_URL,
    dalux_api_key: overrides.daluxApiKey ?? DALUX_API_KEY,
  });
  return handleRequest(new Request(`${ISSUER}/authorize`, { method: 'POST', body: form }));
}

function extractCode(redirectResponse: Response): string {
  const location = redirectResponse.headers.get('location');
  expect(location).toBeTruthy();
  return new URL(location!).searchParams.get('code')!;
}

async function exchangeCode(
  handleRequest: (r: Request) => Promise<Response>,
  params: { code: string; clientId: string; codeVerifier: string; redirectUri?: string },
): Promise<Response> {
  const form = new URLSearchParams({
    grant_type: 'authorization_code',
    code: params.code,
    client_id: params.clientId,
    redirect_uri: params.redirectUri ?? REDIRECT_URI,
    code_verifier: params.codeVerifier,
  });
  return handleRequest(new Request(`${ISSUER}/token`, { method: 'POST', body: form }));
}

describe('OAuth authorization server (mounted when publicUrl is set)', () => {
  it('serves RFC 8414 and RFC 9728 discovery documents', async () => {
    const { handleRequest } = buildHttpApp({ publicUrl: ISSUER });

    const asMetadata = await handleRequest(new Request(`${ISSUER}/.well-known/oauth-authorization-server`));
    expect(asMetadata.status).toBe(200);
    const asBody = (await asMetadata.json()) as Record<string, unknown>;
    expect(asBody.issuer).toBe(ISSUER);
    expect(asBody.authorization_endpoint).toBe(`${ISSUER}/authorize`);
    expect(asBody.token_endpoint).toBe(`${ISSUER}/token`);
    expect(asBody.registration_endpoint).toBe(`${ISSUER}/register`);
    expect(asBody.code_challenge_methods_supported).toEqual(['S256']);

    const prMetadata = await handleRequest(
      new Request(`${ISSUER}/.well-known/oauth-protected-resource/mcp`),
    );
    expect(prMetadata.status).toBe(200);
    const prBody = (await prMetadata.json()) as Record<string, unknown>;
    expect(prBody.resource).toBe(`${ISSUER}/mcp`);
  });

  it('completes the full register -> authorize -> token -> authenticated /mcp flow', async () => {
    const { handleRequest } = buildHttpApp({ publicUrl: ISSUER });

    const clientId = await registerClient(handleRequest);
    const { codeVerifier, codeChallenge } = pkcePair();

    const authorizeGet = await handleRequest(
      new Request(
        `${ISSUER}/authorize?client_id=${clientId}&redirect_uri=${encodeURIComponent(REDIRECT_URI)}&response_type=code&code_challenge=${codeChallenge}&code_challenge_method=S256&state=xyz`,
      ),
    );
    expect(authorizeGet.status).toBe(200);
    expect(await authorizeGet.text()).toContain('Dalux Base URL');

    const authorizePost = await authorizeAndGetCode(handleRequest, clientId, codeChallenge);
    expect(authorizePost.status).toBe(302);
    const location = new URL(authorizePost.headers.get('location')!);
    expect(location.origin + location.pathname).toBe(REDIRECT_URI);
    expect(location.searchParams.get('state')).toBe('xyz');
    const code = extractCode(authorizePost);

    const tokenResponse = await exchangeCode(handleRequest, { code, clientId, codeVerifier });
    expect(tokenResponse.status).toBe(200);
    const tokenBody = (await tokenResponse.json()) as { access_token: string; token_type: string };
    expect(tokenBody.token_type).toBe('Bearer');
    expect(tokenBody.access_token).toBeTruthy();

    const mcpResponse = await handleRequest(
      new Request(`${ISSUER}/mcp`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json, text/event-stream',
          Authorization: `Bearer ${tokenBody.access_token}`,
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'initialize',
          params: {
            protocolVersion: '2025-06-18',
            capabilities: {},
            clientInfo: { name: 'test-client', version: '1.0.0' },
          },
        }),
      }),
    );
    expect(mcpResponse.status).toBe(200);
  });

  it('rejects /authorize when redirect_uri was not registered for the client (open-redirect defense)', async () => {
    const { handleRequest } = buildHttpApp({ publicUrl: ISSUER });
    const clientId = await registerClient(handleRequest);
    const { codeChallenge } = pkcePair();

    const response = await handleRequest(
      new Request(
        `${ISSUER}/authorize?client_id=${clientId}&redirect_uri=${encodeURIComponent('https://evil.example.com/steal')}&response_type=code&code_challenge=${codeChallenge}&code_challenge_method=S256`,
      ),
    );
    expect(response.status).toBe(400);
  });

  it('rejects /authorize missing PKCE S256 challenge by redirecting with an error', async () => {
    const { handleRequest } = buildHttpApp({ publicUrl: ISSUER });
    const clientId = await registerClient(handleRequest);

    const response = await handleRequest(
      new Request(`${ISSUER}/authorize?client_id=${clientId}&redirect_uri=${encodeURIComponent(REDIRECT_URI)}&response_type=code`),
    );
    expect(response.status).toBe(302);
    const location = new URL(response.headers.get('location')!);
    expect(location.searchParams.get('error')).toBe('invalid_request');
  });

  it('re-renders the form with an error instead of redirecting on a bad Dalux base URL', async () => {
    const { handleRequest } = buildHttpApp({ publicUrl: ISSUER });
    const clientId = await registerClient(handleRequest);
    const { codeChallenge } = pkcePair();

    const response = await authorizeAndGetCode(handleRequest, clientId, codeChallenge, {
      daluxBaseUrl: 'https://not-dalux.example.com',
    });
    expect(response.status).toBe(400);
    expect(await response.text()).toContain('dalux.com');
  });

  it('rejects a code_verifier that does not match the code_challenge', async () => {
    const { handleRequest } = buildHttpApp({ publicUrl: ISSUER });
    const clientId = await registerClient(handleRequest);
    const { codeChallenge } = pkcePair();

    const authorizePost = await authorizeAndGetCode(handleRequest, clientId, codeChallenge);
    const code = extractCode(authorizePost);

    const tokenResponse = await exchangeCode(handleRequest, { code, clientId, codeVerifier: 'wrong-verifier' });
    expect(tokenResponse.status).toBe(400);
    const body = (await tokenResponse.json()) as { error: string };
    expect(body.error).toBe('invalid_grant');
  });

  it('rejects a reused (already-consumed) authorization code', async () => {
    const { handleRequest } = buildHttpApp({ publicUrl: ISSUER });
    const clientId = await registerClient(handleRequest);
    const { codeVerifier, codeChallenge } = pkcePair();

    const authorizePost = await authorizeAndGetCode(handleRequest, clientId, codeChallenge);
    const code = extractCode(authorizePost);

    const first = await exchangeCode(handleRequest, { code, clientId, codeVerifier });
    expect(first.status).toBe(200);

    const second = await exchangeCode(handleRequest, { code, clientId, codeVerifier });
    expect(second.status).toBe(400);
  });

  it('challenges an unauthenticated /mcp request with a WWW-Authenticate pointing at resource metadata', async () => {
    const { handleRequest } = buildHttpApp({ publicUrl: ISSUER });
    const response = await handleRequest(new Request(`${ISSUER}/mcp`, { method: 'POST' }));
    expect(response.status).toBe(401);
    const challenge = response.headers.get('www-authenticate') ?? '';
    expect(challenge).toContain('resource_metadata=');
    expect(challenge).toContain('oauth-protected-resource');
  });
});

describe('static X-Dalux-* header auth (backward compatibility)', () => {
  it('still works when publicUrl is unset', async () => {
    const { handleRequest } = buildHttpApp({});
    const response = await handleRequest(
      new Request('http://localhost/mcp', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json, text/event-stream',
          'X-Dalux-Base-Url': DALUX_BASE_URL,
          'X-Dalux-Api-Key': DALUX_API_KEY,
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'initialize',
          params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test-client', version: '1.0.0' } },
        }),
      }),
    );
    expect(response.status).toBe(200);
  });

  it('still works when publicUrl is set but the request carries no Authorization header', async () => {
    const { handleRequest } = buildHttpApp({ publicUrl: ISSUER });
    const response = await handleRequest(
      new Request(`${ISSUER}/mcp`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json, text/event-stream',
          'X-Dalux-Base-Url': DALUX_BASE_URL,
          'X-Dalux-Api-Key': DALUX_API_KEY,
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'initialize',
          params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test-client', version: '1.0.0' } },
        }),
      }),
    );
    expect(response.status).toBe(200);
  });
});
