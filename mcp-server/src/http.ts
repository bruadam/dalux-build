import { createServer as createNodeServer } from 'node:http';
import { createHash, timingSafeEqual } from 'node:crypto';
import {
  createMcpHandler,
  bearerAuthChallengeResponse,
  getOAuthProtectedResourceMetadataUrl,
  OAuthError,
  OAuthErrorCode,
} from '@modelcontextprotocol/server';
import { toNodeHandler, localhostHostValidation, localhostOriginValidation } from '@modelcontextprotocol/node';
import { createClient } from 'dalux-build-api';
import { buildServer } from './server';
import type { RequestContext } from './access/context';
import { DEFAULT_TOOLSETS, requestToolsets, type Toolset } from './toolsets';
import { createOAuthServer, type OAuthServer } from './oauth';
import { createPlatformOAuthServer } from './oauthPlatform';
import { validateDaluxBaseUrl } from './daluxUrl';
import type { Platform } from './platform/platform';
import { createPlatformHandler } from './platform/http';
import { clientAddress, PEER_HEADER } from './platform/requestInfo';

export interface BuildHttpAppOptions {
  /**
   * Optional shared-secret bearer token required on every request
   * (Authorization: Bearer <token>), on top of the per-request Dalux
   * credentials below. Unset by default — the Dalux API key already acts as
   * the real access control, this is only an extra gate against random
   * traffic reaching the port. Ignored for requests bearing a valid
   * OAuth-issued access token (see `publicUrl`) — that token already proves
   * per-user authorization.
   */
  token?: string;
  /**
   * When true (the default), only accept requests whose Host/Origin headers
   * claim localhost — appropriate for a server you run yourself and reach
   * over `localhost`/a port-forward. Set to false for a real remote/Docker
   * deployment reachable from outside the host.
   */
  localhostOnly?: boolean;
  /**
   * The externally-reachable https:// base URL of this deployment. When
   * set, mounts a minimal OAuth 2.1 authorization server (DCR, PKCE
   * authorize/token, RFC 8414/9728 metadata) so OAuth-only clients like
   * Claude.ai's and ChatGPT's custom connectors — which can't be configured
   * with static X-Dalux-* headers — can self-serve a per-user access token
   * by pasting their Dalux Base URL + API key into a one-time browser form.
   * Unset by default: without it the server behaves exactly as before,
   * static-header-only.
   */
  publicUrl?: string;
  /**
   * Platform mode (DATABASE_URL set): callers authenticate with platform API
   * tokens and reach a connection at /mcp/c/<slug>; Dalux headers only work
   * when an admin has turned header mode on. See platform/http.ts.
   */
  platform?: Platform;
  /** Toolsets for requests without a `?toolsets=` query parameter (see toolsets.ts); defaults to DEFAULT_TOOLSETS. */
  toolsets?: readonly Toolset[];
  /** Reverse proxies that set X-Forwarded-For in front of this server (platform mode); defaults to TRUSTED_PROXY_HOPS, else 0. */
  trustedProxyHops?: number;
}

export interface HttpApp {
  start: (port: number, host?: string) => Promise<void>;
  /** The underlying web-standard fetch handler, exposed for testing without binding a real port. */
  handleRequest: (request: Request) => Promise<Response>;
}

/**
 * Diagnostic logging for tool discovery, off unless
 * `DALUX_MCP_LOG_DISCOVERY=1`. Exists to answer one question that can't be
 * answered from the server side alone: when a host advertises fewer tools
 * than this server registers, is it being served a short list, or is it
 * shortening a full one itself? Logs what each client negotiates and how
 * many tools it is actually handed. Never logs Dalux credentials — only the
 * JSON-RPC method, the client's self-reported name/version, the negotiated
 * protocol version, and counts.
 */
const LOG_DISCOVERY = process.env.DALUX_MCP_LOG_DISCOVERY === '1';

interface JsonRpcPeek {
  method?: string;
  clientName?: string;
  clientVersion?: string;
  protocolVersion?: string;
}

/**
 * Read the JSON-RPC envelope without consuming the body the MCP handler
 * still needs — hence the clone. Returns undefined for anything that isn't a
 * parseable JSON-RPC POST, since this is diagnostics: it must never be the
 * reason a request fails.
 */
async function peekJsonRpc(request: Request): Promise<JsonRpcPeek | undefined> {
  if (request.method !== 'POST') return undefined;
  try {
    const body: unknown = await request.clone().json();
    // Batches share a transport frame; the first message identifies the intent.
    const message = Array.isArray(body) ? body[0] : body;
    if (!message || typeof message !== 'object') return undefined;
    const { method, params } = message as { method?: string; params?: Record<string, unknown> };
    const clientInfo = params?.clientInfo as { name?: string; version?: string } | undefined;
    return {
      method,
      clientName: clientInfo?.name,
      clientVersion: clientInfo?.version,
      protocolVersion: typeof params?.protocolVersion === 'string' ? params.protocolVersion : undefined,
    };
  } catch {
    return undefined;
  }
}

