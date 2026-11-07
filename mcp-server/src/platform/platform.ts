import { createHash } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { createClient, type DaluxClient } from 'dalux-build-api';
import {
  accounts,
  apiTokens,
  auditLog,
  connections,
  daluxUserLinks,
  decryptSecret,
  effectiveAccess,
  settings,
  type Db,
} from '@dalux-platform/db';

import type { EffectiveAccess, RequestContext } from '../access/context';
import { createFolderLookup, type FolderLookup } from '../access/folders';
import type { ToolCallRecord } from '../access/guard';
import type { Capability } from '../access/registry';
import { validateDaluxBaseUrl } from '../daluxUrl';

export const API_TOKEN_PREFIX = 'dxm_';

/** Grant, token, and connection changes reach the MCP server within this time (PRD 7.2, 7.4). */
const CACHE_MS = 60_000;

/** API tokens are stored as the hex SHA-256 of the whole token string. */
export function hashApiToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export interface Connection {
  id: string;
  slug: string;
  baseUrl: string;
  apiKey: string;
  client: DaluxClient;
  folders: FolderLookup;
}

export interface Caller {
  account: { id: string; role: 'admin' | 'user' };
  token: { id: string; name: string; connectionId: string | null; expiresAt: Date | null };
  defaultConnectionId: string | null;
  /** Effective access on every connection, narrowed to the token's capabilities. */
  access: EffectiveAccess[];
}

export type AuthResult = { caller: Caller } | { error: string };

function cache<T>() {
  const entries = new Map<string, { value: Promise<T>; at: number }>();
  return (key: string, load: () => Promise<T>): Promise<T> => {
    const hit = entries.get(key);
    if (hit && Date.now() - hit.at < CACHE_MS) return hit.value;
    const value = load();
    value.catch(() => entries.delete(key));
    entries.set(key, { value, at: Date.now() });
    return value;
  };
}

/** Database-backed identity, access, connections, and audit for platform mode. Connects as the `mcp` role. */
export class Platform {
  private readonly tokens = cache<AuthResult>();
  private readonly accessByAccount = cache<EffectiveAccess[]>();
  private readonly connectionsBySlug = cache<Connection | undefined>();
  private readonly connectionList = cache<{ id: string; slug: string }[]>();
  private readonly settingsRow = cache<{ headerModeEnabled: boolean }>();
  private readonly daluxUsers = cache<string | undefined>();
  private readonly clients = new Map<string, { key: string; connection: Connection }>();

  constructor(
    private readonly db: Db,
    private readonly encryptionKey: Buffer,
  ) {}

  async authenticate(token: string): Promise<AuthResult> {
    const result = await this.tokens(hashApiToken(token), () => this.loadToken(hashApiToken(token)));
    if ('caller' in result && result.caller.token.expiresAt && result.caller.token.expiresAt <= new Date()) {
      return { error: 'The API token has expired.' };
    }
    return result;
  }

  private async loadToken(tokenHash: string): Promise<AuthResult> {
    const [row] = await this.db
      .select({ token: apiTokens, account: accounts })
      .from(apiTokens)
      .innerJoin(accounts, eq(accounts.id, apiTokens.accountId))
      .where(eq(apiTokens.tokenHash, tokenHash));
    if (!row) return { error: 'Unknown API token.' };
    const { token, account } = row;
    if (token.revokedAt) return { error: 'The API token has been revoked.' };
    if (account.status !== 'active') return { error: 'The account behind this API token is not active.' };

    await this.db.update(apiTokens).set({ lastUsedAt: new Date() }).where(eq(apiTokens.id, token.id));
    const access = await this.accessByAccount(account.id, () => this.loadAccess(account.id));
    const allowed = token.capabilities;
    return {
      caller: {
        account: { id: account.id, role: account.role },
        token: { id: token.id, name: token.name, connectionId: token.connectionId, expiresAt: token.expiresAt },
        defaultConnectionId: account.defaultConnectionId,
        access: allowed ? access.filter((row) => allowed.includes(row.capability)) : access,
      },
    };
  }

  private async loadAccess(accountId: string): Promise<EffectiveAccess[]> {
    const rows = await this.db
      .select({
        connectionId: effectiveAccess.connectionId,
        capability: effectiveAccess.capability,
        projectId: effectiveAccess.projectId,
        fileAreaId: effectiveAccess.fileAreaId,
        folderId: effectiveAccess.folderId,
      })
      .from(effectiveAccess)
      .where(eq(effectiveAccess.accountId, accountId));
    return rows.map((row) => ({ ...row, capability: row.capability as Capability }));
  }

  connectionBySlug(slug: string): Promise<Connection | undefined> {
    return this.connectionsBySlug(slug, async () => {
      const [row] = await this.db.select().from(connections).where(eq(connections.slug, slug));
      return row ? this.connection(row) : undefined;
    });
  }

  /** All connections as id and slug, for picking a default and for error messages. */
  listConnections(): Promise<{ id: string; slug: string }[]> {
    return this.connectionList('all', () =>
      this.db.select({ id: connections.id, slug: connections.slug }).from(connections).orderBy(connections.slug),
    );
  }

  /** The client is rebuilt when the connection row changes (e.g. a rotated API key). */
  private connection(row: typeof connections.$inferSelect): Connection {
    const key = row.updatedAt.toISOString();
    const cached = this.clients.get(row.id);
    if (cached?.key === key) return cached.connection;

    const validated = validateDaluxBaseUrl(row.baseUrl);
    if ('error' in validated) throw new Error(`Connection ${row.slug}: base URL ${validated.error}`);
    const apiKey = decryptSecret(row.apiKeyEncrypted, this.encryptionKey);
    const client = createClient({ baseUrl: validated.baseUrl, apiKey });
    const connection = {
      id: row.id,
      slug: row.slug,
      baseUrl: validated.baseUrl,
      apiKey,
      client,
      folders: createFolderLookup(client),
    };
    this.clients.set(row.id, { key, connection });
    return connection;
  }

  async headerModeEnabled(): Promise<boolean> {
    const row = await this.settingsRow('settings', async () => {
      const [found] = await this.db.select({ headerModeEnabled: settings.headerModeEnabled }).from(settings);
      return found ?? { headerModeEnabled: false };
    });
    return row.headerModeEnabled;
  }

  /** Writes one audit row per tool call; failures are logged, never shown to the caller. */
  audit(caller: Caller, context: RequestContext, record: ToolCallRecord): void {
    const connectionId = context.connection!.id;
    this.daluxUsers(`${caller.account.id}/${connectionId}`, async () => {
      const [link] = await this.db
        .select({ daluxUserId: daluxUserLinks.daluxUserId })
        .from(daluxUserLinks)
        .where(and(eq(daluxUserLinks.accountId, caller.account.id), eq(daluxUserLinks.connectionId, connectionId)));
      return link?.daluxUserId;
    })
      .then((daluxUserId) =>
        this.db.insert(auditLog).values({
          kind: 'tool',
          accountId: caller.account.id,
          action: record.tool,
          daluxUserId,
          client: caller.token.name,
          connectionId,
          projectId: record.projectId,
          capability: record.capability === 'none' ? null : record.capability,
          status: record.status,
          durationMs: record.durationMs,
        }),
      )
      .catch((error: unknown) => console.error('[audit] failed to record tool call:', error));
  }
}
