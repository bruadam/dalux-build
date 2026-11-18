/**
 * Serving an already-downloaded file over a short-lived, token-authorized
 * local HTTP link, so the chat can hand back something the user can
 * actually click and download in a browser — a real complement to (not a
 * replacement for) the inline image/text content in tools/documents.ts,
 * since a link works for any file format and any size, at the cost of only
 * being reachable from the same machine this server runs on.
 *
 * Loopback-only (127.0.0.1) by design, regardless of how the main MCP
 * transport is configured — this is a separate, internal HTTP listener, not
 * the streamable-HTTP transport in http.ts. That covers the common stdio
 * deployment (Claude Desktop/Claude Code spawning this process on the same
 * machine the browser runs on); it does NOT cover a genuinely remote
 * HTTP-transport deployment, where a link to 127.0.0.1 of the server's own
 * host is unreachable from the caller's machine — that case still needs the
 * inline image/text path.
 *
 * Public mode: when the HTTP transport runs with PUBLIC_URL (see
 * `configurePublicDownloadBase`, called from http.ts's buildHttpApp), links
 * are instead served by the main HTTP app at
 * `<PUBLIC_URL>/download/<token>/<name>` via `handleDownloadRequest`, so a
 * remote Claude.ai/ChatGPT connector user gets a real, clickable https://
 * link. The token is only ever minted from inside an authenticated MCP
 * tool call (OAuth login or X-Dalux-* headers), and is the link's sole
 * credential: a browser click can't carry an Authorization header.
 *
 * "Authorized and identified": each link is a single-use, time-limited,
 * cryptographically random token mapped to exactly one file — not a
 * guessable path, not reusable once fetched or once DOWNLOAD_LINK_TTL_MS
 * has passed.
 */

import { randomBytes } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import path from 'node:path';
import { Readable } from 'node:stream';
import { mimeTypeFor } from './inlineResource';

const DOWNLOAD_LINK_TTL_MS = 15 * 60 * 1000;
const TOKEN_PATTERN = /^[a-f0-9]{48}$/;

interface LinkEntry {
  filePath: string;
  fileName: string;
  expiresAt: number;
}

const links = new Map<string, LinkEntry>();

let server: Server | null = null;
let publicBase: string | null = null;

export const DOWNLOAD_ROUTE_PREFIX = '/download/';

/**
 * Switches createDownloadLink to emit `<publicUrl>/download/...` links
 * (served by handleDownloadRequest on the main HTTP app) instead of
 * loopback ones. Pass undefined to go back to loopback mode.
 */
export function configurePublicDownloadBase(publicUrl: string | undefined): void {
  publicBase = publicUrl ? new URL(publicUrl).origin : null;
}
let startPromise: Promise<number> | null = null;

function pruneExpired(): void {
  const now = Date.now();
  for (const [token, entry] of links) {
    if (entry.expiresAt < now) links.delete(token);
  }
}

async function handleRequest(pathname: string, consume = true): Promise<{ status: number; filePath?: string; fileName?: string; message?: string }> {
  pruneExpired();
  const match = pathname.match(/^\/download\/([a-f0-9]{48})\/([^/]+)$/);
  if (!match) return { status: 404, message: 'Not found' };

  const [, token] = match;
  const entry = links.get(token);
  if (!entry) return { status: 404, message: 'This download link has expired or was already used.' };
  if (consume) links.delete(token); // single-use (HEAD probes don't consume)

  try {
    await stat(entry.filePath);
  } catch {
    return { status: 404, message: 'File no longer available.' };
  }
  return { status: 200, filePath: entry.filePath, fileName: entry.fileName };
}

