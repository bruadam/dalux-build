import { auditCsv, auditJson, parseAuditFilter } from '@/lib/server/auditLog';
import { db } from '@/lib/server/db';
import { currentActor } from '@/lib/server/session';

export const dynamic = 'force-dynamic';

/** The filtered activity log as a CSV or JSON download (admins only). */
export async function GET(request: Request): Promise<Response> {
  const actor = await currentActor();
  if (actor?.role !== 'admin') return new Response('Forbidden', { status: 403 });
  const params = Object.fromEntries(new URL(request.url).searchParams);
  const filter = parseAuditFilter(params);
  const json = params.format === 'json';
  return new Response(json ? await auditJson(db(), actor, filter) : await auditCsv(db(), actor, filter), {
    headers: {
      'Content-Type': json ? 'application/json; charset=utf-8' : 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="activity.${json ? 'json' : 'csv'}"`,
      'Cache-Control': 'no-store',
    },
  });
}
