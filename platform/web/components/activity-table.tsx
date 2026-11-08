import Link from 'next/link';
import { dateTime } from '@/components/run-status';
import { Cell, Table } from '@/components/table';
import { Badge } from '@/components/ui/badge';
import type { AuditRow } from '@/lib/server/auditLog';
import type { AuthEventRow } from '@/lib/server/authEventsLog';

/** Rows of the activity log; the time links to the detail panel (`rowHref(id)`). */
export function ActivityTable({ items, rowHref, showAccount = true }: { items: AuditRow[]; rowHref: (id: number) => string; showAccount?: boolean }) {
  const head = ['Time', ...(showAccount ? ['Account'] : []), 'Client', 'IP', 'Connection', 'Project', 'Action', 'Status', 'Result', 'ms'];
  return (
    <Table head={head} empty={!items.length}>
      {items.map((row) => (
        <tr key={row.id}>
          <Cell className="whitespace-nowrap">
            <Link className="underline" href={rowHref(row.id)}>
              {dateTime(row.at)}
            </Link>
          </Cell>
          {showAccount && (
            <Cell>
              {row.accountEmail ?? row.accountName ?? '—'}
              {row.agentName && <div className="text-xs text-muted-foreground">agent {row.agentName}</div>}
              {row.daluxUserId && <div className="text-xs text-muted-foreground">Dalux {row.daluxUserId}</div>}
            </Cell>
          )}
          <Cell>
            {row.client ?? (row.kind === 'admin' ? 'web' : '—')}
            {row.authMethod && <div className="text-xs text-muted-foreground">{row.authMethod}</div>}
          </Cell>
          <Cell>{row.clientIp ?? '—'}</Cell>
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
          <Cell>
            {row.status ? <Badge variant={row.status === 'ok' ? 'secondary' : 'destructive'}>{row.status}</Badge> : '—'}
            {(row.denialReason ?? row.errorCode) && <div className="text-xs text-muted-foreground">{row.denialReason ?? row.errorCode}</div>}
          </Cell>
          <Cell>{row.resultItems === null ? '—' : `${row.resultItems} items`}</Cell>
          <Cell>{row.durationMs ?? '—'}</Cell>
        </tr>
      ))}
    </Table>
  );
}

export function AuthEventsTable({ items, showAccount = true }: { items: AuthEventRow[]; showAccount?: boolean }) {
  const head = ['Time', 'Reason', ...(showAccount ? ['Account'] : []), 'Token', 'Connection', 'IP', 'Client', 'Request id'];
  return (
    <Table head={head} empty={!items.length}>
      {items.map((row) => (
        <tr key={row.id}>
          <Cell className="whitespace-nowrap">{dateTime(row.at)}</Cell>
          <Cell>
            <Badge variant="destructive">{row.reason}</Badge>
          </Cell>
          {showAccount && <Cell>{row.accountName ?? '—'}</Cell>}
          <Cell>{row.tokenPrefix ? <code>{row.tokenPrefix}…</code> : '—'}</Cell>
          <Cell>{row.connectionSlug ?? '—'}</Cell>
          <Cell>{row.clientIp ?? '—'}</Cell>
          <Cell className="max-w-48 truncate">{row.userAgent ?? '—'}</Cell>
          <Cell className="font-mono text-xs">{row.requestId ?? '—'}</Cell>
        </tr>
      ))}
    </Table>
  );
}
