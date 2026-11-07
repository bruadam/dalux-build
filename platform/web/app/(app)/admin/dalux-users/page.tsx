import Link from 'next/link';
import { linkDaluxUserAction, matchDaluxUsersAction, unlinkDaluxUserAction } from '@/app/actions';
import { ActionForm } from '@/components/action-form';
import { selectClass } from '@/components/field';
import { PageHeader } from '@/components/page-header';
import { dateTime } from '@/components/run-status';
import { Cell, Table } from '@/components/table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { listConnections } from '@/lib/server/connections';
import { db } from '@/lib/server/db';
import { daluxUserLinksFor } from '@/lib/server/daluxUsers';
import { requireAdmin } from '@/lib/server/session';

export default async function DaluxUsersPage({ searchParams }: { searchParams: Promise<{ connection?: string }> }) {
  await requireAdmin();
  const connections = await listConnections(db());
  const { connection: requested } = await searchParams;
  const selected = connections.find((c) => c.id === requested) ?? connections[0];
  const data = selected ? await daluxUserLinksFor(db(), selected.id) : undefined;
  return (
    <>
      <PageHeader title="Dalux users">
        Personal accounts are linked to the Dalux user with the same email, once a day and when an account or connection is
        added. With no match or several, the account is not linked and you can link it here. Robots are only linked by hand.
        Manual links are never changed by the matching.
      </PageHeader>
      <nav className="mb-4 flex flex-wrap gap-2 text-sm">
        {connections.map((c) => (
          <Link
            key={c.id}
            href={`/admin/dalux-users?connection=${c.id}`}
            className={`rounded-md border px-2 py-1 ${c.id === selected?.id ? 'bg-muted font-medium' : ''}`}
          >
            {c.name}
          </Link>
        ))}
      </nav>
      {data && (
        <>
          <div className="mb-4 flex flex-wrap items-center gap-4 text-sm">
            <span>
              {data.daluxUsers.length} Dalux users, last loaded {dateTime(data.connection.syncedAt)}
            </span>
            {data.connection.syncError && <span className="text-destructive">Last load failed: {data.connection.syncError}</span>}
            <ActionForm action={matchDaluxUsersAction}>
              <input type="hidden" name="connectionId" value={data.connection.id} />
              <Button type="submit" variant="outline" size="sm">
                Load users and match now
              </Button>
            </ActionForm>
          </div>
          <Table head={['Account', 'Dalux user', 'Link by hand']} empty={!data.accounts.length}>
            {data.accounts.map((row) => (
              <tr key={row.accountId}>
                <Cell>
                  {row.name}
                  <div className="text-xs text-muted-foreground">{row.type === 'robot' ? 'robot' : row.email}</div>
                </Cell>
                <Cell>
                  {row.daluxUserId ? (
                    <>
                      {row.daluxName ?? row.daluxEmail ?? row.daluxUserId} <Badge variant="outline">{row.source}</Badge>
                      <div className="text-xs text-muted-foreground">
                        {row.daluxEmail} · <code>{row.daluxUserId}</code>
                      </div>
                    </>
                  ) : (
                    <Badge variant="destructive">not linked</Badge>
                  )}
                </Cell>
                <Cell>
                  <div className="flex flex-wrap gap-2">
                    <ActionForm action={linkDaluxUserAction}>
                      <input type="hidden" name="accountId" value={row.accountId} />
                      <input type="hidden" name="connectionId" value={data.connection.id} />
                      <select name="daluxUserId" aria-label="Dalux user" className={selectClass} defaultValue="" required>
                        <option value="" disabled>
                          Choose…
                        </option>
                        {data.daluxUsers.map((user) => (
                          <option key={user.daluxUserId} value={user.daluxUserId}>
                            {user.email ?? user.daluxUserId}
                            {user.name ? ` (${user.name})` : ''}
                          </option>
                        ))}
                      </select>
                      <Button type="submit" variant="outline" size="sm">
                        Link
                      </Button>
                    </ActionForm>
                    {row.daluxUserId && (
                      <ActionForm action={unlinkDaluxUserAction}>
                        <input type="hidden" name="accountId" value={row.accountId} />
                        <input type="hidden" name="connectionId" value={data.connection.id} />
                        <Button type="submit" variant="ghost" size="sm">
                          Unlink
                        </Button>
                      </ActionForm>
                    )}
                  </div>
                </Cell>
              </tr>
            ))}
          </Table>
        </>
      )}
    </>
  );
}
