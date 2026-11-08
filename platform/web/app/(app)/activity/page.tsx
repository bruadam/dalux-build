import Link from 'next/link';
import { ActivityDetail } from '@/components/activity-detail';
import { ActivityOverviewPanel } from '@/components/activity-overview';
import { ActivityTable, AuthEventsTable } from '@/components/activity-table';
import { Field, selectClass } from '@/components/field';
import { PageHeader } from '@/components/page-header';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { activityOverview } from '@/lib/server/activity';
import { getActivityRow } from '@/lib/server/activityDetail';
import { AUDIT_PAGE_SIZE, listOwnActivity, parseAuditFilter } from '@/lib/server/auditLog';
import { listAuthEvents } from '@/lib/server/authEventsLog';
import { db } from '@/lib/server/db';
import { requireActor } from '@/lib/server/session';

export const dynamic = 'force-dynamic';

const FILTER_KEYS = ['from', 'to', 'action', 'status'] as const;

/** Everyone sees their own calls and failed attempts; row-level security keeps other people's rows out. */
export default async function MyActivityPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const actor = await requireActor();
  const params = await searchParams;
  const page = Math.max(0, Number(params.page) || 0);
  const rowId = Number(params.row);
  const filter = { ...parseAuditFilter(params), kind: 'tool' as const };
  const [{ items, total }, overview, failed, detail] = await Promise.all([
    listOwnActivity(db(), actor, filter, page),
    activityOverview(db(), actor, { own: true }),
    listAuthEvents(db(), actor, true),
    Number.isInteger(rowId) && rowId > 0 ? getActivityRow(db(), actor, rowId) : undefined,
  ]);
  const query = (extra: Record<string, string> = {}) =>
    new URLSearchParams(
      Object.entries({ ...Object.fromEntries(FILTER_KEYS.map((key) => [key, params[key] ?? ''])), ...extra }).filter(([, value]) => value),
    ).toString();
  const visibleDetail = detail?.row.accountId === actor.accountId ? detail : undefined;

  return (
    <>
      <PageHeader title="My activity">
        What was done with your account, API tokens and connected apps: which tool, where from, and how it went. Search text and
        document content are not part of it. If something here is not yours, revoke the token on My tokens.
      </PageHeader>
      <ActivityOverviewPanel overview={overview} showAccounts={false} />
      <form method="get" className="mb-4 flex flex-wrap items-end gap-3">
        <Field label="From" htmlFor="mine-from">
          <Input id="mine-from" name="from" type="date" defaultValue={params.from} />
        </Field>
        <Field label="To" htmlFor="mine-to">
          <Input id="mine-to" name="to" type="date" defaultValue={params.to} />
        </Field>
        <Field label="Tool" htmlFor="mine-action">
          <Input id="mine-action" name="action" defaultValue={params.action} />
        </Field>
        <Field label="Status" htmlFor="mine-status">
          <select id="mine-status" name="status" className={selectClass} defaultValue={params.status ?? ''}>
            <option value="">Any</option>
            <option value="ok">ok</option>
            <option value="denied">denied</option>
            <option value="error">error</option>
          </select>
        </Field>
        <Button type="submit">Filter</Button>
        <Button asChild variant="outline">
          <a href={`/activity/export?${query()}`}>Export CSV</a>
        </Button>
        <Button asChild variant="outline">
          <a href={`/activity/export?${query({ format: 'json' })}`}>Export JSON</a>
        </Button>
      </form>
      <p className="mb-2 text-sm text-muted-foreground">
        {total} matching calls{total > AUDIT_PAGE_SIZE ? `, showing ${page * AUDIT_PAGE_SIZE + 1}–${Math.min(total, (page + 1) * AUDIT_PAGE_SIZE)}` : ''}.
      </p>
      <ActivityTable items={items} showAccount={false} rowHref={(id) => `/activity?${query({ page: String(page), row: String(id) })}`} />
      <div className="mt-3 flex gap-3 text-sm">
        {page > 0 && (
          <Link className="underline" href={`/activity?${query({ page: String(page - 1) })}`}>
            Newer
          </Link>
        )}
        {(page + 1) * AUDIT_PAGE_SIZE < total && (
          <Link className="underline" href={`/activity?${query({ page: String(page + 1) })}`}>
            Older
          </Link>
        )}
      </div>
      <h2 className="mt-8 mb-2 font-medium">Failed attempts with your credentials</h2>
      <AuthEventsTable items={failed} showAccount={false} />
      {visibleDetail && <ActivityDetail detail={visibleDetail} closeHref={`/activity?${query({ page: String(page) })}`} />}
    </>
  );
}
