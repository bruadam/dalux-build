import { and, isNotNull, lt, or } from 'drizzle-orm';
import { auditLog, authEvents, settings } from './schema';
import type { Db } from './db';

/**
 * Clears the IP columns of audit rows and auth events older than the IP retention period
 * (`settings.ip_retention_days`); the rows stay. Returns how many rows were changed.
 */
export async function clearExpiredIps(db: Db, now = new Date()): Promise<number> {
  const [row] = await db.select({ days: settings.ipRetentionDays }).from(settings);
  const cutoff = new Date(now.getTime() - (row?.days ?? 90) * 86_400_000);
  const cleared = { clientIp: null, forwardedFor: null };
  const audit = await db
    .update(auditLog)
    .set(cleared)
    .where(and(lt(auditLog.at, cutoff), or(isNotNull(auditLog.clientIp), isNotNull(auditLog.forwardedFor))));
  const events = await db
    .update(authEvents)
    .set(cleared)
    .where(and(lt(authEvents.at, cutoff), or(isNotNull(authEvents.clientIp), isNotNull(authEvents.forwardedFor))));
  return (audit.rowCount ?? 0) + (events.rowCount ?? 0);
}
