import { createHash, randomUUID } from 'node:crypto';

import { createMcpHandler } from '@modelcontextprotocol/server';

import { applyIpLogging, OAUTH_ACCESS_TOKEN_PREFIX, tokenDisplayPrefix, trustedProxyHops } from '@dalux-platform/db';

import type { RequestContext, RequestMeta } from '../access/context';
import { logJson } from '../observability/log';
import { touchSession } from '../observability/metrics';
import { runWithContext } from '../access/requestScope';
import { restrictClient } from '../access/restrictedClient';
import { resourceMetadataUrl } from '../oauthPlatform';
import { withEmbeddingKey } from '../search/rank';
import { buildServer } from '../server';
import { DEFAULT_TOOLSETS, requestToolsets, type Toolset } from '../toolsets';
import type { Caller, Connection, Platform } from './platform';
import { clientAddress } from './requestInfo';

const TOKEN_PREFIXES = ['dxm_', OAUTH_ACCESS_TOKEN_PREFIX];
const ROUTE = /^\/mcp(?:\/c\/([a-z0-9][a-z0-9-]*))?\/?$/;

function jsonError(status: number, error: string, message: string, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify({ error, message }), { status, headers: { 'Content-Type': 'application/json', ...headers } });
}

export interface PlatformHandlerOptions {
  platform: Platform;
  /** Today's Dalux-header flow, used only when an admin has turned header mode on. */
  serveWithHeaders: (request: Request) => Promise<Response>;
  /** When set, 401s point OAuth clients at the protected-resource metadata of the requested path (RFC 9728). */
  publicUrl?: string;
  /** Toolsets for requests without `?toolsets=`; defaults to DEFAULT_TOOLSETS, as outside platform mode. */
  toolsets?: readonly Toolset[];
  /** Reverse proxies in front of the server that set X-Forwarded-For; defaults to TRUSTED_PROXY_HOPS (0). */
  trustedProxyHops?: number;
}

/** Answers with an error; a `reason` also records the attempt in `auth_events`. */
type Fail = (status: number, error: string, message: string, reason?: string, headers?: Record<string, string>) => Response;

/**
 * `/mcp/c/<slug>` serves one connection; `/mcp` serves the token's connection,
 * else the account's default connection, else the only connection it can reach.
 */
async function resolveConnection(platform: Platform, caller: Caller, slug: string | undefined, fail: Fail): Promise<Connection | Response> {
  if (slug) {
    const connection = await loadConnection(platform, slug, fail);
    if (connection instanceof Response) return connection;
    if (!connection) return fail(404, 'unknown_connection', `No connection with slug "${slug}".`, 'unknown_connection');
    if (caller.token.connectionId && caller.token.connectionId !== connection.id) {
      return fail(403, 'wrong_connection', `This API token is restricted to another connection than "${slug}".`, 'wrong_connection');
    }
    return connection;
  }

  const all = await platform.listConnections();
  const reachable = all.filter((c) => caller.access.some((row) => row.connectionId === c.id));
  const pick =
    all.find((c) => c.id === caller.token.connectionId) ??
    all.find((c) => c.id === caller.defaultConnectionId) ??
    (reachable.length === 1 ? reachable[0] : undefined);
  if (!pick) {
    const slugs = reachable.map((c) => c.slug).join(', ') || 'none';
    return fail(400, 'connection_required', `Choose a connection with /mcp/c/<slug>. Connections this account can access: ${slugs}.`);
  }
  return (await loadConnection(platform, pick.slug, fail))!;
}

/** A connection row with a bad base URL or an undecryptable key is an admin problem; say so instead of a bare 500. */
async function loadConnection(platform: Platform, slug: string, fail: Fail): Promise<Connection | Response | undefined> {
  try {
    return await platform.connectionBySlug(slug);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    console.error(`[platform] connection "${slug}" is misconfigured: ${reason}`);
    return fail(503, 'connection_misconfigured', `Connection "${slug}" is misconfigured (${reason}); ask an admin to fix it in the web interface.`);
  }
}

