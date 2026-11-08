import { createHash } from 'node:crypto';
import { and, eq, isNull } from 'drizzle-orm';
import { OAuthErrorCode, oauthMetadataResponse, type OAuthMetadata } from '@modelcontextprotocol/server';
import {
  accounts,
  generateOAuthSecret,
  hashApiToken,
  OAUTH_ACCESS_TOKEN_PREFIX,
  OAUTH_ACCESS_TOKEN_TTL_SECONDS,
  OAUTH_REFRESH_TOKEN_PREFIX,
  OAUTH_REFRESH_TOKEN_TTL_SECONDS,
  oauthClients,
  oauthCodes,
  oauthSessions,
  oauthTokens,
  type Db,
  type Tx,
} from '@dalux-platform/db';
import { corsPreflightResponse, jsonResponse, randomId, readParams, validateRedirectUris } from './oauth';
import { clientAddress, createRateLimiter } from './rateLimit';

/** MCP endpoints a protected-resource metadata document can describe (RFC 9728, path-aware). */
const RESOURCE_PATH = /^\/mcp(?:\/c\/[a-z0-9][a-z0-9-]*)?$/;
const PROTECTED_RESOURCE_PREFIX = '/.well-known/oauth-protected-resource';

function invalidGrant(description: string): Response {
  return jsonResponse(400, { error: OAuthErrorCode.InvalidGrant, error_description: description });
}

/**
 * The platform's OAuth 2.1 authorization server (PRD 6.5 mode B). The web
 * interface serves `/authorize` (login, consent, connection picker) and writes
 * the authorization code; this module serves discovery, dynamic client
 * registration, the token endpoint (code and rotating refresh tokens), and
 * revocation. Codes and tokens are stored as sha256 hashes. One consent is one
 * `oauth_sessions` row; revoking it revokes every token issued under it.
 */
