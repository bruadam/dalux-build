import Link from 'next/link';
import { createAgentAction, runAgentNowAction, switchAgentAction } from '@/app/actions';
import { ActionForm } from '@/components/action-form';
import { AgentForm } from '@/components/agent-form';
import { AgentState } from '@/components/agent-state';
import { PageHeader } from '@/components/page-header';
import { dateTime, RunStatus } from '@/components/run-status';
import { Cell, Table } from '@/components/table';
import { Button } from '@/components/ui/button';
import { AGENT_LIMITS, AGENT_TEMPLATES, listAgents, nextRunAt } from '@/lib/server/agents';
import { listConnections } from '@/lib/server/connections';
import { db } from '@/lib/server/db';
import { requireActor } from '@/lib/server/session';

export default async function AgentsPage({ searchParams }: { searchParams: Promise<{ template?: string; new?: string }> }) {
  const actor = await requireActor();
  const { template: templateId, new: openNew } = await searchParams;
  const [agents, connections] = await Promise.all([listAgents(db(), actor.accountId), listConnections(db())]);
  const connectionName = (id: string) => connections.find((connection) => connection.id === id)?.name ?? id;
  const template = AGENT_TEMPLATES.find((t) => t.id === templateId);

  return (
    <>
      <PageHeader title="My agents">
        Agents run on a schedule with your access, at most what you choose for them, and never more than you hold. They only
        read from Dalux. They write to your own project memory (when it is on) and to their run reports. If you lose access
        to the project, runs are skipped. Three failed runs in a row pause an agent. Runs need a Mistral key in the admin
        Settings. Schedules are in UTC.
      </PageHeader>

      <section className="mb-8 space-y-3">
        <Table head={['Agent', 'Project', 'Schedule', 'State', 'Last run', '']} empty={!agents.length}>
          {agents.map((agent) => (
            <tr key={agent.id}>
              <Cell>
                <Link href={`/agents/${agent.id}`} className="underline">
                  {agent.name}
                </Link>
                {agent.template && <div className="text-xs text-muted-foreground">{agent.template}</div>}
              </Cell>
              <Cell>
                {connectionName(agent.connectionId)} / <code>{agent.projectId}</code>
              </Cell>
              <Cell>
                {agent.schedule ? (
                  <>
                    <code>{agent.schedule}</code>
                    {agent.enabled && <div className="text-xs text-muted-foreground">next {dateTime(nextRunAt(agent.schedule))}</div>}
                  </>
                ) : (
                  'manual'
                )}
              </Cell>
              <Cell>
                <AgentState agent={agent} />
              </Cell>
              <Cell>
                <RunStatus status={agent.lastRunStatus} />
                <div className="text-xs text-muted-foreground">
                  {dateTime(agent.lastRunAt)}
                  {agent.runRequestedAt && ' · run requested'}
                </div>
              </Cell>
              <Cell>
                <div className="flex gap-2">
                  <ActionForm action={runAgentNowAction}>
                    <input type="hidden" name="agentId" value={agent.id} />
                    <Button type="submit" size="sm">
                      Run now
                    </Button>
                  </ActionForm>
                  <ActionForm action={switchAgentAction}>
                    <input type="hidden" name="agentId" value={agent.id} />
                    <input type="hidden" name="enabled" value={String(!agent.enabled)} />
                    <Button type="submit" variant="outline" size="sm">
                      {agent.enabled ? 'Pause' : 'Resume'}
                    </Button>
                  </ActionForm>
                </div>
              </Cell>
            </tr>
          ))}
        </Table>
      </section>

      <section className="space-y-3">
        <h2 className="font-medium">New agent</h2>
        <div className="flex flex-wrap gap-2 text-sm">
          {AGENT_TEMPLATES.map((t) => (
            <Link key={t.id} href={`/agents?template=${t.id}`} className="rounded-md border px-3 py-2 hover:bg-muted" title={t.summary}>
              <span className="font-medium">{t.name}</span>
              <span className="block max-w-56 text-xs text-muted-foreground">{t.summary}</span>
            </Link>
          ))}
          <Link href="/agents?new=blank" className="rounded-md border px-3 py-2 hover:bg-muted">
            <span className="font-medium">Blank</span>
            <span className="block text-xs text-muted-foreground">Write your own instructions.</span>
          </Link>
        </div>
        {(template || openNew) && (
          <AgentForm
            key={template?.id ?? 'blank'}
            action={createAgentAction}
            connections={connections}
            submit="Create agent"
            values={{
              connectionId: connections[0]?.id ?? '',
              projectId: '',
              name: template?.name ?? '',
              template: template?.id ?? null,
              instructions: template?.instructions ?? '',
              schedule: template?.schedule ?? null,
              capabilities: template?.capabilities ?? ['projects:read'],
              tools: template?.tools ?? ['get_project'],
              maxTokens: AGENT_LIMITS.maxTokens.default,
              maxToolCalls: AGENT_LIMITS.maxToolCalls.default,
              maxDurationSeconds: AGENT_LIMITS.maxDurationSeconds.default,
            }}
          />
        )}
      </section>
    </>
  );
}