/**
 * Pull the tool count out of a tools/list response, which may be a plain
 * JSON body or an SSE frame depending on what the client accepts.
 */
function summarizeToolList(payload: string): { count?: number; nextCursor?: boolean } {
  const frames = payload.includes('data: ')
    ? payload
        .split('\n')
        .filter((line) => line.startsWith('data: '))
        .map((line) => line.slice('data: '.length))
    : [payload];
  for (const frame of frames) {
    try {
      const parsed = JSON.parse(frame) as { result?: { tools?: unknown[]; nextCursor?: unknown } };
      if (Array.isArray(parsed.result?.tools)) {
        return { count: parsed.result.tools.length, nextCursor: Boolean(parsed.result.nextCursor) };
      }
    } catch {
      // Not every SSE frame is a JSON-RPC response; skip it.
    }
  }
  return {};
}

/**
 * Logs to stderr, not stdout: on the stdio transport stdout *is* the
 * protocol channel, and this module is shared with that entrypoint.
 */
function logDiscovery(peek: JsonRpcPeek, request: Request, response: Response): void {
  const userAgent = request.headers.get('user-agent')?.slice(0, 120) ?? '?';
  if (peek.method === 'initialize') {
    console.error(
      `[discovery] initialize client=${peek.clientName ?? '?'}@${peek.clientVersion ?? '?'} ` +
        `protocolVersion=${peek.protocolVersion ?? '?'} status=${response.status} ua=${userAgent}`,
    );
    return;
  }
  if (peek.method !== 'tools/list') return;
  // tools/list carries no clientInfo — the user agent is what ties it back
  // to the initialize above, since this transport is stateless.
  response
    .clone()
    .text()
    .then((payload) => {
      const { count, nextCursor } = summarizeToolList(payload);
      console.error(
        `[discovery] tools/list status=${response.status} tools=${count ?? '?'} ` +
          `nextCursor=${nextCursor ?? false} bytes=${payload.length} ua=${userAgent}`,
      );
    })
    .catch(() => {
      // A body we couldn't read tells us nothing; the client still got its response.
    });
}

const MAX_CREDENTIAL_HANDLERS = 200;

function invalidToolsets(message: string): Response {
  return new Response(JSON.stringify({ error: 'invalid_toolsets', message }), {
    status: 400,
    headers: { 'Content-Type': 'application/json' },
  });
}

function constantTimeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

function parseBearerToken(authorizationHeader: string | null): string | undefined {
  if (!authorizationHeader) return undefined;
  const [scheme, token] = authorizationHeader.split(' ');
  return scheme === 'Bearer' && token ? token : undefined;
}

/**
 * Extract Dalux credentials from request headers, rejecting anything that
 * doesn't look like a real Dalux API host — this endpoint proxies whatever
 * baseUrl it's given, so without this check a caller could point it at an
 * arbitrary internal URL (SSRF) using the caller-supplied X-Dalux-Base-Url.
 */
function extractCredentials(request: Request): { baseUrl: string; apiKey: string } | { error: string } {
  const baseUrl = request.headers.get('x-dalux-base-url');
  const apiKey = request.headers.get('x-dalux-api-key');
  if (!baseUrl || !apiKey) {
    return { error: 'X-Dalux-Base-Url and X-Dalux-Api-Key headers are required' };
  }
  const validated = validateDaluxBaseUrl(baseUrl);
  if ('error' in validated) {
    return { error: `X-Dalux-Base-Url ${validated.error}` };
  }
  return { baseUrl: validated.baseUrl, apiKey };
}

/**
 * Build a streamable-HTTP app for the Dalux MCP server that takes Dalux
 * credentials from per-request headers (X-Dalux-Base-Url, X-Dalux-Api-Key)
 * instead of server-side env vars — so the VM/container hosting this never
 * stores a Dalux API key itself; it lives only in the connecting client's
 * own MCP server config.
 */
