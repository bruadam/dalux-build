import Link from 'next/link';
import { setAuditRetentionAction } from '@/app/actions';
import { ActionForm } from '@/components/action-form';
import { Field, selectClass } from '@/components/field';
import { PageHeader } from '@/components/page-header';
import { dateTime } from '@/components/run-status';
import { Cell, Table } from '@/components/table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { AUDIT_PAGE_SIZE, listAudit, listAuditAccounts, parseAuditFilter } from '@/lib/server/auditLog';
import { listConnections } from '@/lib/server/connections';
import { db } from '@/lib/server/db';
import { requireAdmin } from '@/lib/server/session';
import { getAuditRetentionDays } from '@/lib/server/settings';

export const dynamic = 'force-dynamic';

const FILTER_KEYS = ['from', 'to', 'account', 'action', 'connection', 'status', 'kind'] as const;

export default async function AuditPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const actor = await requireAdmin();
  const params = await searchParams;
  const page = Math.max(0, Number(params.page) || 0);
  const [{ items, total }, connections, people, retention] = await Promise.all([
    listAudit(db(), actor, parseAuditFilter(params), page),
    listConnections(db()),
    listAuditAccounts(db(), actor),
    getAuditRetentionDays(db()),
  ]);
  const query = (extra: Record<string, string> = {}) =>
    new URLSearchParams(
      Object.entries({ ...Object.fromEntries(FILTER_KEYS.map((key) => [key, params[key] ?? ''])), ...extra }).filter(([, value]) => value),
    ).toString();

  return (
    <>
      <PageHeader title="Audit log">
        Every tool call (who, which Dalux user, client, connection, project, tool, capability, result, duration) and every admin
        change. It never holds tool arguments or document text.
      </PageHeader>
      <form method="get" className="mb-4 flex flex-wrap items-end gap-3">
        <Field label="From" htmlFor="audit-from">
          <Input id="audit-from" name="from" type="date" defaultValue={params.from} />
        </Field>
        <Field label="To" htmlFor="audit-to">
          <Input id="audit-to" name="to" type="date" defaultValue={params.to} />
        </Field>
        <Field label="Account" htmlFor="audit-account">
          <select id="audit-account" name="account" className={selectClass} defaultValue={params.account ?? ''}>
            <option value="">Any</option>
            {people.map((person) => (
              <option key={person.id} value={person.id}>
                {person.email ?? person.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Tool or action" htmlFor="audit-action">
          <Input id="audit-action" name="action" placeholder="search_file" defaultValue={params.action} />
        </Field>
        <Field label="Connection" htmlFor="audit-connection">
          <select id="audit-connection" name="connection" className={selectClass} defaultValue={params.connection ?? ''}>
            <option value="">Any</option>
            {connections.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Status" htmlFor="audit-status">
          <select id="audit-status" name="status" className={selectClass} defaultValue={params.status ?? ''}>
            <option value="">Any</option>
            <option value="ok">ok</option>
            <option value="denied">denied</option>
            <option value="error">error</option>
          </select>
        </Field>
        <Field label="Kind" htmlFor="audit-kind">
          <select id="audit-kind" name="kind" className={selectClass} defaultValue={params.kind ?? ''}>
            <option value="">Any</option>
            <option value="tool">Tool calls</option>
            <option value="admin">Admin changes</option>
          </select>
        </Field>
        <Button type="submit">Filter</Button>
        <Button asChild variant="outline">
          <a href={`/admin/audit/export?${query()}`}>Export CSV</a>
        </Button>
      </form>
      <p className="mb-2 text-sm text-muted-foreground">
        {total} matching rows{total > AUDIT_PAGE_SIZE ? `, showing ${page * AUDIT_PAGE_SIZE + 1}–${Math.min(total, (page + 1) * AUDIT_PAGE_SIZE)}` : ''}.
      </p>
      <Table head={['Time', 'Account', 'Client', 'Connection', 'Project', 'Action', 'Capability', 'Status', 'ms']} empty={!items.length}>
        {items.map((row) => (
          <tr key={row.id}>
            <Cell className="whitespace-nowrap">{dateTime(row.at)}</Cell>
            <Cell>
              {row.accountEmail ?? row.accountName ?? '—'}
              {row.daluxUserId && <div className="text-xs text-muted-foreground">Dalux {row.daluxUserId}</div>}
            </Cell>
            <Cell>{row.client ?? (row.kind === 'admin' ? 'web' : '—')}</Cell>
            <Cell>{row.connection ?? '—'}</Cell>
            <Cell>{row.projectId ?? '—'}</Cell>
            <Cell>
              <code>{row.action}</code>
              {row.targetType && (
                <div className="text-xs text-muted-foreground">
                  {row.targetType} {row.targetId}
                </div>
              )}
            </Cell>
            <Cell>{row.capability ?? '—'}</Cell>
            <Cell>
              {row.status ? <Badge variant={row.status === 'ok' ? 'secondary' : 'destructive'}>{row.status}</Badge> : '—'}
            </Cell>
            <Cell>{row.durationMs ?? '—'}</Cell>
          </tr>
        ))}
      </Table>
      <div className="mt-3 flex gap-3 text-sm">
        {page > 0 && (
          <Link className="underline" href={`/admin/audit?${query({ page: String(page - 1) })}`}>
            Newer
          </Link>
        )}
        {(page + 1) * AUDIT_PAGE_SIZE < total && (
          <Link className="underline" href={`/admin/audit?${query({ page: String(page + 1) })}`}>
            Older
          </Link>
        )}
      </div>
      <div className="mt-8 max-w-md space-y-2 text-sm">
        <h2 className="font-medium">Retention</h2>
        <p className="text-muted-foreground">
          The worker deletes audit rows older than this many days (checked hourly). Default 180.
        </p>
        <ActionForm action={setAuditRetentionAction}>
          <Field label="Days" htmlFor="audit-retention">
            <Input id="audit-retention" name="days" type="number" min={1} max={3650} defaultValue={retention} required />
          </Field>
          <Button type="submit" variant="outline">
            Save
          </Button>
        </ActionForm>
      </div>
    </>
  );
}