export function createPlatformHandler(options: PlatformHandlerOptions): (request: Request) => Promise<Response> {
  const { platform } = options;
  const hops = options.trustedProxyHops ?? trustedProxyHops();

  async function handle(request: Request, requestId: string, info: Record<string, unknown>): Promise<Response> {
    const { pathname } = new URL(request.url);
    const route = ROUTE.exec(pathname);
    if (!route) return jsonError(404, 'not_found', 'MCP endpoints are /mcp and /mcp/c/<connection-slug>.');

    const address = clientAddress(request, hops);
    const userAgent = request.headers.get('user-agent') ?? undefined;
    const authorization = request.headers.get('authorization') ?? '';
    const token = authorization.startsWith('Bearer ') ? authorization.slice('Bearer '.length).trim() : undefined;
    const attempt = { source: 'mcp' as const, requestId, address, userAgent, connectionSlug: route[1], tokenPrefix: tokenDisplayPrefix(token, TOKEN_PREFIXES) };
    let failedAccountId: string | undefined;
    const fail: Fail = (status, error, message, reason, headers) => {
      if (reason) platform.authEvent({ ...attempt, reason, accountId: failedAccountId });
      return jsonError(status, error, `${message} (request id ${requestId})`, headers);
    };
    const unauthorized = (message: string, reason: string) => {
      const metadata = options.publicUrl ? `, resource_metadata="${resourceMetadataUrl(options.publicUrl, pathname)}"` : '';
      return fail(401, 'invalid_token', message, reason, { 'WWW-Authenticate': `Bearer error="invalid_token"${metadata}` });
    };

    if (!token || !TOKEN_PREFIXES.some((prefix) => token.startsWith(prefix))) {
      if (!route[1] && request.headers.has('x-dalux-api-key')) {
        if (await platform.headerModeEnabled()) return options.serveWithHeaders(request);
        return unauthorized('Send a platform API token (Authorization: Bearer dxm_...) or sign in with OAuth.', 'header_mode_disabled');
      }
      return unauthorized(
        'Send a platform API token (Authorization: Bearer dxm_...) or sign in with OAuth.',
        token ? 'malformed_token' : 'missing_token',
      );
    }

    const auth = await platform.authenticate(token);
    if ('error' in auth) {
      failedAccountId = auth.accountId;
      return unauthorized(auth.error, auth.code);
    }
    const { caller } = auth;
    failedAccountId = caller.account.id;
    info.account_id = caller.account.id;
    info.connection = route[1];
    touchSession(caller.token.id);

    const connection = await resolveConnection(platform, caller, route[1], fail);
    if (connection instanceof Response) return connection;
    // People who were granted memory get its tools without having to ask for the toolset.
    const baseToolsets = options.toolsets ?? DEFAULT_TOOLSETS;
    const holdsMemory = caller.access.some((row) => row.capability.startsWith('memory:'));
    const toolsets = requestToolsets(request, holdsMemory ? [...new Set([...baseToolsets, 'memory' as const])] : baseToolsets);
    if ('error' in toolsets) return fail(400, 'invalid_toolsets', toolsets.error);

    const logging = await platform.loggingSettings();
    const stored = applyIpLogging(address, logging.ipLogging);
    const meta: RequestMeta = {
      requestId,
      ip: stored.ip,
      forwardedFor: stored.forwardedFor,
      userAgent: userAgent?.slice(0, 300),
      authMethod: token.startsWith(OAUTH_ACCESS_TOKEN_PREFIX) ? 'dxo' : 'dxm',
      credentialId: caller.token.id,
      mcpSessionId: request.headers.get('mcp-session-id') ?? undefined,
      logQueryText: logging.logQueryText,
    };
    const context: RequestContext = {
      account: caller.account,
      connection: { id: connection.id, slug: connection.slug },
      request: meta,
      access: caller.access.filter((row) => row.connectionId === connection.id),
      fileNamespace: createHash('sha256').update(`${caller.account.id}/${connection.id}`).digest('hex').slice(0, 32),
      client: caller.token.name,
    };
    const handler = createMcpHandler(() =>
      buildServer(restrictClient(connection.client, context, connection.folders), {
        context,
        folders: connection.folders,
        audit: (record) => platform.audit(caller, context, record),
        toolsets: toolsets.toolsets,
        memoryDb: platform.db,
      }),
      { onerror: (error) => console.error(`[platform] MCP request on "${connection.slug}" failed:`, error) },
    );
    // The admin's embedding key is the consent to send text to the provider (PRD), so
    // search-time embeddings use it, not MISTRAL_API_KEY / DALUX_MCP_ALLOW_EXTERNAL_MODEL_IO.
    const embeddingKey = await platform.embeddingKey();
    const { result } = await withEmbeddingKey(embeddingKey, () => runWithContext(context, () => handler.fetch(request)));
    Object.assign(info, { connection: connection.slug, auth_method: meta.authMethod, ip: meta.ip });
    return result;
  }

  return async (request) => {
    const requestId = randomUUID();
    const startedAt = Date.now();
    const info: Record<string, unknown> = {};
    const response = await handle(request, requestId, info);
    const headers = new Headers(response.headers);
    headers.set('X-Request-Id', requestId);
    logJson({ request_id: requestId, event: 'request', ...info, http_status: response.status, duration_ms: Date.now() - startedAt }, response.status >= 500 ? 'error' : 'info');
    return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
  };
}
