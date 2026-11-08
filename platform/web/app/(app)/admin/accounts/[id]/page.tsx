import { eq } from 'drizzle-orm';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { accounts } from '@dalux-platform/db';
import { AccessTable } from '@/components/access-table';
import { ActivityTable } from '@/components/activity-table';
import { PageHeader } from '@/components/page-header';
import { TokenSection } from '@/components/token-section';
import { effectiveAccessFor } from '@/lib/server/access';
import { listAudit } from '@/lib/server/auditLog';
import { listConnections } from '@/lib/server/connections';
import { db } from '@/lib/server/db';
import { requireAdmin } from '@/lib/server/session';
import { listApiTokens } from '@/lib/server/tokens';

export default async function AccountDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const actor = await requireAdmin();
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const [account] = await db().select().from(accounts).where(eq(accounts.id, id));
  if (!account) notFound();
  const robot = account.type === 'robot';
  const [access, tokens, connections, recent] = await Promise.all([
    effectiveAccessFor(db(), id),
    robot ? listApiTokens(db(), id) : [],
    robot ? listConnections(db()) : [],
    listAudit(db(), actor, { accountId: id, kind: 'tool' }),
  ]);
  return (
    <>
      <PageHeader title={account.name}>
        {robot ? 'Robot account' : account.email} · {account.status}
      </PageHeader>
      <section className="space-y-2">
        <h2 className="font-medium">Effective access</h2>
        <AccessTable rows={access} />
      </section>
      <section className="mt-8 space-y-2">
        <h2 className="font-medium">Recent activity</h2>
        <ActivityTable items={recent.items.slice(0, 15)} showAccount={false} rowHref={(rowId) => `/admin/audit?account=${id}&row=${rowId}`} />
        <Link className="text-sm underline" href={`/admin/audit?account=${id}`}>
          All activity of this account ({recent.total})
        </Link>
      </section>
      {robot && (
        <section className="mt-8 space-y-2">
          <h2 className="font-medium">Robot tokens</h2>
          <TokenSection tokens={tokens} connections={connections} robotId={id} />
        </section>
      )}
    </>
  );
}
