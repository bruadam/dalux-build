import Link from 'next/link';
import { setAuditRetentionAction } from '@/app/actions';
import { ActionForm } from '@/components/action-form';
import { ActivityDetail } from '@/components/activity-detail';
import { ActivityOverviewPanel } from '@/components/activity-overview';
import { ActivityTable, AuthEventsTable } from '@/components/activity-table';
import { Field, selectClass } from '@/components/field';
import { PageHeader } from '@/components/page-header';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { activityOverview } from '@/lib/server/activity';
import { getActivityRow } from '@/lib/server/activityDetail';
import { AUDIT_PAGE_SIZE, listAudit, listAuditAccounts, parseAuditFilter } from '@/lib/server/auditLog';
import { listAuthEvents } from '@/lib/server/authEventsLog';
import { listConnections } from '@/lib/server/connections';
import { db } from '@/lib/server/db';
import { requireAdmin } from '@/lib/server/session';
import { getAuditRetentionDays } from '@/lib/server/settings';

export const dynamic = 'force-dynamic';

const FILTER_KEYS = ['from', 'to', 'account', 'type', 'action', 'connection', 'project', 'status', 'kind', 'ip', 'client'] as const;

export default async function ActivityPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const actor = await requireAdmin();
  const params = await searchParams;
  const page = Math.max(0, Number(params.page) || 0);
  const rowId = Number(params.row);
  const [{ items, total }, connections, people, retention, overview, failed, detail] = await Promise.all([
    listAudit(db(), actor, parseAuditFilter(params), page),
    listConnections(db()),
    listAuditAccounts(db(), actor),
    getAuditRetentionDays(db()),
    activityOverview(db(), actor),
    listAuthEvents(db(), actor),
    Number.isInteger(rowId) && rowId > 0 ? getActivityRow(db(), actor, rowId) : undefined,
  ]);
  const query = (extra: Record<string, string> = {}) =>
    new URLSearchParams(
      Object.entries({ ...Object.fromEntries(FILTER_KEYS.map((key) => [key, params[key] ?? ''])), ...extra }).filter(([, value]) => value),
    ).toString();

  return (
    <>
      <PageHeader title="Activity">
        Every tool call (who, client, IP address, connection, project, files, tool, outcome, size, duration) and every admin
        change. It never holds tool results, tokens or document text. Search text is stored only if you turned that on in
        Settings.
      </PageHeader>
      <ActivityOverviewPanel overview={overview} showAccounts />
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
        <Field label="Caller" htmlFor="audit-type">
          <select id="audit-type" name="type" className={selectClass} defaultValue={params.type ?? ''}>
            <option value="">Any</option>
            <option value="personal">Person</option>
            <option value="robot">Robot</option>
            <option value="agent">Hosted agent</option>
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
        <Field label="Project id" htmlFor="audit-project">
          <Input id="audit-project" name="project" defaultValue={params.project} />
        </Field>
        <Field label="Status" htmlFor="audit-status">
          <select id="audit-status" name="status" className={selectClass} defaultValue={params.status ?? ''}>
            <option value="">Any</option>
            <option value="ok">ok</option>
            <option value="denied">denied</option>
            <option value="error">error</option>
          </select>
        </Field>
        <Field label="IP starts with" htmlFor="audit-ip">
          <Input id="audit-ip" name="ip" placeholder="203.0.113." defaultValue={params.ip} />
        </Field>
        <Field label="Client" htmlFor="audit-client">
          <Input id="audit-client" name="client" placeholder="laptop" defaultValue={params.client} />
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
        <Button asChild variant="outline">
          <a href={`/admin/audit/export?${query({ format: 'json' })}`}>Export JSON</a>
        </Button>
      </form>
      <p className="mb-2 text-sm text-muted-foreground">
        {total} matching rows{total > AUDIT_PAGE_SIZE ? `, showing ${page * AUDIT_PAGE_SIZE + 1}–${Math.min(total, (page + 1) * AUDIT_PAGE_SIZE)}` : ''}.
      </p>
      <ActivityTable items={items} rowHref={(id) => `/admin/audit?${query({ page: String(page), row: String(id) })}`} />
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
      <h2 className="mt-8 mb-2 font-medium">Failed and unauthenticated attempts</h2>
      <p className="mb-2 text-sm text-muted-foreground">
        Invalid, expired or revoked tokens, disabled accounts, wrong connections, OAuth errors and failed sign-ins. Only the
        display prefix of a token is stored. The latest 50.
      </p>
      <AuthEventsTable items={failed} />
      <div className="mt-8 max-w-md space-y-2 text-sm">
        <h2 className="font-medium">Retention</h2>
        <p className="text-muted-foreground">
          The worker deletes audit rows and failed attempts older than this many days (checked hourly). Default 180. IP addresses
          are cleared earlier; see Settings.
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
      {detail && <ActivityDetail detail={detail} closeHref={`/admin/audit?${query({ page: String(page) })}`} />}
    </>
  );
}
