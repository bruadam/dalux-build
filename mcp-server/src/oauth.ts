import { randomBytes, createHash } from 'node:crypto';
import {
  OAuthError,
  OAuthErrorCode,
  oauthMetadataResponse,
  type AuthInfo,
  type OAuthMetadata,
  type OAuthTokenVerifier,
} from '@modelcontextprotocol/server';
import { validateDaluxBaseUrl } from './daluxUrl';

/**
 * A minimal OAuth 2.1 Authorization Server (RFC 8414 metadata, RFC 7591
 * dynamic client registration, PKCE-only authorization code grant) fronting
 * this MCP server's Dalux credentials. Dalux itself has no OAuth — the
 * "authorize" step is a form where the user pastes their existing Dalux
 * Base URL + API key, and gets back an opaque bearer token scoped to those
 * credentials. This exists purely so browser-based connectors (Claude.ai,
 * ChatGPT) that only support OAuth — not static headers — can connect.
 *
 * All state is in-memory, matching the existing per-credential client cache
 * in http.ts: cleared on restart, no external dependency added. Revocation
 * for v1 is "restart the server"; there's no refresh-token flow, so access
 * tokens are long-lived (Dalux API keys don't rotate on a timer either).
 */

const AUTH_CODE_TTL_MS = 60_000;
const ACCESS_TOKEN_TTL_SECONDS = 60 * 60 * 24 * 90; // 90 days

interface DaluxCredentials {
  daluxBaseUrl: string;
  daluxApiKey: string;
}

interface RegisteredClient {
  clientId: string;
  redirectUris: string[];
}

interface AuthCodeRecord extends DaluxCredentials {
  clientId: string;
  redirectUri: string;
  codeChallenge: string;
  expiresAt: number;
}

interface AccessTokenRecord extends DaluxCredentials {
  clientId: string;
  expiresAt: number;
}

export interface OAuthServer {
  metadata: OAuthMetadata;
  tokenVerifier: OAuthTokenVerifier;
  /** Handles the OAuth-specific routes; resolves undefined if the request matches none of them. */
  handleRequest: (request: Request) => Promise<Response | undefined>;
}

function randomId(bytes: number): string {
  return randomBytes(bytes).toString('base64url');
}

