import { notFound } from 'next/navigation';
import { refreshIndexScopeAction } from '@/app/actions';
import { ActionForm } from '@/components/action-form';
import { PageHeader } from '@/components/page-header';
import { dateTime, RunStatus } from '@/components/run-status';
import { Cell, Table } from '@/components/table';
import { Button } from '@/components/ui/button';
import { db } from '@/lib/server/db';
import { getIndexScope, listIndexRuns } from '@/lib/server/indexScopes';
import { requireAdmin } from '@/lib/server/session';

/** Skipped: `{ reason, count, examples }`; failed: `{ fileName, error }`; warnings: strings. */
function describe(item: unknown): string {
  if (typeof item === 'string') return item;
  const row = item as { reason?: string; count?: number; examples?: string[]; fileName?: string; error?: string };
  if (row.reason) return `${row.count ?? 1} × ${row.reason}${row.examples?.length ? ` (e.g. ${row.examples.join(', ')})` : ''}`;
  if (row.error) return `${row.fileName ?? 'item'}: ${row.error}`;
  return JSON.stringify(item);
}

function Problems({ label, items }: { label: string; items: unknown }) {
  const list = Array.isArray(items) ? items : [];
  if (!list.length) return null;
  return (
    <details>
      <summary>
        {list.length} {label}
      </summary>
      <ul className="mt-1 space-y-1 text-xs">
        {list.map((item, index) => (
          <li key={index}>
            <span className="break-all">{describe(item)}</span>
          </li>
        ))}
      </ul>
    </details>
  );
}

export default async function IndexScopePage({ params }: { params: Promise<{ id: string }> }) {
  await requireAdmin();
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const scope = await getIndexScope(db(), id);
  if (!scope) notFound();
  const runs = await listIndexRuns(db(), id);
  return (
    <>
      <PageHeader title={scope.name}>
        {scope.kind} index on {scope.connectionName} · {scope.enabled ? `every ${scope.intervalMinutes / 60} h` : 'schedule off'} ·{' '}
        <code>{JSON.stringify(scope.scope)}</code>
      </PageHeader>
      <ActionForm action={refreshIndexScopeAction} className="mb-6">
        <input type="hidden" name="scopeId" value={scope.id} />
        <Button type="submit">Refresh now</Button>
      </ActionForm>
      <h2 className="mb-2 font-medium">Runs (last 20)</h2>
      <Table head={['Started', 'Status', 'Duration', 'Items', 'Chunks', 'Embedding', 'Details']} empty={!runs.length}>
        {runs.map((run) => (
          <tr key={run.id}>
            <Cell>
              {dateTime(run.startedAt)}
              <div className="text-xs text-muted-foreground">{run.trigger}</div>
            </Cell>
            <Cell>
              <RunStatus status={run.status} />
            </Cell>
            <Cell>{run.durationMs === null ? '—' : `${Math.round(run.durationMs / 1000)} s`}</Cell>
            <Cell className="text-xs">
              {run.itemsInScope !== null && (
                <>
                  {run.itemsIndexed} indexed, {run.itemsReused} unchanged of {run.itemsInScope}
                  {!!run.itemsRemoved && <div>{run.itemsRemoved} removed</div>}
                  {!!run.itemsPending && <div>{run.itemsPending} pending</div>}
                </>
              )}
            </Cell>
            <Cell>{run.totalChunks ?? '—'}</Cell>
            <Cell className="text-xs">
              {run.embeddingModel ? (
                <>
                  {run.embeddingModel}
                  <div>
                    {run.embeddingTokens} tokens{run.embeddingTokensEstimated ? ' (estimated)' : ''}
                  </div>
                </>
              ) : run.status === 'running' || run.status === 'failed' ? (
                '—'
              ) : (
                'lexical only'
              )}
            </Cell>
            <Cell className="text-xs">
              {run.error && <div className="text-destructive">{run.error}</div>}
              <Problems label="skipped" items={run.skipped} />
              <Problems label="failed" items={run.failed} />
              <Problems label="warnings" items={run.warnings} />
            </Cell>
          </tr>
        ))}
      </Table>
    </>
  );
}
