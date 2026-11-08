import { lt } from 'drizzle-orm';
import { auditLog, authEvents, settings, type Db } from '@dalux-platform/db';

export const DEFAULT_AUDIT_RETENTION_DAYS = 180;

/** Deletes audit rows and auth events older than the retention setting (default 180 days); returns how many. */
export async function purgeAuditLog(db: Db, now: Date = new Date()): Promise<number> {
  const [row] = await db.select({ days: settings.auditRetentionDays }).from(settings);
  const cutoff = new Date(now.getTime() - (row?.days ?? DEFAULT_AUDIT_RETENTION_DAYS) * 24 * 60 * 60 * 1000);
  const rows = await db.delete(auditLog).where(lt(auditLog.at, cutoff));
  const events = await db.delete(authEvents).where(lt(authEvents.at, cutoff));
  return (rows.rowCount ?? 0) + (events.rowCount ?? 0);
}
