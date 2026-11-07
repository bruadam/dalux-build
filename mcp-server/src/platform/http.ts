import { createHash } from 'node:crypto';

import { createMcpHandler } from '@modelcontextprotocol/server';

import type { RequestContext } from '../access/context';
import { runWithContext } from '../access/requestScope';
import { restrictClient } from '../access/restrictedClient';
import { OAUTH_ACCESS_TOKEN_PREFIX } from '@dalux-platform/db';
import { resourceMetadataUrl } from '../oauthPlatform';
import { withEmbeddingKey } from '../search/rank';
import { buildServer } from '../server';
import { DEFAULT_TOOLSETS, requestToolsets, type Toolset } from '../toolsets';
import type { Caller, Connection, Platform } from './platform';

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
}

/**
 * `/mcp/c/<slug>` serves one connection; `/mcp` serves the token's connection,
 * else the account's default connection, else the only connection it can reach.
 */
async function resolveConnection(platform: Platform, caller: Caller, slug: string | undefined): Promise<Connection | Response> {
  if (slug) {
    const connection = await loadConnection(platform, slug);
    if (connection instanceof Response) return connection;
    if (!connection) return jsonError(404, 'unknown_connection', `No connection with slug "${slug}".`);
    if (caller.token.connectionId && caller.token.connectionId !== connection.id) {
      return jsonError(403, 'wrong_connection', `This API token is restricted to another connection than "${slug}".`);
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
    return jsonError(
      400,
      'connection_required',
      `Choose a connection with /mcp/c/<slug>. Connections this account can access: ${slugs}.`,
    );
  }
  return (await loadConnection(platform, pick.slug))!;
}

/** A connection row with a bad base URL or an undecryptable key is an admin problem; say so instead of a bare 500. */
async function loadConnection(platform: Platform, slug: string): Promise<Connection | Response | undefined> {
  try {
    return await platform.connectionBySlug(slug);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    console.error(`[platform] connection "${slug}" is misconfigured: ${reason}`);
    return jsonError(
      503,
      'connection_misconfigured',
      `Connection "${slug}" is misconfigured (${reason}); ask an admin to fix it in the web interface.`,
    );
  }
}

export function createPlatformHandler(options: PlatformHandlerOptions): (request: Request) => Promise<Response> {
  const { platform } = options;

  return async (request) => {
    const { pathname } = new URL(request.url);
    const route = ROUTE.exec(pathname);
    if (!route) return jsonError(404, 'not_found', 'MCP endpoints are /mcp and /mcp/c/<connection-slug>.');
    const unauthorized = (message: string) => {
      const metadata = options.publicUrl ? `, resource_metadata="${resourceMetadataUrl(options.publicUrl, pathname)}"` : '';
      return jsonError(401, 'invalid_token', message, { 'WWW-Authenticate': `Bearer error="invalid_token"${metadata}` });
    };

    const authorization = request.headers.get('authorization') ?? '';
    const token = authorization.startsWith('Bearer ') ? authorization.slice('Bearer '.length).trim() : undefined;
    if (!token || !TOKEN_PREFIXES.some((prefix) => token.startsWith(prefix))) {
      if (!route[1] && request.headers.has('x-dalux-api-key') && (await platform.headerModeEnabled())) {
        return options.serveWithHeaders(request);
      }
      return unauthorized('Send a platform API token (Authorization: Bearer dxm_...) or sign in with OAuth.');
    }

    const auth = await platform.authenticate(token);
    if ('error' in auth) return unauthorized(auth.error);
    const { caller } = auth;

    const connection = await resolveConnection(platform, caller, route[1]);
    if (connection instanceof Response) return connection;
    const toolsets = requestToolsets(request, options.toolsets ?? DEFAULT_TOOLSETS);
    if ('error' in toolsets) return jsonError(400, 'invalid_toolsets', toolsets.error);

    const context: RequestContext = {
      account: caller.account,
      connection: { id: connection.id },
      access: caller.access.filter((row) => row.connectionId === connection.id),
      fileNamespace: createHash('sha256').update(`${caller.account.id}/${connection.id}`).digest('hex').slice(0, 32),
    };
    const handler = createMcpHandler(() =>
      buildServer(restrictClient(connection.client, context, connection.folders), {
        context,
        folders: connection.folders,
        audit: (record) => platform.audit(caller, context, record),
        toolsets: toolsets.toolsets,
      }),
      { onerror: (error) => console.error(`[platform] MCP request on "${connection.slug}" failed:`, error) },
    );
    // The admin's embedding key is the consent to send text to the provider (PRD), so
    // search-time embeddings use it, not MISTRAL_API_KEY / DALUX_MCP_ALLOW_EXTERNAL_MODEL_IO.
    const embeddingKey = await platform.embeddingKey();
    const { result } = await withEmbeddingKey(embeddingKey, () => runWithContext(context, () => handler.fetch(request)));
    return result;
  };
}
