import { and, desc, eq, gte, ilike, isNotNull, isNull, lte, sql, type SQL } from 'drizzle-orm';
import { accounts, auditLog, connections, withAccount, type Db, type Tx } from '@dalux-platform/db';
import { assertAdmin, type Actor } from './actor';

export interface AuditFilter {
  from?: Date;
  /** Inclusive: the whole of this day when given as a date. */
  to?: Date;
  accountId?: string;
  /** Tool name or admin action; matches as a substring. */
  action?: string;
  connectionId?: string;
  status?: string;
  kind?: 'tool' | 'admin';
  projectId?: string;
  /** Matches the start of the stored address, so `203.0.113` finds a /24. */
  ip?: string;
  /** Token or OAuth client name; matches as a substring. */
  client?: string;
  /** Whose call it was: a person, a robot account or a hosted agent. */
  accountType?: 'personal' | 'robot' | 'agent';
}

export const AUDIT_PAGE_SIZE = 100;
const EXPORT_LIMIT = 50_000;

const isDate = (value: string | undefined) => (value && !Number.isNaN(Date.parse(value)) ? new Date(value) : undefined);

/** Reads a filter from query parameters; unknown or malformed values are ignored. */
export function parseAuditFilter(params: Record<string, string | undefined>): AuditFilter {
  const to = isDate(params.to);
  const uuid = (value?: string) => (value && /^[0-9a-f-]{36}$/i.test(value) ? value : undefined);
  return {
    from: isDate(params.from),
    to: to && new Date(to.getTime() + 24 * 60 * 60 * 1000 - 1),
    accountId: uuid(params.account),
    connectionId: uuid(params.connection),
    action: params.action?.trim() || undefined,
    status: params.status?.trim() || undefined,
    kind: params.kind === 'tool' || params.kind === 'admin' ? params.kind : undefined,
    projectId: params.project?.trim() || undefined,
    ip: params.ip?.trim() || undefined,
    client: params.client?.trim() || undefined,
    accountType: params.type === 'personal' || params.type === 'robot' || params.type === 'agent' ? params.type : undefined,
  };
}

const like = (text: string) => text.replace(/[\\%_]/g, '\\$&');

function conditions(filter: AuditFilter): SQL | undefined {
  return and(
    filter.from ? gte(auditLog.at, filter.from) : undefined,
    filter.to ? lte(auditLog.at, filter.to) : undefined,
    filter.accountId ? eq(auditLog.accountId, filter.accountId) : undefined,
    filter.connectionId ? eq(auditLog.connectionId, filter.connectionId) : undefined,
    filter.status ? eq(auditLog.status, filter.status) : undefined,
    filter.kind ? eq(auditLog.kind, filter.kind) : undefined,
    filter.action ? ilike(auditLog.action, `%${like(filter.action)}%`) : undefined,
    filter.projectId ? eq(auditLog.projectId, filter.projectId) : undefined,
    filter.ip ? ilike(auditLog.clientIp, `${like(filter.ip)}%`) : undefined,
    filter.client ? ilike(auditLog.client, `%${like(filter.client)}%`) : undefined,
    filter.accountType === 'agent' ? isNotNull(auditLog.agentId) : undefined,
    filter.accountType === 'personal' ? and(isNull(auditLog.agentId), eq(accounts.type, 'personal')) : undefined,
    filter.accountType === 'robot' ? and(isNull(auditLog.agentId), eq(accounts.type, 'robot')) : undefined,
  );
}

function rows(db: Db | Tx, filter: AuditFilter, limit: number, offset: number) {
  return db
    .select({
      id: auditLog.id,
      at: auditLog.at,
      kind: auditLog.kind,
      action: auditLog.action,
      targetType: auditLog.targetType,
      targetId: auditLog.targetId,
      accountName: accounts.name,
      accountEmail: accounts.email,
      daluxUserId: auditLog.daluxUserId,
      client: auditLog.client,
      connection: connections.name,
      projectId: auditLog.projectId,
      capability: auditLog.capability,
      status: auditLog.status,
      durationMs: auditLog.durationMs,
      clientIp: auditLog.clientIp,
      authMethod: auditLog.authMethod,
      agentName: auditLog.agentName,
      requestId: auditLog.requestId,
      denialReason: auditLog.denialReason,
      errorCode: auditLog.errorCode,
      resultItems: auditLog.resultItems,
      resultBytes: auditLog.resultBytes,
      fileCount: auditLog.fileCount,
      daluxCalls: auditLog.daluxCalls,
      daluxRateLimited: auditLog.daluxRateLimited,
    })
    .from(auditLog)
    .leftJoin(accounts, eq(accounts.id, auditLog.accountId))
    .leftJoin(connections, eq(connections.id, auditLog.connectionId))
    .where(conditions(filter))
    .orderBy(desc(auditLog.at), desc(auditLog.id))
    .limit(limit)
    .offset(offset);
}

