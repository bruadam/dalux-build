/** Hosted agent jobs in the worker: one pg-boss schedule per agent, "Run now" requests, and the job handler. */
import { and, eq, isNotNull, isNull } from 'drizzle-orm';
import type { PgBoss } from 'pg-boss';
import { hostedAgents, type Db } from '@dalux-platform/db';

import { runAgent, type AgentDeps, type AgentRunTrigger } from './run';

export const AGENT_QUEUE = 'agent-run';

export interface AgentJob {
  agentId: string;
  trigger: 'schedule' | 'manual';
}

/** One run at a time per agent; a failed run is retried once after five minutes (and three failures in a row pause the agent). */
export const AGENT_QUEUE_OPTIONS = {
  policy: 'stately',
  retryLimit: 1,
  retryDelay: 300,
  retryBackoff: true,
  expireInSeconds: 2 * 3600,
  heartbeatSeconds: 60,
} as const;

type Scheduler = Pick<PgBoss, 'send' | 'schedule' | 'unschedule' | 'getSchedules'>;

/**
 * Makes the pg-boss schedules match the agents: one per enabled agent with a cron, keyed by agent id, and
 * queues the runs the interface asked for with "Run now".
 */
export async function tickAgents(boss: Scheduler, db: Db): Promise<void> {
  const scheduled = await db
    .select({ id: hostedAgents.id, schedule: hostedAgents.schedule })
    .from(hostedAgents)
    .where(and(eq(hostedAgents.enabled, true), isNull(hostedAgents.stoppedBy), isNotNull(hostedAgents.schedule)));
  const wanted = new Map(scheduled.map((agent) => [agent.id, agent.schedule!]));
  const existing = await boss.getSchedules(AGENT_QUEUE);

  for (const [agentId, cron] of wanted) {
    if (existing.find((schedule) => schedule.key === agentId)?.cron === cron) continue;
    await boss.schedule(AGENT_QUEUE, cron, { agentId, trigger: 'schedule' } satisfies AgentJob, { key: agentId, tz: 'UTC' });
  }
  for (const schedule of existing) {
    if (!wanted.has(schedule.key)) await boss.unschedule(AGENT_QUEUE, schedule.key);
  }

  const requested = await db
    .select({ id: hostedAgents.id })
    .from(hostedAgents)
    .where(and(isNotNull(hostedAgents.runRequestedAt), isNull(hostedAgents.stoppedBy)));
  for (const { id } of requested) {
    await boss.send(AGENT_QUEUE, { agentId: id, trigger: 'manual' } satisfies AgentJob, { singletonKey: id });
    await db.update(hostedAgents).set({ runRequestedAt: null }).where(eq(hostedAgents.id, id));
  }
}

/** The job handler: throws after a failed scheduled run so pg-boss retries it with backoff. */
export async function handleAgentJob(deps: AgentDeps, job: AgentJob, retryCount: number): Promise<void> {
  const trigger: AgentRunTrigger = retryCount > 0 ? 'retry' : job.trigger;
  const outcome = await runAgent(deps, job.agentId, trigger);
  if (outcome?.status === 'failed' && !outcome.paused && job.trigger === 'schedule') throw new Error(outcome.error ?? 'The agent run failed.');
}