export function buildHttpApp(options: BuildHttpAppOptions = {}): HttpApp {
  const handlersByCredentials = new Map<string, ReturnType<typeof createMcpHandler>>();

  let oauthServer: OAuthServer | undefined;
  let resourceMetadataUrl: string | undefined;
  let platformOAuth: ReturnType<typeof createPlatformOAuthServer> | undefined;
  if (options.publicUrl) {
    const issuerUrl = new URL(options.publicUrl);
    if (issuerUrl.protocol !== 'https:') {
      throw new Error('publicUrl must be an https:// URL for OAuth support');
    }
    if (options.platform) {
      // The platform is the authorization server: accounts log in on the web interface (PRD 6.5 mode B).
      const { platform } = options;
      platformOAuth = createPlatformOAuthServer({
        issuer: issuerUrl.origin,
        db: platform.db,
        onFailure: (reason, request) =>
          platform.authEvent({ source: 'oauth', reason, address: clientAddress(request, options.trustedProxyHops), userAgent: request.headers.get('user-agent') }),
      });
    } else {
      const resourceUrl = new URL('/mcp', issuerUrl);
      oauthServer = createOAuthServer({ issuer: issuerUrl.origin, resourceUrl });
      resourceMetadataUrl = getOAuthProtectedResourceMetadataUrl(resourceUrl);
    }
  }

  const serveWithHeaders = async (request: Request): Promise<Response> => {
    const bearerToken = parseBearerToken(request.headers.get('authorization'));

    let daluxCredentials: { baseUrl: string; apiKey: string } | undefined;
    if (oauthServer && bearerToken) {
      try {
        const authInfo = await oauthServer.tokenVerifier.verifyAccessToken(bearerToken);
        const extra = authInfo.extra as { daluxBaseUrl: string; daluxApiKey: string };
        daluxCredentials = { baseUrl: extra.daluxBaseUrl, apiKey: extra.daluxApiKey };
      } catch {
        // Not a recognized OAuth access token — fall through to the
        // shared-secret / static-header flow below.
      }
    }

    if (!daluxCredentials) {
      if (options.token) {
        if (!bearerToken || !constantTimeEqual(bearerToken, options.token)) {
          return new Response(JSON.stringify({ error: 'invalid_token' }), {
            status: 401,
            headers: { 'Content-Type': 'application/json', 'WWW-Authenticate': 'Bearer' },
          });
        }
      }

      const credentials = extractCredentials(request);
      if ('error' in credentials) {
        if (resourceMetadataUrl) {
          return bearerAuthChallengeResponse(new OAuthError(OAuthErrorCode.InvalidToken, credentials.error), {
            resourceMetadataUrl,
          });
        }
        return new Response(JSON.stringify({ error: 'missing_credentials', message: credentials.error }), {
          status: 401,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      daluxCredentials = credentials;
    }

    const toolsets = requestToolsets(request, options.toolsets ?? DEFAULT_TOOLSETS);
    if ('error' in toolsets) return invalidToolsets(toolsets.error);

    const credentialKey = `${daluxCredentials.baseUrl} ${daluxCredentials.apiKey}`;
    const key = `${credentialKey} ${toolsets.toolsets.join(',')}`;
    let mcpHandler = handlersByCredentials.get(key);
    if (!mcpHandler) {
      const client = createClient({ baseUrl: daluxCredentials.baseUrl, apiKey: daluxCredentials.apiKey });
      // Callers with different Dalux credentials never share temporary indexes, reports, or cached
      // downloads (SECURITY-ANALYSIS #1); stdio has one caller and keeps the shared context.
      const context: RequestContext = {
        access: 'unrestricted',
        fileNamespace: createHash('sha256').update(credentialKey).digest('hex').slice(0, 32),
      };
      mcpHandler = createMcpHandler(() => buildServer(client, { context, toolsets: toolsets.toolsets }));
      // Anyone can send new credentials, so the map must not grow without bound.
      if (handlersByCredentials.size >= MAX_CREDENTIAL_HANDLERS) handlersByCredentials.delete(handlersByCredentials.keys().next().value!);
      handlersByCredentials.set(key, mcpHandler);
    }
    return mcpHandler.fetch(request);
  };

  const platform = options.platform;
  const serve = platform
    ? createPlatformHandler({ platform, serveWithHeaders, publicUrl: options.publicUrl, toolsets: options.toolsets, trustedProxyHops: options.trustedProxyHops })
    : serveWithHeaders;

  const guardedHandler = {
    fetch: async (request: Request): Promise<Response> => {
      const oauthResponse = await (platformOAuth ?? oauthServer)?.handleRequest(request);
      if (oauthResponse) return oauthResponse;

      // Peek before the handler consumes the body, log after it answers.
      const peek = LOG_DISCOVERY ? await peekJsonRpc(request) : undefined;
      const response = await serve(request);
      if (peek) logDiscovery(peek, request, response);
      return response;
    },
  };

  const nodeHandler = toNodeHandler(guardedHandler);
  const localhostOnly = options.localhostOnly ?? true;
  const validateHost = localhostOnly ? localhostHostValidation() : null;
  const validateOrigin = localhostOnly ? localhostOriginValidation() : null;

  const server = createNodeServer((req, res) => {
    if (validateHost && !validateHost(req, res)) return;
    if (validateOrigin && !validateOrigin(req, res)) return;
    req.headers[PEER_HEADER] = req.socket.remoteAddress;
    void nodeHandler(req, res);
  });

  return {
    handleRequest: guardedHandler.fetch,
    start: (port: number, host = localhostOnly ? '127.0.0.1' : '0.0.0.0') =>
      new Promise((resolve) => {
        server.listen(port, host, () => resolve());
      }),
  };
}
