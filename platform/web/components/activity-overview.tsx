import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { FLAG_LABELS, FLAG_RULES, type ActivityOverview } from '@/lib/server/activity';

const percent = (part: number, whole: number) => (whole ? `${((part / whole) * 100).toFixed(1)}%` : '0%');

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-lg border p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="text-lg font-semibold">{value}</div>
    </div>
  );
}

function Bars({ items }: { items: { label: string; value: number }[] }) {
  const max = Math.max(1, ...items.map((item) => item.value));
  return (
    <ul className="space-y-1 text-sm">
      {items.map((item) => (
        <li key={item.label} className="grid grid-cols-[10rem_1fr_3rem] items-center gap-2">
          <span className="truncate">{item.label}</span>
          <span className="h-2 rounded bg-primary/70" style={{ width: `${(item.value / max) * 100}%` }} />
          <span className="text-right text-muted-foreground">{item.value}</span>
        </li>
      ))}
    </ul>
  );
}

/** Calls per day, top tools and accounts, error and denial rates, latency and flags, from the filtered-out-of-nothing overview query. */
export function ActivityOverviewPanel({ overview, showAccounts }: { overview: ActivityOverview; showAccounts: boolean }) {
  const { totals } = overview;
  return (
    <div className="mb-6 space-y-4">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-6">
        <Stat label={`Calls, ${overview.days} days`} value={totals.calls} />
        <Stat label="Denied" value={percent(totals.denied, totals.calls)} />
        <Stat label="Errors" value={percent(totals.errors, totals.calls)} />
        <Stat label="Latency p50" value={totals.p50Ms === null ? '—' : `${totals.p50Ms} ms`} />
        <Stat label="Latency p95" value={totals.p95Ms === null ? '—' : `${totals.p95Ms} ms`} />
        <Stat label="Dalux rate limits" value={totals.daluxRateLimited} />
      </div>
      {overview.flags.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Flags</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1 text-sm">
            {overview.flags.map((flag) => (
              <p key={`${flag.accountId}-${flag.flag}`}>
                <strong>{FLAG_LABELS[flag.flag]}</strong>: {flag.accountName}, {flag.detail}
              </p>
            ))}
            <p className="pt-2 text-xs text-muted-foreground">
              Fixed rules, no scoring: a first-seen IP in 24 h; {FLAG_RULES.manyIps.distinctIps}+ IPs on one credential in{' '}
              {FLAG_RULES.manyIps.hours} h; {FLAG_RULES.denialBurst.denials}+ denials in {FLAG_RULES.denialBurst.minutes} min;{' '}
              {FLAG_RULES.callBurst.calls}+ calls in {FLAG_RULES.callBurst.minutes} min.
            </p>
          </CardContent>
        </Card>
      )}
      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle>Calls per day</CardTitle>
          </CardHeader>
          <CardContent>
            <Bars items={overview.callsPerDay.map((d) => ({ label: d.day, value: d.calls }))} />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Top tools</CardTitle>
          </CardHeader>
          <CardContent>
            <Bars items={overview.topTools.map((t) => ({ label: t.tool, value: t.calls }))} />
          </CardContent>
        </Card>
        {showAccounts && (
          <Card>
            <CardHeader>
              <CardTitle>Top accounts</CardTitle>
            </CardHeader>
            <CardContent>
              <Bars items={overview.topAccounts.map((a) => ({ label: a.name, value: a.calls }))} />
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
