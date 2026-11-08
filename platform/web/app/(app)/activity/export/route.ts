import { ownActivityExport, parseAuditFilter } from '@/lib/server/auditLog';
import { db } from '@/lib/server/db';
import { currentActor } from '@/lib/server/session';

export const dynamic = 'force-dynamic';

/** The signed-in person's own activity as a CSV or JSON download. */
export async function GET(request: Request): Promise<Response> {
  const actor = await currentActor();
  if (!actor) return new Response('Forbidden', { status: 403 });
  const params = Object.fromEntries(new URL(request.url).searchParams);
  const json = params.format === 'json';
  return new Response(await ownActivityExport(db(), actor, parseAuditFilter(params), json ? 'json' : 'csv'), {
    headers: {
      'Content-Type': json ? 'application/json; charset=utf-8' : 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="my-activity.${json ? 'json' : 'csv'}"`,
      'Cache-Control': 'no-store',
    },
  });
}
