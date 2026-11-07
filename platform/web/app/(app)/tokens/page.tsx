import { PageHeader } from '@/components/page-header';
import { TokenSection } from '@/components/token-section';
import { listConnections } from '@/lib/server/connections';
import { db } from '@/lib/server/db';
import { requireActor } from '@/lib/server/session';
import { listApiTokens } from '@/lib/server/tokens';

export default async function TokensPage() {
  const actor = await requireActor();
  const [tokens, connections] = await Promise.all([listApiTokens(db(), actor.accountId), listConnections(db())]);
  return (
    <>
      <PageHeader title="My tokens">
        Personal API tokens for MCP clients. A token is shown once when you create it; it has your access, no more.
      </PageHeader>
      <TokenSection tokens={tokens} connections={connections} />
    </>
  );
}
