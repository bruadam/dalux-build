import { sql, type SQL } from 'drizzle-orm';
import {
  type AnyPgColumn,
  bigint,
  boolean,
  check,
  customType,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  vector,
} from 'drizzle-orm/pg-core';

export const EMBEDDING_DIMENSIONS = 1024;

const tsvector = customType<{ data: string }>({
  dataType: () => 'tsvector',
});

const bytea = customType<{ data: Buffer }>({
  dataType: () => 'bytea',
});

const id = () => uuid('id').primaryKey().defaultRandom();
const createdAt = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow();
const updatedAt = () => timestamp('updated_at', { withTimezone: true }).notNull().defaultNow();

export const accountType = pgEnum('account_type', ['personal', 'robot']);
export const accountRole = pgEnum('account_role', ['admin', 'user']);
export const accountStatus = pgEnum('account_status', ['invited', 'active', 'disabled']);
export const daluxUserLinkSource = pgEnum('dalux_user_link_source', ['auto', 'manual']);
export const indexKind = pgEnum('index_kind', ['file', 'task', 'docs']);
export const oauthTokenKind = pgEnum('oauth_token_kind', ['access', 'refresh']);
export const auditKind = pgEnum('audit_kind', ['admin', 'tool']);
export const indexRunStatus = pgEnum('index_run_status', ['running', 'ok', 'partial', 'failed']);

export const connections = pgTable('connections', {
  id: id(),
  name: text('name').notNull(),
  slug: text('slug').notNull().unique(),
  baseUrl: text('base_url').notNull(),
  apiKeyEncrypted: text('api_key_encrypted').notNull(),
  apiKeyLast4: text('api_key_last4').notNull(),
  /** "Match now" in the interface; the worker matches Dalux users when this is newer than the last match. */
  daluxUsersRequestedAt: timestamp('dalux_users_requested_at', { withTimezone: true }),
  daluxUsersSyncedAt: timestamp('dalux_users_synced_at', { withTimezone: true }),
  daluxUsersSyncError: text('dalux_users_sync_error'),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const accounts = pgTable(
  'accounts',
  {
    id: id(),
    type: accountType('type').notNull(),
    email: text('email'),
    name: text('name').notNull(),
    description: text('description'),
    ownerAccountId: uuid('owner_account_id').references((): AnyPgColumn => accounts.id, { onDelete: 'restrict' }),
    role: accountRole('role').notNull().default('user'),
    status: accountStatus('status').notNull().default('active'),
    defaultConnectionId: uuid('default_connection_id').references(() => connections.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('accounts_email_key').on(sql`lower(${t.email})`),
    check(
      'accounts_type_fields',
      sql`(${t.type} = 'personal' and ${t.email} is not null and ${t.ownerAccountId} is null)
        or (${t.type} = 'robot' and ${t.ownerAccountId} is not null)`,
    ),
  ],
);

export const groups = pgTable('groups', {
  id: id(),
  name: text('name').notNull().unique(),
  description: text('description'),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const groupMemberships = pgTable(
  'group_memberships',
  {
    groupId: uuid('group_id')
      .notNull()
      .references(() => groups.id, { onDelete: 'cascade' }),
    accountId: uuid('account_id')
      .notNull()
      .references(() => accounts.id, { onDelete: 'cascade' }),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.groupId, t.accountId] }), index('group_memberships_account_idx').on(t.accountId)],
);

/**
 * Principal is exactly one of account or group. Scope narrows from connection
 * to project, file area, and folder; a NULL column means the whole level.
 * File area and folder scopes only carry `files:*` capabilities (PRD 5.4).
 */
export const grants = pgTable(
  'grants',
  {
    id: id(),
    accountId: uuid('account_id').references(() => accounts.id, { onDelete: 'cascade' }),
    groupId: uuid('group_id').references(() => groups.id, { onDelete: 'cascade' }),
    connectionId: uuid('connection_id')
      .notNull()
      .references(() => connections.id, { onDelete: 'cascade' }),
    projectId: text('project_id'),
    fileAreaId: text('file_area_id'),
    folderId: text('folder_id'),
    capabilities: text('capabilities').array().notNull(),
    createdByAccountId: uuid('created_by_account_id').references(() => accounts.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
  },
  (t) => [
    check('grants_one_principal', sql`num_nonnulls(${t.accountId}, ${t.groupId}) = 1`),
    check(
      'grants_scope_chain',
      sql`(${t.fileAreaId} is null or ${t.projectId} is not null) and (${t.folderId} is null or ${t.fileAreaId} is not null)`,
    ),
    check('grants_capabilities_present', sql`cardinality(${t.capabilities}) > 0`),
    check(
      'grants_file_scope_capabilities',
      sql`${t.fileAreaId} is null or array_to_string(${t.capabilities}, ',') ~ '^files:[a-z_]+(,files:[a-z_]+)*$'`,
    ),
    index('grants_account_idx').on(t.accountId),
    index('grants_group_idx').on(t.groupId),
  ],
);

/** Precomputed by `refresh_effective_access()`; read by RLS policies. */
export const effectiveAccess = pgTable(
  'effective_access',
  {
    accountId: uuid('account_id')
      .notNull()
      .references(() => accounts.id, { onDelete: 'cascade' }),
    grantId: uuid('grant_id')
      .notNull()
      .references(() => grants.id, { onDelete: 'cascade' }),
    connectionId: uuid('connection_id')
      .notNull()
      .references(() => connections.id, { onDelete: 'cascade' }),
    projectId: text('project_id'),
    fileAreaId: text('file_area_id'),
    folderId: text('folder_id'),
    capability: text('capability').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.grantId, t.accountId, t.capability] }),
    index('effective_access_lookup_idx').on(t.accountId, t.connectionId, t.capability),
  ],
);

