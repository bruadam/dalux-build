import { revokeOAuthSessionAction } from '@/app/actions';
import { ActionForm } from '@/components/action-form';
import { PageHeader } from '@/components/page-header';
import { Cell, Table } from '@/components/table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { db } from '@/lib/server/db';
import { listOAuthSessions } from '@/lib/server/oauth';
import { requireActor } from '@/lib/server/session';

const date = (value: Date | null) => (value ? value.toISOString().slice(0, 10) : '—');

export default async function ConnectedAppsPage() {
  const actor = await requireActor();
  const sessions = await listOAuthSessions(db(), actor.accountId);
  return (
    <>
      <PageHeader title="Connected apps">
        MCP clients you approved with OAuth (Claude, ChatGPT, Linear, …). Revoking one signs it out within a minute.
      </PageHeader>
      <Table head={['App', 'Connection', 'Access', 'Approved', 'Last used', '']} empty={!sessions.length}>
        {sessions.map((session) => (
          <tr key={session.id}>
            <Cell>{session.clientName ?? 'Unnamed client'}</Cell>
            <Cell>{session.connectionName}</Cell>
            <Cell>{session.capabilities ? session.capabilities.join(', ') : 'Full account access'}</Cell>
            <Cell>{date(session.createdAt)}</Cell>
            <Cell>{date(session.lastUsedAt)}</Cell>
            <Cell>
              {session.revokedAt ? (
                <Badge variant="secondary">Revoked</Badge>
              ) : (
                <ActionForm action={revokeOAuthSessionAction} confirm="Revoke this app's access?">
                  <input type="hidden" name="sessionId" value={session.id} />
                  <Button type="submit" variant="outline" size="sm">
                    Revoke
                  </Button>
                </ActionForm>
              )}
            </Cell>
          </tr>
        ))}
      </Table>
    </>
  );
}
