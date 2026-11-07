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

export const connections = pgTable('connections', {
  id: id(),
  name: text('name').notNull(),
  slug: text('slug').notNull().unique(),
  baseUrl: text('base_url').notNull(),
  apiKeyEncrypted: text('api_key_encrypted').notNull(),
  apiKeyLast4: text('api_key_last4').notNull(),
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
    updatedAt: updatedAt(),
  },
  (t) => [check('settings_single_row', sql`${t.id}`)],
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
  },
  (t) => [index('audit_log_at_idx').on(t.at), index('audit_log_account_idx').on(t.accountId, t.at)],
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