async function ensureServer(): Promise<number> {
  const existing = server?.address();
  if (existing && typeof existing === 'object') return existing.port;
  if (startPromise) return startPromise;

  startPromise = new Promise((resolve, reject) => {
    const s = createServer((req, res) => {
      const url = new URL(req.url ?? '/', 'http://127.0.0.1');
      handleRequest(url.pathname)
        .then((result) => {
          if (result.status !== 200 || !result.filePath || !result.fileName) {
            res.writeHead(result.status, { 'Content-Type': 'text/plain' }).end(result.message ?? 'Not found');
            return;
          }
          res.writeHead(200, {
            'Content-Type': mimeTypeFor(result.fileName),
            'Content-Disposition': contentDisposition(result.fileName),
            'Cache-Control': 'no-store',
          });
          createReadStream(result.filePath).pipe(res);
        })
        .catch((err) => {
          res.writeHead(500, { 'Content-Type': 'text/plain' }).end(err instanceof Error ? err.message : String(err));
        });
    });
    s.once('error', reject);
    s.listen(0, '127.0.0.1', () => {
      const address = s.address();
      if (!address || typeof address !== 'object') {
        reject(new Error('Failed to start local download-link server'));
        return;
      }
      server = s;
      server.unref();
      resolve(address.port);
    });
  });

  return startPromise;
}

function contentDisposition(fileName: string): string {
  const ascii = fileName.replace(/[\r\n"]/g, '').replace(/[^\x20-\x7e]/g, '_');
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(fileName)}`;
}

/**
 * Web-standard handler for the public-mode `/download/<token>/<name>` route
 * on the main HTTP app. Returns undefined for any other path so the caller
 * can fall through to the MCP endpoint. Authenticates by the token alone.
 */
export async function handleDownloadRequest(request: Request): Promise<Response | undefined> {
  const url = new URL(request.url);
  if (!url.pathname.startsWith(DOWNLOAD_ROUTE_PREFIX)) return undefined;
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return new Response('Method not allowed', { status: 405, headers: { Allow: 'GET, HEAD' } });
  }

  const result = await handleRequest(url.pathname, request.method === 'GET');
  if (result.status !== 200 || !result.filePath || !result.fileName) {
    return new Response(result.message ?? 'Not found', { status: result.status, headers: { 'Content-Type': 'text/plain' } });
  }

  const fileStat = await stat(result.filePath);
  const headers = {
    'Content-Type': mimeTypeFor(result.fileName),
    'Content-Disposition': contentDisposition(result.fileName),
    'Content-Length': String(fileStat.size),
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  };
  if (request.method === 'HEAD') return new Response(null, { status: 200, headers });
  const stream = createReadStream(result.filePath);
  return new Response(Readable.toWeb(stream) as ReadableStream, { status: 200, headers });
}

/**
 * Registers `filePath` under a fresh single-use token, starting the loopback
 * server on first call, and returns a clickable `http://127.0.0.1:<port>/...`
 * URL valid for DOWNLOAD_LINK_TTL_MS or one fetch, whichever comes first.
 */
export async function createDownloadLink(filePath: string, fileName?: string): Promise<string> {
  const name = fileName ?? path.basename(filePath);
  const token = randomBytes(24).toString('hex');
  const suffix = `/download/${token}/${encodeURIComponent(name)}`;
  if (publicBase) {
    links.set(token, { filePath, fileName: name, expiresAt: Date.now() + DOWNLOAD_LINK_TTL_MS });
    return `${publicBase}${suffix}`;
  }
  const port = await ensureServer();
  links.set(token, { filePath, fileName: name, expiresAt: Date.now() + DOWNLOAD_LINK_TTL_MS });
  return `http://127.0.0.1:${port}${suffix}`;
}

export function isDownloadLinkToken(token: string): boolean {
  return TOKEN_PATTERN.test(token);
}

/** Test-only: stops the loopback server and clears all outstanding links. */
export async function _resetDownloadLinksForTests(): Promise<void> {
  links.clear();
  publicBase = null;
  startPromise = null;
  if (server) {
    await new Promise<void>((resolve) => server?.close(() => resolve()));
    server = null;
  }
}
