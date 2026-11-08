/**
 * `dalux-mcp worker` (platform mode): runs index scopes, Dalux user matching
 * and hosted agents as pg-boss jobs in Postgres, connected as the `worker` role.
 * A cron job every minute queues what is due: scheduled or "Refresh now"
 * scopes, connections whose Dalux users are new, a day old, or requested, and
 * "Run now" requests of hosted agents (each agent has its own schedule).
 * Hosted agents use the MCP tool layer in process, as the `mcp` role (DATABASE_URL).
 */

import { eq } from 'drizzle-orm';
import type { PgBoss } from 'pg-boss';
import { createClient } from 'dalux-build-api';
import { clearExpiredIps, connections, createDb, decryptSecret, loadEncryptionKey, settings, type Db } from '@dalux-platform/db';
import { validateDaluxBaseUrl } from '../daluxUrl';
import { logJson } from '../observability/log';
import { postgresIndexStores } from '../store/postgres';
import { setAccountIndexStores, setIndexStores } from '../store';
import { mistralChat } from '../agents/chat';
import { failInterruptedAgentRuns, type AgentDeps } from '../agents/run';
import { AGENT_QUEUE, AGENT_QUEUE_OPTIONS, handleAgentJob, tickAgents, type AgentJob } from '../agents/worker';
import { Platform } from '../platform/platform';
import { purgeAuditLog } from './auditRetention';
import { dueConnections, matchConnection, syncConnectionUsers } from './daluxUsers';
import { dueScopes, failInterruptedRuns, runScope, type RunTrigger, type WorkerDeps } from './indexScopes';

const QUEUES = { tick: 'tick', index: 'index-scope', users: 'dalux-users', ipRetention: 'ip-retention', auditPurge: 'audit-purge' } as const;

export function workerDeps(db: Db, encryptionKey: Buffer, env: NodeJS.ProcessEnv = process.env): WorkerDeps {
  return {
    db,
    async clientFor(connectionId) {
      const [row] = await db.select().from(connections).where(eq(connections.id, connectionId));
      if (!row) throw new Error(`Connection ${connectionId} not found`);
      const validated = validateDaluxBaseUrl(row.baseUrl);
      if ('error' in validated) throw new Error(`Connection ${row.slug}: base URL ${validated.error}`);
      return createClient({ baseUrl: validated.baseUrl, apiKey: decryptSecret(row.apiKeyEncrypted, encryptionKey) });
    },
    async embeddingKey() {
      const [row] = await db.select({ key: settings.embeddingKeyEncrypted }).from(settings);
      return row?.key ? decryptSecret(row.key, encryptionKey) : null;
    },
    // Same variables as the docs index tools; only needed for private repos.
    docsToken: env.DOCS_GITHUB_TOKEN ?? env.GITHUB_TOKEN ?? null,
  };
}

/**
 * Hosted agents call the tools as the `mcp` role under the owner's account, so row-level security applies to
 * memory and index reads exactly as for a person. Without DATABASE_URL they are off.
 */
function agentDeps(db: Db, env: NodeJS.ProcessEnv): AgentDeps | null {
  if (!env.DATABASE_URL) return null;
  const mcp = createDb(env.DATABASE_URL);
  const { search, build } = postgresIndexStores({ mcp, worker: db });
  setAccountIndexStores(search, build);
  return { db, platform: new Platform(mcp, loadEncryptionKey(env.PLATFORM_ENCRYPTION_KEY)), chat: mistralChat };
}

/** Queues due scopes and user syncs, and re-matches every connection (picks up new accounts within a minute). */
export async function tick(boss: Pick<PgBoss, 'send'>, db: Db): Promise<void> {
  for (const scope of await dueScopes(db)) {
    await boss.send(QUEUES.index, scope, { singletonKey: scope.id });
  }
  const due = new Set(await dueConnections(db));
  for (const connectionId of due) {
    await boss.send(QUEUES.users, { connectionId }, { singletonKey: connectionId });
  }
  const all = await db.select({ id: connections.id }).from(connections);
  for (const { id } of all) {
    if (!due.has(id)) await matchConnection(db, id);
  }
}

export async function startWorker(env: NodeJS.ProcessEnv = process.env): Promise<PgBoss> {
  const url = env.DATABASE_URL_WORKER ?? env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL_WORKER (the worker database role) is required.');
  const db = createDb(url);
  const deps = workerDeps(db, loadEncryptionKey(env.PLATFORM_ENCRYPTION_KEY), env);
  // Builders write through the Postgres store as the worker role; reads also need every document.
  const { build } = postgresIndexStores({ mcp: db, worker: db });
  setIndexStores(build, build);
  await failInterruptedRuns(db);
  await failInterruptedAgentRuns(db);

  // The `pgboss` schema is created by migration 0008 and owned by the worker role.
  // pg-boss is ESM-only; this server builds to CJS, so it is loaded with a runtime import().
  const { PgBoss } = await import('pg-boss');
  const boss = new PgBoss({ connectionString: url, schema: 'pgboss', createSchema: false });
  boss.on('error', (error) => console.error('[worker]', error));
  await boss.start();
  await boss.createQueue(QUEUES.tick, { policy: 'stately', retryLimit: 0 });
  // stately + singletonKey: at most one queued and one running job per scope or connection.
  // The heartbeat fails the running job of a stopped worker within a minute, so it does not block its key.
  await boss.createQueue(QUEUES.index, { policy: 'stately', retryLimit: 0, expireInSeconds: 4 * 3600, heartbeatSeconds: 60 });
  await boss.createQueue(QUEUES.users, { policy: 'stately', retryLimit: 1, expireInSeconds: 3600, heartbeatSeconds: 60 });
  await boss.createQueue(QUEUES.auditPurge, { policy: 'stately', retryLimit: 0 });

  const agents = agentDeps(db, env);
  if (agents) await boss.createQueue(AGENT_QUEUE, AGENT_QUEUE_OPTIONS);
  else console.error('[worker] DATABASE_URL (the mcp database role) is not set: hosted agents are off.');

  await boss.createQueue(QUEUES.ipRetention, { policy: 'stately', retryLimit: 0 });
  await boss.work<Record<string, never>>(QUEUES.ipRetention, async () => {
    const cleared = await clearExpiredIps(db);
    if (cleared) logJson({ event: 'ip_retention', cleared_rows: cleared });
  });
  await boss.schedule(QUEUES.ipRetention, '23 * * * *');

  await boss.work<Record<string, never>>(QUEUES.tick, async () => {
    await tick(boss, db);
    if (agents) await tickAgents(boss, db);
  });
  if (agents) {
    await boss.work<AgentJob>(AGENT_QUEUE, { localConcurrency: 2, includeMetadata: true }, async ([job]) => {
      await handleAgentJob(agents, job.data, job.retryCount);
    });
  }
  await boss.work<{ id: string; trigger: RunTrigger }>(QUEUES.index, { localConcurrency: 1 }, async ([job]) => {
    await runScope(deps, job.data.id, job.data.trigger);
  });
  await boss.work<{ connectionId: string }>(QUEUES.users, async ([job]) => {
    await syncConnectionUsers(db, job.data.connectionId, () => deps.clientFor(job.data.connectionId));
  });
  await boss.work<Record<string, never>>(QUEUES.auditPurge, async () => {
    const deleted = await purgeAuditLog(db);
    if (deleted) console.error(`[worker] purged ${deleted} audit rows past the retention period`);
  });
  await boss.schedule(QUEUES.tick, '* * * * *');
  await boss.schedule(QUEUES.auditPurge, '17 * * * *');
  await boss.send(QUEUES.tick, {});
  return boss;
}
