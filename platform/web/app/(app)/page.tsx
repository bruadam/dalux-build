import { AccessTable } from '@/components/access-table';
import { PageHeader } from '@/components/page-header';
import { effectiveAccessFor } from '@/lib/server/access';
import { db } from '@/lib/server/db';
import { requireActor } from '@/lib/server/session';

export default async function MyAccessPage() {
  const actor = await requireActor();
  const rows = await effectiveAccessFor(db(), actor.accountId);
  return (
    <>
      <PageHeader title="My access">What you can use through MCP, and which grant gives it.</PageHeader>
      <AccessTable rows={rows} />
    </>
  );
}
