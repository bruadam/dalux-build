import { currentActor } from '@/lib/server/session';
import { db } from '@/lib/server/db';
import { getRunFile } from '@/lib/server/agents';

/** Downloads a file a run produced. Only the agent's owner can read it. */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  const actor = await currentActor();
  if (!actor) return new Response('Sign in first', { status: 401 });
  const { id } = await params;
  const file = /^[0-9a-f-]{36}$/i.test(id) ? await getRunFile(db(), actor.accountId, id) : undefined;
  if (!file) return new Response('Not found', { status: 404 });
  return new Response(new Uint8Array(file.content), {
    headers: {
      'Content-Type': file.contentType,
      'Content-Disposition': `attachment; filename="${file.name.replace(/[^\w.-]/g, '_')}"`,
      'Cache-Control': 'no-store',
    },
  });
}
