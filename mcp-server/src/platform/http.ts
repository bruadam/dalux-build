import { createMcpHandler } from '@modelcontextprotocol/server';

import type { RequestContext } from '../access/context';
import { runWithContext } from '../access/requestScope';
import { restrictClient } from '../access/restrictedClient';
import type { ModelLinkStore } from '../modelLinks';
import { buildServer } from '../server';
import type { Caller, Connection, Platform } from './platform';

const API_TOKEN_PREFIX = 'dxm_';
const ROUTE = /^\/mcp(?:\/c\/([a-z0-9][a-z0-9-]*))?\/?$/;

function jsonError(status: number, error: string, message: string): Response {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (status === 401) headers['WWW-Authenticate'] = `Bearer error="${error}"`;
  return new Response(JSON.stringify({ error, message }), { status, headers });
}

export interface PlatformHandlerOptions {
  platform: Platform;
  publicUrl?: string;
  modelLinks: ModelLinkStore;
  /** Today's Dalux-header flow, used only when an admin has turned header mode on. */
  serveWithHeaders: (request: Request) => Promise<Response>;
}

/**
 * `/mcp/c/<slug>` serves one connection; `/mcp` serves the token's connection,
 * else the account's default connection, else the only connection it can reach.
 */
async function resolveConnection(platform: Platform, caller: Caller, slug: string | undefined): Promise<Connection | Response> {
  if (slug) {
    const connection = await platform.connectionBySlug(slug);
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
  return (await platform.connectionBySlug(pick.slug))!;
}

export function createPlatformHandler(options: PlatformHandlerOptions): (request: Request) => Promise<Response> {
  const { platform } = options;

  return async (request) => {
    const route = ROUTE.exec(new URL(request.url).pathname);
    if (!route) return jsonError(404, 'not_found', 'MCP endpoints are /mcp and /mcp/c/<connection-slug>.');

    const authorization = request.headers.get('authorization') ?? '';
    const token = authorization.startsWith('Bearer ') ? authorization.slice('Bearer '.length).trim() : undefined;
    if (!token?.startsWith(API_TOKEN_PREFIX)) {
      if (!route[1] && request.headers.has('x-dalux-api-key') && (await platform.headerModeEnabled())) {
        return options.serveWithHeaders(request);
      }
      return jsonError(401, 'invalid_token', 'Send a platform API token: Authorization: Bearer dxm_...');
    }

    const auth = await platform.authenticate(token);
    if ('error' in auth) return jsonError(401, 'invalid_token', auth.error);
    const { caller } = auth;

    const connection = await resolveConnection(platform, caller, route[1]);
    if (connection instanceof Response) return connection;

    const context: RequestContext = {
      account: caller.account,
      connection: { id: connection.id },
      access: caller.access.filter((row) => row.connectionId === connection.id),
    };
    const hosting = options.publicUrl
      ? {
          publicUrl: options.publicUrl,
          daluxBaseUrl: connection.baseUrl,
          daluxApiKey: connection.apiKey,
          modelLinks: options.modelLinks,
        }
      : undefined;
    const handler = createMcpHandler(() =>
      buildServer(restrictClient(connection.client, context, connection.folders), {
        context,
        hosting,
        folders: connection.folders,
        audit: (record) => platform.audit(caller, context, record),
      }),
    );
    return runWithContext(context, () => handler.fetch(request));
  };
}