export const daluxUserLinks = pgTable(
  'dalux_user_links',
  {
    accountId: uuid('account_id')
      .notNull()
      .references(() => accounts.id, { onDelete: 'cascade' }),
    connectionId: uuid('connection_id')
      .notNull()
      .references(() => connections.id, { onDelete: 'cascade' }),
    daluxUserId: text('dalux_user_id').notNull(),
    source: daluxUserLinkSource('source').notNull(),
    updatedAt: updatedAt(),
  },
  (t) => [primaryKey({ columns: [t.accountId, t.connectionId] })],
);

/** The connection's Dalux users (all projects, deduplicated), copied by the worker for matching and manual linking. */
export const daluxUsers = pgTable(
  'dalux_users',
  {
    connectionId: uuid('connection_id')
      .notNull()
      .references(() => connections.id, { onDelete: 'cascade' }),
    daluxUserId: text('dalux_user_id').notNull(),
    email: text('email'),
    name: text('name'),
    updatedAt: updatedAt(),
  },
  (t) => [primaryKey({ columns: [t.connectionId, t.daluxUserId] })],
);

/** `capabilities` NULL = all of the account's capabilities. */
export const apiTokens = pgTable(
  'api_tokens',
  {
    id: id(),
    accountId: uuid('account_id')
      .notNull()
      .references(() => accounts.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    tokenHash: text('token_hash').notNull().unique(),
    prefix: text('prefix').notNull(),
    connectionId: uuid('connection_id').references(() => connections.id, { onDelete: 'cascade' }),
    capabilities: text('capabilities').array(),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [index('api_tokens_account_idx').on(t.accountId)],
);

export const oauthClients = pgTable('oauth_clients', {
  id: text('id').primaryKey(),
  name: text('name'),
  redirectUris: text('redirect_uris').array().notNull(),
  metadata: jsonb('metadata').notNull().default({}),
  createdAt: createdAt(),
});

export const oauthCodes = pgTable('oauth_codes', {
  codeHash: text('code_hash').primaryKey(),
  clientId: text('client_id')
    .notNull()
    .references(() => oauthClients.id, { onDelete: 'cascade' }),
  accountId: uuid('account_id')
    .notNull()
    .references(() => accounts.id, { onDelete: 'cascade' }),
  connectionId: uuid('connection_id')
    .notNull()
    .references(() => connections.id, { onDelete: 'cascade' }),
  redirectUri: text('redirect_uri').notNull(),
  codeChallenge: text('code_challenge').notNull(),
  /** Null means the account's full access; otherwise the subset chosen at consent. */
  capabilities: text('capabilities').array(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  usedAt: timestamp('used_at', { withTimezone: true }),
  createdAt: createdAt(),
});

/** One approved client authorization; its tokens rotate underneath it. */
export const oauthSessions = pgTable(
  'oauth_sessions',
  {
    id: id(),
    clientId: text('client_id')
      .notNull()
      .references(() => oauthClients.id, { onDelete: 'cascade' }),
    accountId: uuid('account_id')
      .notNull()
      .references(() => accounts.id, { onDelete: 'cascade' }),
    connectionId: uuid('connection_id')
      .notNull()
      .references(() => connections.id, { onDelete: 'cascade' }),
    /** Null means the account's full access; otherwise the subset chosen at consent. */
    capabilities: text('capabilities').array(),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [index('oauth_sessions_account_idx').on(t.accountId)],
);

export const oauthTokens = pgTable(
  'oauth_tokens',
  {
    tokenHash: text('token_hash').primaryKey(),
    sessionId: uuid('session_id')
      .notNull()
      .references(() => oauthSessions.id, { onDelete: 'cascade' }),
    kind: oauthTokenKind('kind').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [index('oauth_tokens_session_idx').on(t.sessionId)],
);

/** Single row (id = true). */
export const settings = pgTable(
  'settings',
  {
    id: boolean('id').primaryKey().default(true),
    embeddingKeyEncrypted: text('embedding_key_encrypted'),
    headerModeEnabled: boolean('header_mode_enabled').notNull().default(false),
    /** The worker deletes audit rows older than this (PRD 6.4). */
    auditRetentionDays: integer('audit_retention_days').notNull().default(180),
    /** Record search and filter text in the audit log. Off by default: queries can name people and projects. */
    logQueryText: boolean('log_query_text').notNull().default(false),
    /** How client IPs are logged: `full`, `truncated` (IPv4 /24, IPv6 /48) or `off`. */
    ipLogging: text('ip_logging').notNull().default('full'),
    /** The worker clears the IP columns of audit rows and auth events older than this. */
    ipRetentionDays: integer('ip_retention_days').notNull().default(90),
    updatedAt: updatedAt(),
  },
  (t) => [
    check('settings_single_row', sql`${t.id}`),
    check('settings_audit_retention', sql`${t.auditRetentionDays} >= 1`),
    check('settings_ip_logging', sql`${t.ipLogging} in ('full', 'truncated', 'off')`),
    check('settings_ip_retention', sql`${t.ipRetentionDays} >= 1`),
  ],
);

/** Holds no arguments, results, or document content (PRD 6.4). */
export const auditLog = pgTable(
  'audit_log',
  {
    id: bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
    at: timestamp('at', { withTimezone: true }).notNull().defaultNow(),
    kind: auditKind('kind').notNull(),
    accountId: uuid('account_id').references(() => accounts.id, { onDelete: 'set null' }),
    action: text('action').notNull(),
    targetType: text('target_type'),
    targetId: text('target_id'),
    daluxUserId: text('dalux_user_id'),
    client: text('client'),
    connectionId: uuid('connection_id').references(() => connections.id, { onDelete: 'set null' }),
    projectId: text('project_id'),
    capability: text('capability'),
    status: text('status'),
    durationMs: integer('duration_ms'),
    requestId: text('request_id'),
    /** The client address as `ip_logging` allows; cleared by the IP retention job. */
    clientIp: text('client_ip'),
    /** The raw X-Forwarded-For chain (only with ip_logging `full`); cleared with `client_ip`. */
    forwardedFor: text('forwarded_for'),
    userAgent: text('user_agent'),
    /** `dxm` (API token), `dxo` (OAuth), `header` (Dalux headers) or `agent` (hosted agent). */
    authMethod: text('auth_method'),
    /** The API token id or OAuth session id; never the secret. */
    credentialId: text('credential_id'),
    mcpSessionId: text('mcp_session_id'),
    fileAreaId: text('file_area_id'),
    folderId: text('folder_id'),
    /** At most 20 ids; `file_count` has the real number. */
    fileIds: text('file_ids').array(),
    fileCount: integer('file_count'),
    resultItems: integer('result_items'),
    resultBytes: integer('result_bytes'),
    resultTruncated: boolean('result_truncated'),
    /** `missing_capability`, `no_folder_access`, `admin_only` or `no_access_rule`. */
    denialReason: text('denial_reason'),
    /** `not_found`, `rate_limited`, `dalux_auth`, `dalux_error` or `tool_error`. */
    errorCode: text('error_code'),
    daluxCalls: integer('dalux_calls'),
    daluxErrors: integer('dalux_errors'),
    daluxRateLimited: integer('dalux_rate_limited'),
    mistralTokens: integer('mistral_tokens'),
    agentId: uuid('agent_id'),
    agentName: text('agent_name'),
    /** Search text; recorded only while `settings.log_query_text` is on. */
    queryText: text('query_text'),
  },
  (t) => [
    index('audit_log_at_idx').on(t.at),
    index('audit_log_account_idx').on(t.accountId, t.at),
    index('audit_log_request_idx').on(t.requestId),
  ],
);

/**
 * Failed and unauthenticated attempts (invalid, expired or revoked token, wrong connection, disabled
 * account, rate limit, OAuth and sign-in errors). Holds the display prefix of a token, never the token.
 */
export const authEvents = pgTable(
  'auth_events',
  {
    id: bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
    at: timestamp('at', { withTimezone: true }).notNull().defaultNow(),
    /** `mcp`, `oauth` or `login`. */
    source: text('source').notNull(),
    reason: text('reason').notNull(),
    accountId: uuid('account_id').references(() => accounts.id, { onDelete: 'set null' }),
    tokenPrefix: text('token_prefix'),
    connectionSlug: text('connection_slug'),
    requestId: text('request_id'),
    clientIp: text('client_ip'),
    forwardedFor: text('forwarded_for'),
    userAgent: text('user_agent'),
  },
  (t) => [index('auth_events_at_idx').on(t.at), index('auth_events_reason_idx').on(t.reason, t.at)],
);

/**
 * Better Auth tables (interface login), mapped by `modelName` in the web app.
 * Each auth user is linked 1:1 to a personal row in `accounts`.
 */
export const authUsers = pgTable('auth_users', {
  id: text('id').primaryKey(),
  platformAccountId: uuid('platform_account_id')
    .notNull()
    .unique()
    .references(() => accounts.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  email: text('email').notNull().unique(),
  emailVerified: boolean('email_verified').notNull().default(false),
  image: text('image'),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const authSessions = pgTable(
  'auth_sessions',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => authUsers.id, { onDelete: 'cascade' }),
    token: text('token').notNull().unique(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    ipAddress: text('ip_address'),
    userAgent: text('user_agent'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('auth_sessions_user_idx').on(t.userId)],
);

/** Better Auth's credential rows; `accountId` is the provider's account id, not `accounts.id`. */
export const authAccounts = pgTable(
  'auth_accounts',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => authUsers.id, { onDelete: 'cascade' }),
    accountId: text('provider_account_id').notNull(),
    providerId: text('provider_id').notNull(),
    accessToken: text('access_token'),
    refreshToken: text('refresh_token'),
    idToken: text('id_token'),
    accessTokenExpiresAt: timestamp('access_token_expires_at', { withTimezone: true }),
    refreshTokenExpiresAt: timestamp('refresh_token_expires_at', { withTimezone: true }),
    scope: text('scope'),
    password: text('password'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('auth_accounts_user_idx').on(t.userId)],
);

export const authVerifications = pgTable(
  'auth_verifications',
  {
    id: text('id').primaryKey(),
    identifier: text('identifier').notNull(),
    value: text('value').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('auth_verifications_identifier_idx').on(t.identifier)],
);

/** Invite links for personal accounts; only the sha256 hash of the link token is stored. */
export const accountInvites = pgTable(
  'account_invites',
  {
    id: id(),
    accountId: uuid('account_id')
      .notNull()
      .references(() => accounts.id, { onDelete: 'cascade' }),
    tokenHash: text('token_hash').notNull().unique(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    usedAt: timestamp('used_at', { withTimezone: true }),
    createdByAccountId: uuid('created_by_account_id').references(() => accounts.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
  },
  (t) => [index('account_invites_account_idx').on(t.accountId)],
);

/**
 * Index data. `project_id`/`file_area_id` on an index describe its scope for
 * RLS (both NULL for docs, which every active account can read). Documents and chunks copy the access columns so
 * policies need no joins. `folder_ancestor_ids` runs from the file area's
 * top folder down to and including the document's own folder.
 */
export const indexes = pgTable(
  'indexes',
  {
    id: id(),
    connectionId: uuid('connection_id')
      .notNull()
      .references(() => connections.id, { onDelete: 'cascade' }),
    kind: indexKind('kind').notNull(),
    projectId: text('project_id'),
    fileAreaId: text('file_area_id'),
    /** The index id the MCP tools use (a hash of the scope); unique per connection and kind. */
    externalId: text('external_id').notNull(),
    scope: jsonb('scope').notNull(),
    embeddingModel: text('embedding_model'),
    embeddingDimensions: integer('embedding_dimensions'),
    /** Build bookkeeping (skipped and failed files). Names files, so the mcp role cannot select it. */
    buildState: jsonb('build_state').notNull().default({}),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('indexes_connection_idx').on(t.connectionId),
    uniqueIndex('indexes_connection_kind_external_id_key').on(t.connectionId, t.kind, t.externalId),
  ],
);

export const documents = pgTable(
  'documents',
  {
    id: id(),
    indexId: uuid('index_id')
      .notNull()
      .references(() => indexes.id, { onDelete: 'cascade' }),
    connectionId: uuid('connection_id').notNull(),
    kind: indexKind('kind').notNull(),
    daluxId: text('dalux_id').notNull(),
    revision: text('revision'),
    contentHash: text('content_hash'),
    title: text('title'),
    projectId: text('project_id'),
    fileAreaId: text('file_area_id'),
    folderId: text('folder_id'),
    folderAncestorIds: text('folder_ancestor_ids').array().notNull().default(sql`'{}'::text[]`),
    metadata: jsonb('metadata').notNull().default({}),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('documents_index_dalux_id_key').on(t.indexId, t.daluxId),
    index('documents_folder_ancestors_idx').using('gin', t.folderAncestorIds),
  ],
);

export const chunks = pgTable(
  'chunks',
  {
    id: id(),
    documentId: uuid('document_id')
      .notNull()
      .references(() => documents.id, { onDelete: 'cascade' }),
    indexId: uuid('index_id')
      .notNull()
      .references(() => indexes.id, { onDelete: 'cascade' }),
    connectionId: uuid('connection_id').notNull(),
    kind: indexKind('kind').notNull(),
    projectId: text('project_id'),
    fileAreaId: text('file_area_id'),
    folderAncestorIds: text('folder_ancestor_ids').array().notNull().default(sql`'{}'::text[]`),
    ordinal: integer('ordinal').notNull(),
    text: text('text').notNull(),
    location: jsonb('location'),
    embedding: vector('embedding', { dimensions: EMBEDDING_DIMENSIONS }),
    tsv: tsvector('tsv')
      .notNull()
      .generatedAlwaysAs((): SQL => sql`to_tsvector('simple', "text")`),
  },
  (t) => [
    index('chunks_document_idx').on(t.documentId),
    index('chunks_index_idx').on(t.indexId),
    index('chunks_embedding_idx').using('hnsw', t.embedding.op('vector_cosine_ops')),
    index('chunks_folder_ancestors_idx').using('gin', t.folderAncestorIds),
    index('chunks_tsv_idx').using('gin', t.tsv),
  ],
);

/**
 * What the worker indexes (PRD 6.3). `scope` holds the same arguments as the
 * build tools: file `{ projectId, fileAreaId, folderId?, folderPath?, recursive?, extensions?, includeDrawings? }`,
 * task `{ projectId, typeId?, filter? }`, docs `{ owner, repo, ref?, path? }`.
 */
export const indexScopes = pgTable(
  'index_scopes',
  {
    id: id(),
    connectionId: uuid('connection_id')
      .notNull()
      .references(() => connections.id, { onDelete: 'cascade' }),
    kind: indexKind('kind').notNull(),
    name: text('name').notNull(),
    scope: jsonb('scope').notNull(),
    intervalMinutes: integer('interval_minutes').notNull().default(360),
    enabled: boolean('enabled').notNull().default(true),
    /** "Refresh now"; the worker runs the scope when this is newer than the last run. */
    refreshRequestedAt: timestamp('refresh_requested_at', { withTimezone: true }),
    lastRunAt: timestamp('last_run_at', { withTimezone: true }),
    lastRunStatus: indexRunStatus('last_run_status'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('index_scopes_connection_idx').on(t.connectionId),
    check('index_scopes_interval', sql`${t.intervalMinutes} >= 15`),
  ],
);

/** One worker run of an index scope. Names skipped and failed files, so only the web (admins) and worker read it. */
export const indexRuns = pgTable(
  'index_runs',
  {
    id: id(),
    scopeId: uuid('scope_id')
      .notNull()
      .references(() => indexScopes.id, { onDelete: 'cascade' }),
    trigger: text('trigger').notNull(),
    status: indexRunStatus('status').notNull().default('running'),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
    durationMs: integer('duration_ms'),
    indexExternalId: text('index_external_id'),
    itemsInScope: integer('items_in_scope'),
    itemsIndexed: integer('items_indexed'),
    itemsReused: integer('items_reused'),
    itemsRemoved: integer('items_removed'),
    itemsPending: integer('items_pending'),
    totalChunks: integer('total_chunks'),
    skipped: jsonb('skipped').notNull().default([]),
    failed: jsonb('failed').notNull().default([]),
    warnings: jsonb('warnings').notNull().default([]),
    embeddingModel: text('embedding_model'),
    embeddingTokens: integer('embedding_tokens'),
    /** True when the provider returned no usage and `embedding_tokens` is an estimate (characters / 3). */
    embeddingTokensEstimated: boolean('embedding_tokens_estimated').notNull().default(false),
    error: text('error'),
  },
  (t) => [index('index_runs_scope_idx').on(t.scopeId, t.startedAt)],
);

export const memoryKind = pgEnum('memory_kind', ['fact', 'decision', 'preference', 'open_question', 'summary']);

/** Whether a person keeps memory for a project. A missing row means off (PRD 6.10). */
export const memorySettings = pgTable(
  'memory_settings',
  {
    accountId: uuid('account_id')
      .notNull()
      .references(() => accounts.id, { onDelete: 'cascade' }),
    connectionId: uuid('connection_id')
      .notNull()
      .references(() => connections.id, { onDelete: 'cascade' }),
    projectId: text('project_id').notNull(),
    enabled: boolean('enabled').notNull().default(false),
    updatedAt: updatedAt(),
  },
  (t) => [primaryKey({ columns: [t.accountId, t.connectionId, t.projectId] })],
);

/**
 * One person's note about one project (PRD 6.10), private to its owner by RLS. An edit inserts a new row
 * and points the old one at it with `superseded_by`; deleting the current row deletes its history too.
 * `source` is `user`, `agent:<token name>` or `hosted_agent:<id>`. No vector index: one person's entries
 * for one project are capped (1,000), so the embedding column is scanned exactly. At most one current
 * `summary` per person and project is kept by the code that writes it, under an advisory lock.
 */
export const memoryEntries = pgTable(
  'memory_entries',
  {
    id: id(),
    accountId: uuid('account_id')
      .notNull()
      .references(() => accounts.id, { onDelete: 'cascade' }),
    connectionId: uuid('connection_id')
      .notNull()
      .references(() => connections.id, { onDelete: 'cascade' }),
    projectId: text('project_id').notNull(),
    kind: memoryKind('kind').notNull(),
    text: text('text').notNull(),
    /** `[{ fileId?, fileName?, fileAreaId?, location?, taskId? }]` */
    citations: jsonb('citations').notNull().default([]),
    source: text('source').notNull(),
    tags: text('tags').array().notNull().default(sql`'{}'::text[]`),
    /** Null when no embedding key was set, or after an edit in the interface (which has no key). */
    embedding: vector('embedding', { dimensions: EMBEDDING_DIMENSIONS }),
    tsv: tsvector('tsv')
      .notNull()
      .generatedAlwaysAs((): SQL => sql`to_tsvector('simple', "text")`),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    supersededBy: uuid('superseded_by').references((): AnyPgColumn => memoryEntries.id, { onDelete: 'cascade' }),
  },
  (t) => [
    index('memory_entries_owner_project_idx').on(t.accountId, t.connectionId, t.projectId),
    check('memory_entries_text_length', sql`char_length(${t.text}) between 1 and 2000`),
    check('memory_entries_tags_count', sql`cardinality(${t.tags}) <= 8`),
  ],
);

export const agentRunStatus = pgEnum('agent_run_status', ['running', 'ok', 'failed', 'limit', 'skipped', 'stopped']);

/**
 * A hosted agent (PRD 6.11): runs on a schedule on behalf of its owner, with at most the owner's access
 * limited to `capabilities`. `enabled` is the one on/off switch: pausing, three failures in a row
 * (`paused_reason`) and an admin stop (`stopped_by`, which only an admin can clear) all turn it off.
 * The last_run_* columns copy the latest run's status and counts, so admins can list every agent without
 * being able to read any run output (agent_runs is visible to the owner only).
 */
export const hostedAgents = pgTable(
  'hosted_agents',
  {
    id: id(),
    ownerId: uuid('owner_id')
      .notNull()
      .references(() => accounts.id, { onDelete: 'cascade' }),
    connectionId: uuid('connection_id')
      .notNull()
      .references(() => connections.id, { onDelete: 'cascade' }),
    projectId: text('project_id').notNull(),
    name: text('name').notNull(),
    template: text('template'),
    instructions: text('instructions').notNull(),
    /** Five-field cron in UTC; null means manual runs only. */
    schedule: text('schedule'),
    capabilities: text('capabilities').array().notNull(),
    tools: text('tools').array().notNull(),
    maxTokens: integer('max_tokens').notNull().default(200_000),
    maxToolCalls: integer('max_tool_calls').notNull().default(40),
    maxDurationSeconds: integer('max_duration_seconds').notNull().default(600),
    enabled: boolean('enabled').notNull().default(true),
    consecutiveFailures: integer('consecutive_failures').notNull().default(0),
    pausedReason: text('paused_reason'),
    stoppedBy: uuid('stopped_by').references(() => accounts.id, { onDelete: 'set null' }),
    /** "Run now" in the interface; the worker starts a run when this is set, then clears it. */
    runRequestedAt: timestamp('run_requested_at', { withTimezone: true }),
    lastRunAt: timestamp('last_run_at', { withTimezone: true }),
    lastRunStatus: agentRunStatus('last_run_status'),
    lastRunTokens: integer('last_run_tokens'),
    lastRunToolCalls: integer('last_run_tool_calls'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('hosted_agents_owner_name_idx').on(t.ownerId, t.name),
    check('hosted_agents_limits', sql`${t.maxTokens} between 1000 and 2000000 and ${t.maxToolCalls} between 1 and 200 and ${t.maxDurationSeconds} between 30 and 3600`),
  ],
);

/** One run of a hosted agent. Only the owner can read it: the output can quote private memory. */
export const agentRuns = pgTable(
  'agent_runs',
  {
    id: id(),
    agentId: uuid('agent_id')
      .notNull()
      .references(() => hostedAgents.id, { onDelete: 'cascade' }),
    trigger: text('trigger').notNull(),
    status: agentRunStatus('status').notNull().default('running'),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
    durationMs: integer('duration_ms'),
    modelTokens: integer('model_tokens').notNull().default(0),
    toolCalls: integer('tool_calls').notNull().default(0),
    outputMarkdown: text('output_markdown'),
    error: text('error'),
    /** `[{ id, name, contentType, size }]`; the bytes are in agent_run_files. */
    files: jsonb('files').notNull().default([]),
  },
  (t) => [index('agent_runs_agent_idx').on(t.agentId, t.startedAt)],
);

/** A file a run produced (e.g. an exported consistency report), kept with the run. */
export const agentRunFiles = pgTable('agent_run_files', {
  id: id(),
  runId: uuid('run_id')
    .notNull()
    .references(() => agentRuns.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  contentType: text('content_type').notNull(),
  size: integer('size').notNull(),
  content: bytea('content').notNull(),
});
