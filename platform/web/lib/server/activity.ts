import { sql } from 'drizzle-orm';
import { withAccount, type Db } from '@dalux-platform/db';
import type { Actor } from './actor';

/** Thresholds for the account flags; every flag is one SQL query over the activity log. */
export const FLAG_RULES = {
  manyIps: { distinctIps: 5, hours: 24 },
  denialBurst: { denials: 20, minutes: 60 },
  callBurst: { calls: 500, minutes: 60 },
};

export type Flag = 'new_ip' | 'many_ips' | 'denial_burst' | 'call_burst';

export interface AccountFlag {
  accountId: string;
  accountName: string;
  flag: Flag;
  detail: string;
}

export interface ActivityOverview {
  days: number;
  callsPerDay: { day: string; calls: number }[];
  topTools: { tool: string; calls: number }[];
  topAccounts: { accountId: string; name: string; calls: number }[];
  totals: { calls: number; denied: number; errors: number; p50Ms: number | null; p95Ms: number | null; daluxRateLimited: number };
  flags: AccountFlag[];
}

type Row = Record<string, unknown>;

/** Everything here runs under the signed-in account, so row-level security shows people their own rows and admins all. */
export async function activityOverview(db: Db, actor: Actor, days = 14): Promise<ActivityOverview> {
  const since = new Date(Date.now() - days * 86_400_000);
  return withAccount(db, actor.accountId, async (tx) => {
    const rows = async (query: ReturnType<typeof sql>) => (await tx.execute(query)).rows as Row[];
    const [perDay, tools, accounts, [totals], flags] = await Promise.all([
      rows(sql`select to_char(date_trunc('day', at), 'YYYY-MM-DD') as day, count(*)::int as calls
        from audit_log where kind = 'tool' and at >= ${since} group by 1 order by 1`),
      rows(sql`select action as tool, count(*)::int as calls from audit_log
        where kind = 'tool' and at >= ${since} group by 1 order by 2 desc, 1 limit 8`),
      rows(sql`select a.account_id, coalesce(c.name, 'deleted account') as name, count(*)::int as calls
        from audit_log a left join accounts c on c.id = a.account_id
        where a.kind = 'tool' and a.at >= ${since} group by 1, 2 order by 3 desc, 2 limit 8`),
      rows(sql`select count(*)::int as calls,
          (count(*) filter (where status = 'denied'))::int as denied,
          (count(*) filter (where status = 'error'))::int as errors,
          percentile_cont(0.5) within group (order by duration_ms) as p50,
          percentile_cont(0.95) within group (order by duration_ms) as p95,
          coalesce(sum(dalux_rate_limited), 0)::int as rate_limited
        from audit_log where kind = 'tool' and at >= ${since}`),
      accountFlags(tx),
    ]);
    return {
      days,
      callsPerDay: perDay.map((r) => ({ day: String(r.day), calls: Number(r.calls) })),
      topTools: tools.map((r) => ({ tool: String(r.tool), calls: Number(r.calls) })),
      topAccounts: accounts.map((r) => ({ accountId: String(r.account_id), name: String(r.name), calls: Number(r.calls) })),
      totals: {
        calls: Number(totals.calls),
        denied: Number(totals.denied),
        errors: Number(totals.errors),
        p50Ms: totals.p50 === null ? null : Math.round(Number(totals.p50)),
        p95Ms: totals.p95 === null ? null : Math.round(Number(totals.p95)),
        daluxRateLimited: Number(totals.rate_limited),
      },
      flags,
    };
  });
}

type Executor = Pick<Parameters<Parameters<Db['transaction']>[0]>[0], 'execute'>;

/** Simple flags, no scoring: a new IP, one credential on many IPs, bursts of denials or of calls. */
export async function accountFlags(tx: Executor): Promise<AccountFlag[]> {
  const { manyIps, denialBurst, callBurst } = FLAG_RULES;
  const query = sql`
    select account_id, name, flag, detail from (
      select n.account_id, c.name, 'new_ip' as flag, 'first call from ' || string_agg(n.client_ip, ', ' order by n.client_ip) || ' in 24 h' as detail
      from (
        select distinct a.account_id, a.client_ip
        from audit_log a
        where a.kind = 'tool' and a.at >= now() - interval '24 hours' and a.client_ip is not null
          and exists (select 1 from audit_log o where o.account_id = a.account_id and o.kind = 'tool' and o.at < now() - interval '24 hours')
          and not exists (select 1 from audit_log o where o.account_id = a.account_id and o.client_ip = a.client_ip and o.at < now() - interval '24 hours')
      ) n join accounts c on c.id = n.account_id
      group by n.account_id, c.name
      union all
      select a.account_id, c.name, 'many_ips', count(distinct a.client_ip) || ' IP addresses on one credential in ${sql.raw(String(manyIps.hours))} h'
      from audit_log a join accounts c on c.id = a.account_id
      where a.kind = 'tool' and a.at >= now() - interval '${sql.raw(String(manyIps.hours))} hours' and a.client_ip is not null and a.credential_id is not null
      group by a.account_id, c.name, a.credential_id
      having count(distinct a.client_ip) >= ${manyIps.distinctIps}
      union all
      select a.account_id, c.name, 'denial_burst', count(*) || ' denied calls in ${sql.raw(String(denialBurst.minutes))} min'
      from audit_log a join accounts c on c.id = a.account_id
      where a.kind = 'tool' and a.status = 'denied' and a.at >= now() - interval '${sql.raw(String(denialBurst.minutes))} minutes'
      group by a.account_id, c.name having count(*) >= ${denialBurst.denials}
      union all
      select a.account_id, c.name, 'call_burst', count(*) || ' calls in ${sql.raw(String(callBurst.minutes))} min'
      from audit_log a join accounts c on c.id = a.account_id
      where a.kind = 'tool' and a.at >= now() - interval '${sql.raw(String(callBurst.minutes))} minutes'
      group by a.account_id, c.name having count(*) >= ${callBurst.calls}
    ) flags order by name, flag`;
  const { rows } = await tx.execute(query);
  return (rows as Row[]).map((r) => ({ accountId: String(r.account_id), accountName: String(r.name), flag: r.flag as Flag, detail: String(r.detail) }));
}

export const FLAG_LABELS: Record<Flag, string> = {
  new_ip: 'New IP address',
  many_ips: 'Many IP addresses',
  denial_burst: 'Burst of denials',
  call_burst: 'Burst of calls',
};
