import { eq } from 'drizzle-orm';
import { notFound } from 'next/navigation';
import { accounts } from '@dalux-platform/db';
import { AccessTable } from '@/components/access-table';
import { PageHeader } from '@/components/page-header';
import { TokenSection } from '@/components/token-section';
import { effectiveAccessFor } from '@/lib/server/access';
import { listConnections } from '@/lib/server/connections';
import { db } from '@/lib/server/db';
import { requireAdmin } from '@/lib/server/session';
import { listApiTokens } from '@/lib/server/tokens';

export default async function AccountDetailPage({ params }: { params: Promise<{ id: string }> }) {
  await requireAdmin();
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const [account] = await db().select().from(accounts).where(eq(accounts.id, id));
  if (!account) notFound();
  const robot = account.type === 'robot';
  const [access, tokens, connections] = await Promise.all([
    effectiveAccessFor(db(), id),
    robot ? listApiTokens(db(), id) : [],
    robot ? listConnections(db()) : [],
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
      {robot && (
        <section className="mt-8 space-y-2">
          <h2 className="font-medium">Robot tokens</h2>
          <TokenSection tokens={tokens} connections={connections} robotId={id} />
        </section>
      )}
    </>
  );
}
