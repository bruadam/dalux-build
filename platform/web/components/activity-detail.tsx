import Link from 'next/link';
import { dateTime } from '@/components/run-status';
import { Badge } from '@/components/ui/badge';
import type { ActivityRow } from '@/lib/server/activityDetail';

function Item({ label, value }: { label: string; value: unknown }) {
  if (value === null || value === undefined || value === '') return null;
  return (
    <div className="grid grid-cols-[9rem_1fr] gap-2 py-1">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0 break-words">{String(value)}</dd>
    </div>
  );
}

/** Side panel with everything recorded about one call; `closeHref` is the list without the `row` parameter. */
export function ActivityDetail({ detail, closeHref }: { detail: ActivityRow; closeHref: string }) {
  const { row } = detail;
  return (
    <aside aria-label="Call details" className="fixed inset-y-0 right-0 z-10 w-[26rem] max-w-full overflow-y-auto border-l bg-background p-4 shadow-lg">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="font-semibold">
          <code>{row.action}</code>
        </h2>
        <Link href={closeHref} className="text-sm underline">
          Close
        </Link>
      </div>
      <dl className="text-sm">
        <Item label="Time" value={dateTime(row.at)} />
        <Item label="Status" value={row.status} />
        <Item label="Denial reason" value={row.denialReason} />
        <Item label="Error code" value={row.errorCode} />
        <Item label="Account" value={detail.accountEmail ?? detail.accountName} />
        <Item label="Account type" value={row.agentId ? 'agent' : detail.accountType} />
        <Item label="Hosted agent" value={row.agentName} />
        <Item label="Client" value={row.client} />
        <Item label="Sign-in method" value={row.authMethod} />
        <Item label="Credential id" value={row.credentialId} />
        <Item label="User agent" value={row.userAgent} />
        <Item label="IP address" value={row.clientIp} />
        <Item label="Forwarded chain" value={row.forwardedFor} />
        <Item label="MCP session" value={row.mcpSessionId} />
        <Item label="Request id" value={row.requestId} />
        <Item label="Connection" value={detail.connectionName} />
        <Item label="Project" value={row.projectId} />
        <Item label="File area" value={row.fileAreaId} />
        <Item label="Folder" value={row.folderId} />
        <Item label="Files" value={row.fileIds ? `${row.fileIds.join(', ')}${(row.fileCount ?? 0) > row.fileIds.length ? ` (${row.fileCount} in total)` : ''}` : null} />
        <Item label="Capability" value={row.capability} />
        <Item label="Items returned" value={row.resultItems} />
        <Item label="Result size" value={row.resultBytes === null ? null : `${row.resultBytes} bytes${row.resultTruncated ? ', truncated' : ''}`} />
        <Item label="Duration" value={row.durationMs === null ? null : `${row.durationMs} ms`} />
        <Item label="Dalux calls" value={row.daluxCalls} />
        <Item label="Dalux errors" value={row.daluxErrors} />
        <Item label="Dalux rate limits" value={row.daluxRateLimited} />
        <Item label="Mistral tokens" value={row.mistralTokens} />
        <Item label="Search text" value={row.queryText} />
        <Item label="Target" value={row.targetType ? `${row.targetType} ${row.targetId ?? ''}` : null} />
      </dl>
      {row.status && row.status !== 'ok' && (
        <p className="mt-3">
          <Badge variant="destructive">{row.status}</Badge>
        </p>
      )}
    </aside>
  );
}
