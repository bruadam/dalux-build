import Link from 'next/link';
import { notFound } from 'next/navigation';
import { deleteAgentAction, runAgentNowAction, switchAgentAction, updateAgentAction } from '@/app/actions';
import { ActionForm } from '@/components/action-form';
import { AgentForm } from '@/components/agent-form';
import { AgentState } from '@/components/agent-state';
import { PageHeader } from '@/components/page-header';
import { dateTime, RunStatus } from '@/components/run-status';
import { Cell, Table } from '@/components/table';
import { Button } from '@/components/ui/button';
import { getAgent, listRuns, nextRunAt } from '@/lib/server/agents';
import { listConnections } from '@/lib/server/connections';
import { db } from '@/lib/server/db';
import { requireActor } from '@/lib/server/session';

const seconds = (ms: number | null) => (ms === null ? '—' : `${(ms / 1000).toFixed(ms < 10_000 ? 1 : 0)} s`);

export default async function AgentPage({ params }: { params: Promise<{ id: string }> }) {
  const actor = await requireActor();
  const { id } = await params;
  const agent = await getAgent(db(), actor.accountId, id);
  // Admins can read an agent row but not its runs; they manage it on the admin page.
  if (!agent || agent.ownerId !== actor.accountId) notFound();
  const [runs, connections] = await Promise.all([listRuns(db(), actor.accountId, id), listConnections(db())]);

  return (
    <>
      <PageHeader title={agent.name}>
        <Link href="/agents" className="underline">
          All agents
        </Link>
        {' · '}
        {agent.schedule ? (
          <>
            <code>{agent.schedule}</code> (UTC){agent.enabled && <>, next run {dateTime(nextRunAt(agent.schedule))}</>}
          </>
        ) : (
          'manual runs only'
        )}
      </PageHeader>

      <section className="mb-6 flex flex-wrap items-start gap-6">
        <div className="text-sm">
          <div className="text-xs text-muted-foreground">State</div>
          <AgentState agent={agent} />
          {agent.stoppedBy && <div className="max-w-xs text-xs text-muted-foreground">Only an admin can release this agent.</div>}
        </div>
        <ActionForm action={runAgentNowAction}>
          <input type="hidden" name="agentId" value={agent.id} />
          <Button type="submit">Run now</Button>
        </ActionForm>
        <ActionForm action={switchAgentAction}>
          <input type="hidden" name="agentId" value={agent.id} />
          <input type="hidden" name="enabled" value={String(!agent.enabled)} />
          <Button type="submit" variant="outline">
            {agent.enabled ? 'Pause' : 'Resume'}
          </Button>
        </ActionForm>
        <ActionForm action={deleteAgentAction} confirm={`Delete the agent "${agent.name}" and all its runs?`}>
          <input type="hidden" name="agentId" value={agent.id} />
          <Button type="submit" variant="outline">
            Delete
          </Button>
        </ActionForm>
      </section>

      <section className="mb-8 space-y-3">
        <h2 className="font-medium">Runs</h2>
        <Table head={['Started', 'Trigger', 'Status', 'Duration', 'Model tokens', 'Tool calls', 'Report']} empty={!runs.length}>
          {runs.map((run) => (
            <tr key={run.id}>
              <Cell className="whitespace-nowrap">{dateTime(run.startedAt)}</Cell>
              <Cell>{run.trigger}</Cell>
              <Cell>
                <RunStatus status={run.status} />
              </Cell>
              <Cell>{seconds(run.durationMs)}</Cell>
              <Cell>{run.modelTokens}</Cell>
              <Cell>{run.toolCalls}</Cell>
              <Cell className="max-w-xl">
                {run.error && <p className="text-sm text-destructive">{run.error}</p>}
                {run.outputMarkdown && (
                  <details>
                    <summary className="cursor-pointer text-xs underline">Show report</summary>
                    <pre className="mt-2 max-h-96 overflow-auto rounded bg-muted p-2 text-xs whitespace-pre-wrap">{run.outputMarkdown}</pre>
                  </details>
                )}
                {(run.files as { id: string; name: string }[]).map((file) => (
                  <div key={file.id} className="text-xs">
                    <a className="underline" href={`/agents/files/${file.id}`}>
                      {file.name}
                    </a>
                  </div>
                ))}
              </Cell>
            </tr>
          ))}
        </Table>
      </section>

      {!agent.stoppedBy && (
        <section className="space-y-3">
          <h2 className="font-medium">Edit</h2>
          <AgentForm action={updateAgentAction} agentId={agent.id} connections={connections} submit="Save" values={agent} />
        </section>
      )}
    </>
  );
}