export function createPlatformOAuthServer(options: { issuer: string; db: Db }) {
  const { db } = options;
  const issuer = new URL(options.issuer).origin;
  // These endpoints take no credentials from the caller, so they are limited per client address.
  const limiter = createRateLimiter({
    register: { max: 20, windowMs: 60 * 60 * 1000 },
    token: { max: 60, windowMs: 60 * 1000 },
  });

  const metadata: OAuthMetadata = {
    issuer,
    authorization_endpoint: `${issuer}/authorize`,
    token_endpoint: `${issuer}/token`,
    registration_endpoint: `${issuer}/register`,
    revocation_endpoint: `${issuer}/revoke`,
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    code_challenge_methods_supported: ['S256'],
    token_endpoint_auth_methods_supported: ['none'],
    revocation_endpoint_auth_methods_supported: ['none'],
  };

  async function issueTokens(tx: Tx, sessionId: string): Promise<Response> {
    const access = generateOAuthSecret(OAUTH_ACCESS_TOKEN_PREFIX);
    const refresh = generateOAuthSecret(OAUTH_REFRESH_TOKEN_PREFIX);
    const now = Date.now();
    await tx.insert(oauthTokens).values([
      { tokenHash: access.hash, sessionId, kind: 'access', expiresAt: new Date(now + OAUTH_ACCESS_TOKEN_TTL_SECONDS * 1000) },
      { tokenHash: refresh.hash, sessionId, kind: 'refresh', expiresAt: new Date(now + OAUTH_REFRESH_TOKEN_TTL_SECONDS * 1000) },
    ]);
    return jsonResponse(200, {
      access_token: access.value,
      token_type: 'Bearer',
      expires_in: OAUTH_ACCESS_TOKEN_TTL_SECONDS,
      refresh_token: refresh.value,
    });
  }

  async function handleRegister(request: Request): Promise<Response> {
    let body: { redirect_uris?: unknown; client_name?: unknown };
    try {
      body = (await request.json()) as typeof body;
    } catch {
      return jsonResponse(400, { error: 'invalid_client_metadata', error_description: 'Body must be JSON' });
    }
    const redirectUris = validateRedirectUris(body.redirect_uris);
    if (redirectUris instanceof Response) return redirectUris;
    const name = typeof body.client_name === 'string' ? body.client_name.slice(0, 200) : null;

    const clientId = randomId(16);
    await db.insert(oauthClients).values({ id: clientId, name, redirectUris });
    return jsonResponse(201, {
      client_id: clientId,
      ...(name ? { client_name: name } : {}),
      redirect_uris: redirectUris,
      token_endpoint_auth_method: 'none',
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
    });
  }

  function exchangeCode(params: URLSearchParams): Promise<Response> {
    return db.transaction(async (tx) => {
      // Single use: the code is marked used whatever the outcome.
      const [code] = await tx
        .update(oauthCodes)
        .set({ usedAt: new Date() })
        .where(and(eq(oauthCodes.codeHash, hashApiToken(params.get('code') ?? '')), isNull(oauthCodes.usedAt)))
        .returning();
      if (!code || code.expiresAt <= new Date()) return invalidGrant('Authorization code is invalid or expired');
      if (code.clientId !== params.get('client_id') || code.redirectUri !== params.get('redirect_uri')) {
        return invalidGrant('client_id or redirect_uri mismatch');
      }
      const challenge = createHash('sha256').update(params.get('code_verifier') ?? '').digest('base64url');
      if (challenge !== code.codeChallenge) return invalidGrant('code_verifier does not match code_challenge');
      const [account] = await tx.select({ status: accounts.status }).from(accounts).where(eq(accounts.id, code.accountId));
      if (account?.status !== 'active') return invalidGrant('The account is not active');

      const [session] = await tx
        .insert(oauthSessions)
        .values({ clientId: code.clientId, accountId: code.accountId, connectionId: code.connectionId, capabilities: code.capabilities })
        .returning({ id: oauthSessions.id });
      return issueTokens(tx, session.id);
    });
  }

  /** Refresh tokens rotate on use; presenting a used one revokes the whole session (reuse detection). */
  function refresh(params: URLSearchParams): Promise<Response> {
    return db.transaction(async (tx) => {
      const tokenHash = hashApiToken(params.get('refresh_token') ?? '');
      const [row] = await tx
        .select({ token: oauthTokens, session: oauthSessions })
        .from(oauthTokens)
        .innerJoin(oauthSessions, eq(oauthSessions.id, oauthTokens.sessionId))
        .where(and(eq(oauthTokens.tokenHash, tokenHash), eq(oauthTokens.kind, 'refresh')));
      if (!row || row.session.clientId !== params.get('client_id')) return invalidGrant('Refresh token is invalid');
      if (row.session.revokedAt) return invalidGrant('Refresh token is revoked');
      if (row.token.expiresAt <= new Date()) return invalidGrant('Refresh token is expired');

      const [rotated] = await tx
        .update(oauthTokens)
        .set({ revokedAt: new Date() })
        .where(and(eq(oauthTokens.tokenHash, tokenHash), isNull(oauthTokens.revokedAt)))
        .returning({ tokenHash: oauthTokens.tokenHash });
      if (!rotated) {
        await tx.update(oauthSessions).set({ revokedAt: new Date() }).where(eq(oauthSessions.id, row.session.id));
        return invalidGrant('Refresh token was already used; the session is revoked');
      }
      return issueTokens(tx, row.session.id);
    });
  }

  async function handleToken(request: Request): Promise<Response> {
    const params = await readParams(request);
    const grantType = params.get('grant_type');
    if (grantType === 'authorization_code') return exchangeCode(params);
    if (grantType === 'refresh_token') return refresh(params);
    return jsonResponse(400, { error: OAuthErrorCode.UnsupportedGrantType });
  }

  /** RFC 7009: revoking any token revokes its session. Unknown tokens still get 200. */
  async function handleRevoke(request: Request): Promise<Response> {
    const params = await readParams(request);
    const [row] = await db
      .select({ sessionId: oauthSessions.id, clientId: oauthSessions.clientId })
      .from(oauthTokens)
      .innerJoin(oauthSessions, eq(oauthSessions.id, oauthTokens.sessionId))
      .where(eq(oauthTokens.tokenHash, hashApiToken(params.get('token') ?? '')));
    const clientId = params.get('client_id');
    if (row && (!clientId || clientId === row.clientId)) {
      await db
        .update(oauthSessions)
        .set({ revokedAt: new Date() })
        .where(and(eq(oauthSessions.id, row.sessionId), isNull(oauthSessions.revokedAt)));
    }
    return jsonResponse(200, {});
  }

  function discovery(request: Request): Response | undefined {
    const { pathname } = new URL(request.url);
    const resourcePath = pathname.startsWith(PROTECTED_RESOURCE_PREFIX) ? pathname.slice(PROTECTED_RESOURCE_PREFIX.length) : '/mcp';
    if (!RESOURCE_PATH.test(resourcePath.replace(/\/$/, ''))) return undefined;
    return oauthMetadataResponse(request, {
      oauthMetadata: metadata,
      resourceServerUrl: new URL(resourcePath, issuer),
    });
  }

  async function handleRequest(request: Request): Promise<Response | undefined> {
    const wellKnown = discovery(request);
    if (wellKnown) return wellKnown;

    const { pathname } = new URL(request.url);
    if (!['/register', '/token', '/revoke'].includes(pathname)) return undefined;
    if (request.method === 'OPTIONS') return corsPreflightResponse();
    if (request.method !== 'POST') return jsonResponse(405, { error: 'method_not_allowed' });
    if (!limiter.allow(pathname === '/register' ? 'register' : 'token', clientAddress(request))) {
      return jsonResponse(429, { error: 'too_many_requests', error_description: 'Too many requests; try again later.' });
    }
    if (pathname === '/register') return handleRegister(request);
    if (pathname === '/token') return handleToken(request);
    return handleRevoke(request);
  }

  return { metadata, handleRequest };
}

/** `WWW-Authenticate` for a 401 on an MCP path, pointing clients at its protected-resource metadata (RFC 9728). */
export function resourceMetadataUrl(issuer: string, mcpPath: string): string {
  return `${new URL(issuer).origin}${PROTECTED_RESOURCE_PREFIX}${mcpPath.replace(/\/$/, '')}`;
}
