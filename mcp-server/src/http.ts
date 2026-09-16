import { createServer as createNodeServer } from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { Readable } from 'node:stream';
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
import { createOAuthServer, type OAuthServer } from './oauth';
import { validateDaluxBaseUrl } from './daluxUrl';
import { createModelLinkStore, resolveModelFile, type ModelLinkStore } from './modelLinks';
import { IFCLITE_EMBED_ORIGIN } from './ui/ifcViewer';

/** Exported for tests only — not part of the public module surface. */
export const MODEL_ROUTE_PREFIX = '/models/';

/**
 * Serves the IFC bytes a `view_model_3d` ticket points at, for the ifclite
 * embed viewer running in a foreign-origin iframe (see ui/ifcViewer.ts) to
 * fetch. This route authenticates via the opaque ticket in the URL, not via
 * Dalux credentials or the OAuth bearer token, so it's handled up front,
 * before any of that — and its CORS headers deliberately allow only
 * `embed.ifclite.com`, the one origin that has any business calling it.
 */
export async function handleModelRequest(request: Request, modelLinks: ModelLinkStore): Promise<Response | undefined> {
  const url = new URL(request.url);
  if (!url.pathname.startsWith(MODEL_ROUTE_PREFIX)) return undefined;

  const corsHeaders: Record<string, string> = {
    'Access-Control-Allow-Origin': IFCLITE_EMBED_ORIGIN,
    'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
    'Access-Control-Allow-Headers': 'range',
    'Access-Control-Expose-Headers': 'content-length, content-range, accept-ranges',
    Vary: 'Origin',
  };

  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders });
  }
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return new Response('Method not allowed', { status: 405, headers: corsHeaders });
  }

  const token = url.pathname.slice(MODEL_ROUTE_PREFIX.length);
  const ticket = modelLinks.consume(token);
  if (!ticket) {
    return new Response('Model link expired or unknown', { status: 404, headers: corsHeaders });
  }

  let filePath: string | undefined;
  try {
    filePath = await resolveModelFile(ticket);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return new Response(`Failed to fetch model: ${message}`, { status: 502, headers: corsHeaders });
  }
  if (!filePath) {
    return new Response('Model download did not return a file', { status: 502, headers: corsHeaders });
  }

  const fileStat = await stat(filePath);
  const headers = new Headers({ ...corsHeaders, 'Content-Type': 'application/octet-stream', 'Accept-Ranges': 'bytes' });

  const range = request.headers.get('range');
  const rangeMatch = range ? /^bytes=(\d+)-(\d*)$/.exec(range) : null;
  if (rangeMatch) {
    const start = Number(rangeMatch[1]);
    const end = rangeMatch[2] ? Number(rangeMatch[2]) : fileStat.size - 1;
    headers.set('Content-Range', `bytes ${start}-${end}/${fileStat.size}`);
    headers.set('Content-Length', String(end - start + 1));
    if (request.method === 'HEAD') return new Response(null, { status: 206, headers });
    const stream = createReadStream(filePath, { start, end });
    return new Response(Readable.toWeb(stream) as ReadableStream, { status: 206, headers });
  }

  headers.set('Content-Length', String(fileStat.size));
  if (request.method === 'HEAD') return new Response(null, { status: 200, headers });
  const stream = createReadStream(filePath);
  return new Response(Readable.toWeb(stream) as ReadableStream, { status: 200, headers });
}

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
  const modelLinks = createModelLinkStore();

  let oauthServer: OAuthServer | undefined;
  let resourceMetadataUrl: string | undefined;
  if (options.publicUrl) {
    const issuerUrl = new URL(options.publicUrl);
    if (issuerUrl.protocol !== 'https:') {
      throw new Error('publicUrl must be an https:// URL for OAuth support');
    }
    const resourceUrl = new URL('/mcp', issuerUrl);
    oauthServer = createOAuthServer({ issuer: issuerUrl.origin, resourceUrl });
    resourceMetadataUrl = getOAuthProtectedResourceMetadataUrl(resourceUrl);
  }

  const guardedHandler = {
    fetch: async (request: Request): Promise<Response> => {
      const modelResponse = await handleModelRequest(request, modelLinks);
      if (modelResponse) return modelResponse;

      if (oauthServer) {
        const oauthResponse = await oauthServer.handleRequest(request);
        if (oauthResponse) return oauthResponse;
      }

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

      const key = `${daluxCredentials.baseUrl} ${daluxCredentials.apiKey}`;
      let mcpHandler = handlersByCredentials.get(key);
      if (!mcpHandler) {
        const client = createClient({ baseUrl: daluxCredentials.baseUrl, apiKey: daluxCredentials.apiKey });
        const hosting = options.publicUrl
          ? {
              publicUrl: options.publicUrl,
              daluxBaseUrl: daluxCredentials.baseUrl,
              daluxApiKey: daluxCredentials.apiKey,
              modelLinks,
            }
          : undefined;
        mcpHandler = createMcpHandler(() => buildServer(client, { hosting }));
        handlersByCredentials.set(key, mcpHandler);
      }
      // Peek before the handler consumes the body, log after it answers.
      const peek = LOG_DISCOVERY ? await peekJsonRpc(request) : undefined;
      const response = await mcpHandler.fetch(request);
      if (peek) logDiscovery(peek, request, response);
      return response;
    },
  };

  const nodeHandler = toNodeHandler(guardedHandler);
  const localhostOnly = options.localhostOnly ?? true;
  const validateHost = localhostOnly ? localhostHostValidation() : null;
  const validateOrigin = localhostOnly ? localhostOriginValidation() : null;

  const server = createNodeServer((req, res) => {
    // /models/ requests are cross-origin by design — the ifclite embed
    // viewer fetches them from https://embed.ifclite.com, never from
    // localhost — and carry their own auth (the ticket in the URL), so the
    // localhost Host/Origin checks below (meant to stop DNS-rebinding
    // against the unauthenticated-by-default MCP endpoint) don't apply.
    const isModelRoute = req.url?.startsWith(MODEL_ROUTE_PREFIX) ?? false;
    if (!isModelRoute) {
      if (validateHost && !validateHost(req, res)) return;
      if (validateOrigin && !validateOrigin(req, res)) return;
    }
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
