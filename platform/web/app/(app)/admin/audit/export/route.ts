import { auditCsv, parseAuditFilter } from '@/lib/server/auditLog';
import { db } from '@/lib/server/db';
import { currentActor } from '@/lib/server/session';

export const dynamic = 'force-dynamic';

/** The filtered audit log as a CSV download (admins only). */
export async function GET(request: Request): Promise<Response> {
  const actor = await currentActor();
  if (actor?.role !== 'admin') return new Response('Forbidden', { status: 403 });
  const filter = parseAuditFilter(Object.fromEntries(new URL(request.url).searchParams));
  return new Response(await auditCsv(db(), actor, filter), {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': 'attachment; filename="audit-log.csv"',
      'Cache-Control': 'no-store',
    },
  });
}
