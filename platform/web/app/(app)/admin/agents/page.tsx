import { stopAgentAction } from '@/app/actions';
import { ActionForm } from '@/components/action-form';
import { AgentState } from '@/components/agent-state';
import { PageHeader } from '@/components/page-header';
import { dateTime, RunStatus } from '@/components/run-status';
import { Cell, Table } from '@/components/table';
import { Button } from '@/components/ui/button';
import { listAccounts } from '@/lib/server/accounts';
import { listAgents } from '@/lib/server/agents';
import { listConnections } from '@/lib/server/connections';
import { db } from '@/lib/server/db';
import { requireAdmin } from '@/lib/server/session';

export default async function AdminAgentsPage() {
  const actor = await requireAdmin();
  const [agents, accounts, connections] = await Promise.all([listAgents(db(), actor.accountId, true), listAccounts(db()), listConnections(db())]);
  const ownerName = (id: string) => accounts.find((account) => account.id === id)?.name ?? id;
  const connectionName = (id: string) => connections.find((connection) => connection.id === id)?.name ?? id;
  return (
    <>
      <PageHeader title="All agents">
        Every hosted agent with its state and the size of its last run. Run reports are visible to the owner only: they can
        quote private project memory. A stopped agent stays off until an admin releases it; the owner can then resume it.
      </PageHeader>
      <Table head={['Agent', 'Owner', 'Project', 'Schedule', 'State', 'Last run', 'Tokens', 'Tool calls', '']} empty={!agents.length}>
        {agents.map((agent) => (
          <tr key={agent.id}>
            <Cell>
              {agent.name}
              <div className="text-xs text-muted-foreground">{agent.tools.length} tools</div>
            </Cell>
            <Cell>{ownerName(agent.ownerId)}</Cell>
            <Cell>
              {connectionName(agent.connectionId)} / <code>{agent.projectId}</code>
            </Cell>
            <Cell>{agent.schedule ? <code>{agent.schedule}</code> : 'manual'}</Cell>
            <Cell>
              <AgentState agent={agent} />
            </Cell>
            <Cell>
              <RunStatus status={agent.lastRunStatus} />
              <div className="text-xs text-muted-foreground">{dateTime(agent.lastRunAt)}</div>
            </Cell>
            <Cell>{agent.lastRunTokens ?? '—'}</Cell>
            <Cell>{agent.lastRunToolCalls ?? '—'}</Cell>
            <Cell>
              <ActionForm action={stopAgentAction} confirm={agent.stoppedBy ? undefined : `Stop "${agent.name}"? Its owner cannot resume it.`}>
                <input type="hidden" name="agentId" value={agent.id} />
                <input type="hidden" name="stop" value={String(!agent.stoppedBy)} />
                <Button type="submit" variant="outline" size="sm">
                  {agent.stoppedBy ? 'Release' : 'Stop'}
                </Button>
              </ActionForm>
            </Cell>
          </tr>
        ))}
      </Table>
    </>
  );
}