export type AuditRow = Awaited<ReturnType<typeof rows>>[number];

/**
 * Reads run under the signed-in account, so row-level security decides what is visible: admins see every row,
 * everyone else only their own. `own` narrows an admin to their own rows too (the "My activity" page).
 */
async function page(db: Db, actor: Actor, filter: AuditFilter, own: boolean, number: number) {
  const scoped = own ? { ...filter, accountId: actor.accountId } : filter;
  return withAccount(db, actor.accountId, async (tx) => {
    const [items, [count]] = await Promise.all([
      rows(tx, scoped, AUDIT_PAGE_SIZE, number * AUDIT_PAGE_SIZE),
      tx
        .select({ total: sql<number>`count(*)::int` })
        .from(auditLog)
        .leftJoin(accounts, eq(accounts.id, auditLog.accountId))
        .where(conditions(scoped)),
    ]);
    return { items, total: count.total };
  });
}

/** One page of the audit log, newest first, and the number of rows matching the filter. */
export async function listAudit(db: Db, actor: Actor, filter: AuditFilter, pageNumber = 0) {
  assertAdmin(actor);
  return page(db, actor, filter, false, pageNumber);
}

/** One page of the signed-in account's own activity. */
export async function listOwnActivity(db: Db, actor: Actor, filter: AuditFilter, pageNumber = 0) {
  return page(db, actor, filter, true, pageNumber);
}

/** A cell that a spreadsheet would read as a formula is prefixed so it is shown as text. */
function csvCell(value: unknown): string {
  const text = value instanceof Date ? value.toISOString() : String(value ?? '');
  const safe = /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

const CSV_COLUMNS: [string, (row: AuditRow) => unknown][] = [
  ['time', (r) => r.at],
  ['kind', (r) => r.kind],
  ['account', (r) => r.accountEmail ?? r.accountName],
  ['dalux_user_id', (r) => r.daluxUserId],
  ['client', (r) => r.client],
  ['connection', (r) => r.connection],
  ['project_id', (r) => r.projectId],
  ['action', (r) => r.action],
  ['target', (r) => (r.targetType ? `${r.targetType}:${r.targetId ?? ''}` : '')],
  ['capability', (r) => r.capability],
  ['status', (r) => r.status],
  ['duration_ms', (r) => r.durationMs],
  ['client_ip', (r) => r.clientIp],
  ['auth_method', (r) => r.authMethod],
  ['agent', (r) => r.agentName],
  ['denial_reason', (r) => r.denialReason],
  ['error_code', (r) => r.errorCode],
  ['result_items', (r) => r.resultItems],
  ['result_bytes', (r) => r.resultBytes],
  ['request_id', (r) => r.requestId],
];

async function exportRows(db: Db, actor: Actor, filter: AuditFilter, own: boolean): Promise<AuditRow[]> {
  const scoped = own ? { ...filter, accountId: actor.accountId } : filter;
  return withAccount(db, actor.accountId, (tx) => rows(tx, scoped, EXPORT_LIMIT, 0));
}

function toCsv(items: AuditRow[]): string {
  const lines = [CSV_COLUMNS.map(([name]) => name).join(',')];
  for (const row of items) lines.push(CSV_COLUMNS.map(([, value]) => csvCell(value(row))).join(','));
  return `${lines.join('\n')}\n`;
}

const toJson = (items: AuditRow[]) => JSON.stringify(items, null, 2);

/** The filtered audit log as CSV, newest first, at most 50,000 rows. */
export async function auditCsv(db: Db, actor: Actor, filter: AuditFilter): Promise<string> {
  assertAdmin(actor);
  return toCsv(await exportRows(db, actor, filter, false));
}

/** The same rows as JSON. */
export async function auditJson(db: Db, actor: Actor, filter: AuditFilter): Promise<string> {
  assertAdmin(actor);
  return toJson(await exportRows(db, actor, filter, false));
}

/** The signed-in account's own activity as CSV or JSON. */
export async function ownActivityExport(db: Db, actor: Actor, filter: AuditFilter, format: 'csv' | 'json'): Promise<string> {
  const items = await exportRows(db, actor, filter, true);
  return format === 'csv' ? toCsv(items) : toJson(items);
}

/** Accounts to pick in the account filter. */
export function listAuditAccounts(db: Db, actor: Actor) {
  assertAdmin(actor);
  return db.select({ id: accounts.id, name: accounts.name, email: accounts.email }).from(accounts).orderBy(accounts.name);
}
