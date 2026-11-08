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
  recordAuthEvent,
  type AuthEventInput,
  type IpLogging,
  OAUTH_ACCESS_TOKEN_PREFIX,
  oauthClients,
  oauthSessions,
  oauthTokens,
  effectiveAccess,
  settings,
  type Db,
} from '@dalux-platform/db';

import type { EffectiveAccess, RequestContext } from '../access/context';
import { createFolderLookup, type FolderLookup } from '../access/folders';
import type { ToolCallRecord } from '../access/guard';
import type { Capability } from '../access/registry';
import { validateDaluxBaseUrl } from '../daluxUrl';
import { countDaluxCalls } from '../observability/callStats';
import { logJson } from '../observability/log';
import { recordAuditWriteFailure, recordAuthFailure } from '../observability/metrics';

export const API_TOKEN_PREFIX = 'dxm_';

function auditWriteFailed(what: string) {
  return (error: unknown) => {
    recordAuditWriteFailure();
    console.error(`[audit] failed to record ${what}:`, error);
  };
}

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

/** Why a credential was refused; recorded in `auth_events` and counted in the metrics. */
export type AuthFailure = 'unknown_token' | 'revoked_token' | 'expired_token' | 'account_disabled';

export type AuthResult = { caller: Caller } | { error: string; code: AuthFailure; accountId?: string };

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
  private readonly settingsRow = cache<{ headerModeEnabled: boolean; embeddingKey: string | null; logQueryText: boolean; ipLogging: IpLogging }>();
  private readonly daluxUsers = cache<string | undefined>();
  private readonly clients = new Map<string, { key: string; connection: Connection }>();

  constructor(
    readonly db: Db,
    private readonly encryptionKey: Buffer,
  ) {}

  async authenticate(token: string): Promise<AuthResult> {
    const tokenHash = hashApiToken(token);
    const load = token.startsWith(OAUTH_ACCESS_TOKEN_PREFIX) ? this.loadOAuthToken : this.loadToken;
    const result = await this.tokens(tokenHash, () => load.call(this, tokenHash));
    if ('caller' in result && result.caller.token.expiresAt && result.caller.token.expiresAt <= new Date()) {
      return { error: 'The API token has expired.', code: 'expired_token', accountId: result.caller.account.id };
    }
    return result;
  }

  private async loadToken(tokenHash: string): Promise<AuthResult> {
    const [row] = await this.db
      .select({ token: apiTokens, account: accounts })
      .from(apiTokens)
      .innerJoin(accounts, eq(accounts.id, apiTokens.accountId))
      .where(eq(apiTokens.tokenHash, tokenHash));
    if (!row) return { error: 'Unknown API token.', code: 'unknown_token' };
    const { token, account } = row;
    if (token.revokedAt) return { error: 'The API token has been revoked.', code: 'revoked_token', accountId: account.id };
    if (account.status !== 'active') {
      return { error: 'The account behind this API token is not active.', code: 'account_disabled', accountId: account.id };
    }

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

  /** OAuth access tokens act like a `dxm_` token bound to the consented connection and capabilities. */
  private async loadOAuthToken(tokenHash: string): Promise<AuthResult> {
    const [row] = await this.db
      .select({ token: oauthTokens, session: oauthSessions, account: accounts, clientName: oauthClients.name })
      .from(oauthTokens)
      .innerJoin(oauthSessions, eq(oauthSessions.id, oauthTokens.sessionId))
      .innerJoin(oauthClients, eq(oauthClients.id, oauthSessions.clientId))
      .innerJoin(accounts, eq(accounts.id, oauthSessions.accountId))
      .where(and(eq(oauthTokens.tokenHash, tokenHash), eq(oauthTokens.kind, 'access')));
    if (!row) return { error: 'Unknown access token.', code: 'unknown_token' };
    const { token, session, account } = row;
    if (token.revokedAt || session.revokedAt) return { error: 'The access token has been revoked.', code: 'revoked_token', accountId: account.id };
    if (account.status !== 'active') {
      return { error: 'The account behind this access token is not active.', code: 'account_disabled', accountId: account.id };
    }

    await this.db.update(oauthSessions).set({ lastUsedAt: new Date() }).where(eq(oauthSessions.id, session.id));
    const access = await this.accessByAccount(account.id, () => this.loadAccess(account.id));
    const allowed = session.capabilities;
    return {
      caller: {
        account: { id: account.id, role: account.role },
        token: { id: session.id, name: `OAuth: ${row.clientName ?? session.clientId}`, connectionId: session.connectionId, expiresAt: token.expiresAt },
        defaultConnectionId: account.defaultConnectionId,
        access: allowed ? access.filter((r) => allowed.includes(r.capability)) : access,
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

  async connectionById(id: string): Promise<Connection | undefined> {
    const [row] = await this.db.select().from(connections).where(eq(connections.id, id));
    return row ? this.connection(row) : undefined;
  }

  /** The account's effective access right now, not the copy cached for requests. */
  currentAccess(accountId: string): Promise<EffectiveAccess[]> {
    return this.loadAccess(accountId);
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
    if ('error' in validated) throw new Error(`base URL ${validated.error}`);
    let apiKey: string;
    try {
      apiKey = decryptSecret(row.apiKeyEncrypted, this.encryptionKey);
    } catch {
      throw new Error('its API key cannot be decrypted with PLATFORM_ENCRYPTION_KEY');
    }
    const client = countDaluxCalls(createClient({ baseUrl: validated.baseUrl, apiKey }));
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

  private settingsValues() {
    return this.settingsRow('settings', async () => {
      const [found] = await this.db
        .select({
          headerModeEnabled: settings.headerModeEnabled,
          embeddingKey: settings.embeddingKeyEncrypted,
          logQueryText: settings.logQueryText,
          ipLogging: settings.ipLogging,
        })
        .from(settings);
      return {
        logQueryText: found?.logQueryText ?? false,
        ipLogging: (found?.ipLogging as IpLogging | undefined) ?? 'full',
        headerModeEnabled: found?.headerModeEnabled ?? false,
        embeddingKey: found?.embeddingKey ? decryptSecret(found.embeddingKey, this.encryptionKey) : null,
      };
    });
  }

  async headerModeEnabled(): Promise<boolean> {
    return (await this.settingsValues()).headerModeEnabled;
  }

  /** The admin's embedding key; setting it is the consent to send text to the provider (PRD). */
  async embeddingKey(): Promise<string | null> {
    return (await this.settingsValues()).embeddingKey;
  }

  /** The logging settings every request applies (cached for a minute like the other settings). */
  async loggingSettings(): Promise<{ ipLogging: IpLogging; logQueryText: boolean }> {
    const { ipLogging, logQueryText } = await this.settingsValues();
    return { ipLogging, logQueryText };
  }

  /** Records a failed or unauthenticated attempt. Never throws and never waits for the caller. */
  authEvent(event: AuthEventInput): void {
    recordAuthFailure(event.reason);
    this.loggingSettings()
      .then(({ ipLogging }) => recordAuthEvent(this.db, event, ipLogging))
      .catch(auditWriteFailed('auth event'));
    logJson({ request_id: event.requestId, event: 'auth_failure', source: event.source, reason: event.reason, account_id: event.accountId, connection: event.connectionSlug }, 'warn');
  }

  /**
   * Writes one audit row per tool call. The caller never waits for it and never sees its failure: a
   * failed insert goes to stderr and the `dalux_mcp_audit_write_failures_total` metric.
   */
  audit(caller: Caller, context: RequestContext, record: ToolCallRecord): void {
    const connectionId = context.connection!.id;
    const request = context.request;
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
          requestId: request?.requestId,
          clientIp: request?.ip,
          forwardedFor: request?.forwardedFor,
          userAgent: request?.userAgent,
          authMethod: request?.authMethod,
          credentialId: request?.credentialId ?? caller.token.id,
          mcpSessionId: request?.mcpSessionId,
          fileAreaId: record.fileAreaId,
          folderId: record.folderId,
          fileIds: record.fileIds,
          fileCount: record.fileCount,
          resultItems: record.resultItems,
          resultBytes: record.resultBytes,
          resultTruncated: record.resultTruncated,
          denialReason: record.denialReason,
          errorCode: record.errorCode,
          daluxCalls: record.daluxCalls,
          daluxErrors: record.daluxErrors,
          daluxRateLimited: record.daluxRateLimited,
          mistralTokens: record.mistralTokens || null,
          agentId: request?.agent?.id,
          agentName: request?.agent?.name,
          queryText: record.queryText,
        }),
      )
      .catch(auditWriteFailed('tool call'));
  }
}
