import { existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { createClient } from 'dalux-build-api';
import { cacheDirFor } from './pdfSearch';

/**
 * Short-lived tickets that let the ifclite embed viewer — running inside the
 * `ui://` iframe's *nested* iframe, on a foreign origin (embed.ifclite.com)
 * — fetch a Dalux file's bytes from `GET /models/:token` (see http.ts)
 * without the Dalux API key ever reaching the browser. Mirrors the
 * in-memory, restart-clears design of oauth.ts's token stores: no
 * persistent state anywhere else in this server either.
 */

const TICKET_TTL_MS = 15 * 60_000;

export interface ModelTicketRecord {
  daluxBaseUrl: string;
  daluxApiKey: string;
  projectId: string;
  fileAreaId: string;
  fileId: string;
  expiresAt: number;
}

export interface ModelLinkStore {
  /** Issues a new opaque token bound to the given Dalux file + credentials. */
  issue: (record: Omit<ModelTicketRecord, 'expiresAt'>) => string;
  /**
   * Resolves a token to its ticket, or `undefined` if unknown/expired.
   * Deliberately not single-use — the embed viewer may issue several
   * `Range` requests against the same model URL.
   */
  consume: (token: string) => ModelTicketRecord | undefined;
}

function randomToken(): string {
  return randomBytes(24).toString('base64url');
}

/**
 * Creates a fresh ticket store. Callers get their own instance (see
 * `buildHttpApp` in http.ts) rather than sharing module-level state, so
 * tests and multiple concurrent deployments in one process don't leak
 * tickets between each other.
 */
export function createModelLinkStore(): ModelLinkStore {
  const tickets = new Map<string, ModelTicketRecord>();

  function sweepExpired(): void {
    const now = Date.now();
    for (const [token, record] of tickets) {
      if (record.expiresAt < now) tickets.delete(token);
    }
  }

  return {
    issue(record) {
      sweepExpired();
      const token = randomToken();
      tickets.set(token, { ...record, expiresAt: Date.now() + TICKET_TTL_MS });
      return token;
    },
    consume(token) {
      sweepExpired();
      return tickets.get(token);
    },
  };
}

/**
 * Resolves a ticket to a local file path, downloading (and caching) the
 * Dalux file if it isn't already on disk. Shares the same per-fileId cache
 * directory as `download_file` / `search_pdf_content` (`pdfSearch.ts`'s
 * `cacheDirFor`), so a model already pulled by one of those tools is reused
 * here too — and a model fetched here doesn't re-download on a second
 * `Range` request for the same ticket.
 */
export async function resolveModelFile(ticket: ModelTicketRecord): Promise<string | undefined> {
  const dir = cacheDirFor(ticket.fileId);
  const cachedName = existsSync(dir) ? readdirSync(dir).find((name) => !name.startsWith('.')) : undefined;
  if (cachedName) return path.join(dir, cachedName);

  const client = createClient({ baseUrl: ticket.daluxBaseUrl, apiKey: ticket.daluxApiKey });
  const result = await client.files.getFile(ticket.projectId, ticket.fileAreaId, ticket.fileId, {
    download: true,
    savePath: dir,
  });
  if (typeof result === 'string' || !result) return undefined;
  return (result as Record<string, unknown>).downloadedFilePath as string | undefined;
}
