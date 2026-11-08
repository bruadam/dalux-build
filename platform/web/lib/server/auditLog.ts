import { and, desc, eq, gte, ilike, lte, sql, type SQL } from 'drizzle-orm';
import { accounts, auditLog, connections, type Db } from '@dalux-platform/db';
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
  };
}

function conditions(filter: AuditFilter): SQL | undefined {
  return and(
    filter.from ? gte(auditLog.at, filter.from) : undefined,
    filter.to ? lte(auditLog.at, filter.to) : undefined,
    filter.accountId ? eq(auditLog.accountId, filter.accountId) : undefined,
    filter.connectionId ? eq(auditLog.connectionId, filter.connectionId) : undefined,
    filter.status ? eq(auditLog.status, filter.status) : undefined,
    filter.kind ? eq(auditLog.kind, filter.kind) : undefined,
    filter.action ? ilike(auditLog.action, `%${filter.action.replace(/[\\%_]/g, '\\$&')}%`) : undefined,
  );
}

function rows(db: Db, filter: AuditFilter, limit: number, offset: number) {
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

/** One page of the audit log, newest first, and the number of rows matching the filter. */
export async function listAudit(db: Db, actor: Actor, filter: AuditFilter, page = 0) {
  assertAdmin(actor);
  const [items, [count]] = await Promise.all([
    rows(db, filter, AUDIT_PAGE_SIZE, page * AUDIT_PAGE_SIZE),
    db.select({ total: sql<number>`count(*)::int` }).from(auditLog).where(conditions(filter)),
  ]);
  return { items, total: count.total };
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
];

/** The filtered audit log as CSV, newest first, at most 50,000 rows. */
export async function auditCsv(db: Db, actor: Actor, filter: AuditFilter): Promise<string> {
  assertAdmin(actor);
  const lines = [CSV_COLUMNS.map(([name]) => name).join(',')];
  for (const row of await rows(db, filter, EXPORT_LIMIT, 0)) lines.push(CSV_COLUMNS.map(([, value]) => csvCell(value(row))).join(','));
  return `${lines.join('\n')}\n`;
}

/** Accounts to pick in the account filter. */
export function listAuditAccounts(db: Db, actor: Actor) {
  assertAdmin(actor);
  return db.select({ id: accounts.id, name: accounts.name, email: accounts.email }).from(accounts).orderBy(accounts.name);
}
