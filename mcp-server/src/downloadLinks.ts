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
let startPromise: Promise<number> | null = null;

function pruneExpired(): void {
  const now = Date.now();
  for (const [token, entry] of links) {
    if (entry.expiresAt < now) links.delete(token);
  }
}

async function handleRequest(pathname: string): Promise<{ status: number; filePath?: string; fileName?: string; message?: string }> {
  pruneExpired();
  const match = pathname.match(/^\/download\/([a-f0-9]{48})\/([^/]+)$/);
  if (!match) return { status: 404, message: 'Not found' };

  const [, token] = match;
  const entry = links.get(token);
  if (!entry) return { status: 404, message: 'This download link has expired or was already used.' };
  links.delete(token); // single-use

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
            'Content-Disposition': `attachment; filename="${result.fileName.replace(/[\r\n"]/g, '')}"`,
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

/**
 * Registers `filePath` under a fresh single-use token, starting the loopback
 * server on first call, and returns a clickable `http://127.0.0.1:<port>/...`
 * URL valid for DOWNLOAD_LINK_TTL_MS or one fetch, whichever comes first.
 */
export async function createDownloadLink(filePath: string, fileName?: string): Promise<string> {
  const port = await ensureServer();
  const name = fileName ?? path.basename(filePath);
  const token = randomBytes(24).toString('hex');
  links.set(token, { filePath, fileName: name, expiresAt: Date.now() + DOWNLOAD_LINK_TTL_MS });
  return `http://127.0.0.1:${port}/download/${token}/${encodeURIComponent(name)}`;
}

export function isDownloadLinkToken(token: string): boolean {
  return TOKEN_PATTERN.test(token);
}

/** Test-only: stops the loopback server and clears all outstanding links. */
export async function _resetDownloadLinksForTests(): Promise<void> {
  links.clear();
  startPromise = null;
  if (server) {
    await new Promise<void>((resolve) => server?.close(() => resolve()));
    server = null;
  }
}