function htmlEscape(value: string): string {
  return value.replace(/[&<>"']/g, (char) => {
    switch (char) {
      case '&':
        return '&amp;';
      case '<':
        return '&lt;';
      case '>':
        return '&gt;';
      case '"':
        return '&quot;';
      default:
        return '&#39;';
    }
  });
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

function htmlResponse(status: number, body: string): Response {
  return new Response(body, { status, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
}

function redirectWithError(redirectUri: string, state: string, error: string, description?: string): Response {
  const target = new URL(redirectUri);
  target.searchParams.set('error', error);
  if (description) target.searchParams.set('error_description', description);
  if (state) target.searchParams.set('state', state);
  return new Response(null, { status: 302, headers: { Location: target.toString() } });
}

function renderAuthorizeForm(params: {
  clientId: string;
  redirectUri: string;
  state: string;
  codeChallenge: string;
  error?: string;
}): string {
  return `<!doctype html>
<html><head><meta charset="utf-8"><title>Connect Dalux Build</title>
<style>
body{font-family:system-ui,sans-serif;max-width:480px;margin:48px auto;padding:0 16px;color:#1a1a1a}
label{display:block;margin-top:16px;font-weight:600}
input{width:100%;padding:8px;margin-top:4px;box-sizing:border-box;font-size:14px}
button{margin-top:24px;padding:10px 20px;font-size:14px;cursor:pointer}
.error{color:#b00020;margin-top:16px}
p.hint{color:#555;font-size:13px}
</style></head><body>
<h2>Connect to Dalux Build</h2>
<p>Enter your Dalux Build API credentials to let this app access Dalux Build on your behalf.</p>
${params.error ? `<p class="error">${htmlEscape(params.error)}</p>` : ''}
<form method="POST" action="/authorize">
<input type="hidden" name="client_id" value="${htmlEscape(params.clientId)}">
<input type="hidden" name="redirect_uri" value="${htmlEscape(params.redirectUri)}">
<input type="hidden" name="state" value="${htmlEscape(params.state)}">
<input type="hidden" name="code_challenge" value="${htmlEscape(params.codeChallenge)}">
<label for="dalux_base_url">Dalux Base URL</label>
<input id="dalux_base_url" name="dalux_base_url" placeholder="https://&lt;company&gt;.dalux.com/api" required>
<label for="dalux_api_key">Dalux API Key</label>
<input id="dalux_api_key" name="dalux_api_key" type="password" required>
<p class="hint">Sent directly to this server to mint an access token — never shared with any third party.</p>
<button type="submit">Authorize</button>
</form>
</body></html>`;
}

export function createOAuthServer(options: { issuer: string; resourceUrl: URL }): OAuthServer {
  const issuerUrl = new URL(options.issuer);
  const clients = new Map<string, RegisteredClient>();
  const authCodes = new Map<string, AuthCodeRecord>();
  const accessTokens = new Map<string, AccessTokenRecord>();

  const metadata: OAuthMetadata = {
    issuer: issuerUrl.origin,
    authorization_endpoint: new URL('/authorize', issuerUrl).toString(),
    token_endpoint: new URL('/token', issuerUrl).toString(),
    registration_endpoint: new URL('/register', issuerUrl).toString(),
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code'],
    code_challenge_methods_supported: ['S256'],
    token_endpoint_auth_methods_supported: ['none'],
  };

  function sweepExpired(): void {
    const now = Date.now();
    for (const [code, record] of authCodes) {
      if (record.expiresAt < now) authCodes.delete(code);
    }
    for (const [token, record] of accessTokens) {
      if (record.expiresAt * 1000 < now) accessTokens.delete(token);
    }
  }

  const tokenVerifier: OAuthTokenVerifier = {
    async verifyAccessToken(token: string): Promise<AuthInfo> {
      const record = accessTokens.get(token);
      if (!record || record.expiresAt * 1000 < Date.now()) {
        throw new OAuthError(OAuthErrorCode.InvalidToken, 'Access token is invalid or expired');
      }
      return {
        token,
        clientId: record.clientId,
        scopes: ['dalux'],
        expiresAt: record.expiresAt,
        extra: { daluxBaseUrl: record.daluxBaseUrl, daluxApiKey: record.daluxApiKey },
      };
    },
  };

  async function handleRegister(request: Request): Promise<Response> {
    let body: { redirect_uris?: unknown };
    try {
      body = (await request.json()) as { redirect_uris?: unknown };
    } catch {
      return jsonResponse(400, { error: 'invalid_client_metadata', error_description: 'Body must be JSON' });
    }
    const redirectUris = body.redirect_uris;
    if (!Array.isArray(redirectUris) || redirectUris.length === 0 || !redirectUris.every((uri) => typeof uri === 'string')) {
      return jsonResponse(400, {
        error: 'invalid_client_metadata',
        error_description: 'redirect_uris must be a non-empty array of strings',
      });
    }
    for (const uri of redirectUris as string[]) {
      let parsed: URL;
      try {
        parsed = new URL(uri);
      } catch {
        return jsonResponse(400, { error: 'invalid_redirect_uri', error_description: `Invalid redirect_uri: ${uri}` });
      }
      const isLoopback = parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1';
      if (parsed.protocol !== 'https:' && !(parsed.protocol === 'http:' && isLoopback)) {
        return jsonResponse(400, {
          error: 'invalid_redirect_uri',
          error_description: `redirect_uri must be https:// (or http://localhost for local testing): ${uri}`,
        });
      }
    }

    const clientId = randomId(16);
    clients.set(clientId, { clientId, redirectUris: redirectUris as string[] });
    return jsonResponse(201, {
      client_id: clientId,
      redirect_uris: redirectUris,
      token_endpoint_auth_method: 'none',
      grant_types: ['authorization_code'],
      response_types: ['code'],
    });
  }

  function handleAuthorizeGet(request: Request): Response {
    const url = new URL(request.url);
    const clientId = url.searchParams.get('client_id') ?? '';
    const redirectUri = url.searchParams.get('redirect_uri') ?? '';
    const responseType = url.searchParams.get('response_type');
    const codeChallenge = url.searchParams.get('code_challenge');
    const codeChallengeMethod = url.searchParams.get('code_challenge_method');
    const state = url.searchParams.get('state') ?? '';

    const client = clients.get(clientId);
    if (!client || !client.redirectUris.includes(redirectUri)) {
      return htmlResponse(400, '<p>Unknown client_id or unregistered redirect_uri.</p>');
    }
    if (responseType !== 'code') {
      return redirectWithError(redirectUri, state, OAuthErrorCode.UnsupportedResponseType);
    }
    if (!codeChallenge || codeChallengeMethod !== 'S256') {
      return redirectWithError(redirectUri, state, OAuthErrorCode.InvalidRequest, 'PKCE S256 code_challenge is required');
    }
    return htmlResponse(200, renderAuthorizeForm({ clientId, redirectUri, state, codeChallenge }));
  }

  async function handleAuthorizePost(request: Request): Promise<Response> {
    const form = await request.formData();
    const clientId = String(form.get('client_id') ?? '');
    const redirectUri = String(form.get('redirect_uri') ?? '');
    const state = String(form.get('state') ?? '');
    const codeChallenge = String(form.get('code_challenge') ?? '');
    const daluxBaseUrlRaw = String(form.get('dalux_base_url') ?? '');
    const daluxApiKey = String(form.get('dalux_api_key') ?? '');

    const client = clients.get(clientId);
    if (!client || !client.redirectUris.includes(redirectUri)) {
      return htmlResponse(400, '<p>Unknown client_id or unregistered redirect_uri.</p>');
    }

    const validated = validateDaluxBaseUrl(daluxBaseUrlRaw);
    if ('error' in validated || !daluxApiKey) {
      const message = !daluxApiKey
        ? 'Dalux API Key is required'
        : `Dalux Base URL ${(validated as { error: string }).error}`;
      return htmlResponse(400, renderAuthorizeForm({ clientId, redirectUri, state, codeChallenge, error: message }));
    }

    const code = randomId(24);
    authCodes.set(code, {
      clientId,
      redirectUri,
      codeChallenge,
      daluxBaseUrl: validated.baseUrl,
      daluxApiKey,
      expiresAt: Date.now() + AUTH_CODE_TTL_MS,
    });

    const target = new URL(redirectUri);
    target.searchParams.set('code', code);
    if (state) target.searchParams.set('state', state);
    return new Response(null, { status: 302, headers: { Location: target.toString() } });
  }

  async function handleToken(request: Request): Promise<Response> {
    const contentType = request.headers.get('content-type') ?? '';
    let params: URLSearchParams;
    if (contentType.includes('application/json')) {
      const body = (await request.json()) as Record<string, unknown>;
      params = new URLSearchParams(Object.entries(body).map(([key, value]): [string, string] => [key, String(value)]));
    } else {
      params = new URLSearchParams(await request.text());
    }

    if (params.get('grant_type') !== 'authorization_code') {
      return jsonResponse(400, { error: OAuthErrorCode.UnsupportedGrantType });
    }

    const code = params.get('code') ?? '';
    const redirectUri = params.get('redirect_uri') ?? '';
    const clientId = params.get('client_id') ?? '';
    const codeVerifier = params.get('code_verifier') ?? '';

    const record = authCodes.get(code);
    authCodes.delete(code); // single-use regardless of outcome

    if (!record || record.expiresAt < Date.now()) {
      return jsonResponse(400, {
        error: OAuthErrorCode.InvalidGrant,
        error_description: 'Authorization code is invalid or expired',
      });
    }
    if (record.clientId !== clientId || record.redirectUri !== redirectUri) {
      return jsonResponse(400, { error: OAuthErrorCode.InvalidGrant, error_description: 'client_id or redirect_uri mismatch' });
    }
    const computedChallenge = createHash('sha256').update(codeVerifier).digest('base64url');
    if (computedChallenge !== record.codeChallenge) {
      return jsonResponse(400, {
        error: OAuthErrorCode.InvalidGrant,
        error_description: 'code_verifier does not match code_challenge',
      });
    }

    const accessToken = randomId(32);
    const expiresAt = Math.floor(Date.now() / 1000) + ACCESS_TOKEN_TTL_SECONDS;
    accessTokens.set(accessToken, {
      clientId,
      daluxBaseUrl: record.daluxBaseUrl,
      daluxApiKey: record.daluxApiKey,
      expiresAt,
    });

    return jsonResponse(200, { access_token: accessToken, token_type: 'Bearer', expires_in: ACCESS_TOKEN_TTL_SECONDS });
  }

  async function handleRequest(request: Request): Promise<Response | undefined> {
    sweepExpired();

    const wellKnown = oauthMetadataResponse(request, { oauthMetadata: metadata, resourceServerUrl: options.resourceUrl });
    if (wellKnown) return wellKnown;

    const { pathname } = new URL(request.url);
    if (pathname === '/register' && request.method === 'POST') return handleRegister(request);
    if (pathname === '/authorize' && request.method === 'GET') return handleAuthorizeGet(request);
    if (pathname === '/authorize' && request.method === 'POST') return handleAuthorizePost(request);
    if (pathname === '/token' && request.method === 'POST') return handleToken(request);
    return undefined;
  }

  return { metadata, tokenVerifier, handleRequest };
}
