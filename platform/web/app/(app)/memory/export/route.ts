import { currentActor } from '@/lib/server/session';
import { listConnections } from '@/lib/server/connections';
import { db } from '@/lib/server/db';
import { UserError } from '@/lib/server/errors';
import { exportMemoryFile } from '@/lib/server/memory';

/** Downloads one project's memory as JSON or Markdown, old versions included. Only the owner's rows are readable. */
export async function GET(request: Request): Promise<Response> {
  const actor = await currentActor();
  if (!actor) return new Response('Sign in first', { status: 401 });
  const params = new URL(request.url).searchParams;
  const connectionId = params.get('c') ?? '';
  const connection = (await listConnections(db())).find((row) => row.id === connectionId);
  try {
    const file = await exportMemoryFile(db(), actor, {
      connectionId,
      projectId: params.get('p') ?? '',
      connectionName: connection?.name ?? connectionId,
      format: params.get('format') === 'md' ? 'md' : 'json',
    });
    return new Response(file.body, {
      headers: {
        'Content-Type': file.contentType,
        'Content-Disposition': `attachment; filename="${file.filename}"`,
        'Cache-Control': 'no-store',
      },
    });
  } catch (error) {
    if (error instanceof UserError) return new Response(error.message, { status: 400 });
    throw error;
  }
}
