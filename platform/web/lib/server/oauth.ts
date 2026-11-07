import { and, desc, eq, isNull } from 'drizzle-orm';
import { connections, createAuthorizationCode, effectiveAccess, findOAuthClient, oauthClients, oauthSessions, type Db } from '@dalux-platform/db';
import { audit, type Actor } from './actor';
import { UserError } from './errors';

/** A validated `/authorize` request (OAuth 2.1 with PKCE S256). */
export interface AuthorizationRequest {
  clientId: string;
  clientName: string | null;
  redirectUri: string;
  state: string | null;
  codeChallenge: string;
  /** Set when the client names a connection endpoint (`resource=…/mcp/c/<slug>`, RFC 8707); the consent is then for that connection only. */
  connectionSlug: string | null;
}

/**
 * `error` without `redirect` must be shown on the page: the client or its
 * redirect URI is unknown, so redirecting would be an open redirect.
 */
export type AuthorizationRequestResult = { request: AuthorizationRequest } | { error: string; redirect?: string };

const RESOURCE_SLUG = /\/mcp\/c\/([a-z0-9][a-z0-9-]*)\/?$/;

export function errorRedirect(redirectUri: string, state: string | null, error: string, description?: string): string {
  const url = new URL(redirectUri);
  url.searchParams.set('error', error);
  if (description) url.searchParams.set('error_description', description);
  if (state) url.searchParams.set('state', state);
  return url.toString();
}

export async function parseAuthorizationRequest(db: Db, params: URLSearchParams): Promise<AuthorizationRequestResult> {
  const clientId = params.get('client_id') ?? '';
  const redirectUri = params.get('redirect_uri') ?? '';
  const client = clientId && redirectUri ? await findOAuthClient(db, clientId, redirectUri) : undefined;
  if (!client) return { error: 'Unknown client or redirect URI. Remove the app in your MCP client and connect again.' };

  const state = params.get('state');
  const fail = (error: string, description: string) => ({ error: description, redirect: errorRedirect(redirectUri, state, error, description) });
  if (params.get('response_type') !== 'code') return fail('unsupported_response_type', 'response_type must be code');
  const codeChallenge = params.get('code_challenge');
  if (!codeChallenge || params.get('code_challenge_method') !== 'S256') {
    return fail('invalid_request', 'PKCE with code_challenge_method=S256 is required');
  }
  return {
    request: {
      clientId,
      clientName: client.name,
      redirectUri,
      state,
      codeChallenge,
      connectionSlug: RESOURCE_SLUG.exec(params.get('resource') ?? '')?.[1] ?? null,
    },
  };
}

/** Connections the account can reach, each with the capabilities it has there. */
export async function consentChoices(db: Db, accountId: string) {
  const rows = await db
    .selectDistinct({ id: connections.id, name: connections.name, slug: connections.slug, capability: effectiveAccess.capability })
    .from(effectiveAccess)
    .innerJoin(connections, eq(connections.id, effectiveAccess.connectionId))
    .where(eq(effectiveAccess.accountId, accountId))
    .orderBy(connections.name, effectiveAccess.capability);
  const byId = new Map<string, { id: string; name: string; slug: string; capabilities: string[] }>();
  for (const { capability, ...connection } of rows) {
    const entry = byId.get(connection.id) ?? { ...connection, capabilities: [] };
    entry.capabilities.push(capability);
    byId.set(connection.id, entry);
  }
  return [...byId.values()];
}

/**
 * Records the user's approval and returns the client redirect carrying the
 * code. Keeping every capability the account has on the connection stores
 * "full account access", which then follows later grant changes.
 */
export async function approveAuthorization(
  db: Db,
  actor: Actor,
  request: AuthorizationRequest,
  choice: { connectionId: string; capabilities: string[] },
): Promise<string> {
  const connection = (await consentChoices(db, actor.accountId)).find((c) => c.id === choice.connectionId);
  if (!connection) throw new UserError('You have no access to this connection');
  if (request.connectionSlug && request.connectionSlug !== connection.slug) {
    throw new UserError(`This app asked for the connection "${request.connectionSlug}"`);
  }
  const chosen = connection.capabilities.filter((capability) => choice.capabilities.includes(capability));
  if (!chosen.length) throw new UserError('Choose at least one capability');

  const code = await createAuthorizationCode(db, {
    clientId: request.clientId,
    accountId: actor.accountId,
    connectionId: connection.id,
    redirectUri: request.redirectUri,
    codeChallenge: request.codeChallenge,
    capabilities: chosen.length === connection.capabilities.length ? null : chosen,
  });
  const url = new URL(request.redirectUri);
  url.searchParams.set('code', code);
  if (request.state) url.searchParams.set('state', request.state);
  return url.toString();
}

/** The consent form's answer: the client redirect with a code, or with `access_denied`. */
export async function decideAuthorization(
  db: Db,
  actor: Actor,
  params: URLSearchParams,
  answer: { approve: boolean; connectionId: string; capabilities: string[] },
): Promise<string> {
  const parsed = await parseAuthorizationRequest(db, params);
  if ('error' in parsed) throw new UserError(parsed.error);
  const { request } = parsed;
  if (!answer.approve) return errorRedirect(request.redirectUri, request.state, 'access_denied', 'The user denied access');
  return approveAuthorization(db, actor, request, answer);
}

/** The account's OAuth sessions (one per approval), newest first. */
export function listOAuthSessions(db: Db, accountId: string) {
  return db
    .select({
      id: oauthSessions.id,
      clientName: oauthClients.name,
      connectionName: connections.name,
      capabilities: oauthSessions.capabilities,
      createdAt: oauthSessions.createdAt,
      lastUsedAt: oauthSessions.lastUsedAt,
      revokedAt: oauthSessions.revokedAt,
    })
    .from(oauthSessions)
    .innerJoin(oauthClients, eq(oauthClients.id, oauthSessions.clientId))
    .innerJoin(connections, eq(connections.id, oauthSessions.connectionId))
    .where(eq(oauthSessions.accountId, accountId))
    .orderBy(desc(oauthSessions.createdAt));
}

/** Revokes an OAuth session and so every token issued under it; the MCP server notices within 60 s. */
export async function revokeOAuthSession(db: Db, actor: Actor, sessionId: string): Promise<void> {
  await db.transaction(async (tx) => {
    const [session] = await tx
      .update(oauthSessions)
      .set({ revokedAt: new Date() })
      .where(and(eq(oauthSessions.id, sessionId), eq(oauthSessions.accountId, actor.accountId), isNull(oauthSessions.revokedAt)))
      .returning({ id: oauthSessions.id });
    if (!session) throw new UserError('OAuth session not found');
    await audit(tx, actor, 'oauth.revoke', 'oauth_session', sessionId);
  });
}
