/**
 * Optional live run of a hosted agent against real Mistral and a real Dalux connection (not part of the test suite).
 *
 *   DALUX_LIVE_AGENT_SOURCE=postgres://... PLATFORM_ENCRYPTION_KEY=... TEST_DATABASE_URL=... npx tsx scripts/live-agent.ts [template]
 *
 * DALUX_LIVE_AGENT_SOURCE is a platform database whose settings hold the Mistral key and which has a connection; both
 * are copied, still encrypted, into a throwaway database on TEST_DATABASE_URL's server. Nothing is written to the
 * source. Prints status, counts and the audit summary, never project content.
 */
import { Pool } from 'pg';
import { AGENT_TEMPLATES, createAgent } from '@dalux-platform/db';
import { createTestDatabase } from '../../platform/db/test/testDatabase';
import { mistralChat } from '../src/agents/chat';
import { runAgent } from '../src/agents/run';
import { Platform } from '../src/platform/platform';

async function main() {
  const from = new Pool({ connectionString: process.env.DALUX_LIVE_AGENT_SOURCE, max: 1 });
  const [connection] = (await from.query('SELECT name, slug, base_url, api_key_encrypted, api_key_last4 FROM connections LIMIT 1')).rows;
  const [{ embedding_key_encrypted: key }] = (await from.query('SELECT embedding_key_encrypted FROM settings')).rows;
  await from.end();

  const database = await createTestDatabase();
  try {
    const { owner } = database;
    const { rows: [site] } = await owner.query(
      'INSERT INTO connections (name, slug, base_url, api_key_encrypted, api_key_last4) VALUES ($1, $2, $3, $4, $5) RETURNING id',
      [connection.name, connection.slug, connection.base_url, connection.api_key_encrypted, connection.api_key_last4],
    );
    await owner.query('INSERT INTO settings (id, embedding_key_encrypted) VALUES (true, $1)', [key]);
    const { rows: [alice] } = await owner.query("INSERT INTO accounts (type, email, name, role) VALUES ('personal', 'alice@example.com', 'alice', 'user') RETURNING id");
    await owner.query("INSERT INTO grants (account_id, connection_id, capabilities) VALUES ($1, $2, ARRAY['projects:read', 'tasks:read'])", [alice.id, site.id]);
    await owner.query('SELECT refresh_effective_access()');

    const platform = new Platform(database.as('mcp'), Buffer.from(process.env.PLATFORM_ENCRYPTION_KEY!, 'base64'));
    const projects = (await (await platform.connectionById(site.id))!.client.projects.listProjects())?.items ?? [];
    const projectId = String((projects[0] as { projectId: string }).projectId);

    const template = AGENT_TEMPLATES.find((t) => t.id === (process.argv[2] ?? 'overdue-tasks'))!;
    const agent = await createAgent(database.as('web'), alice.id, {
      connectionId: site.id,
      projectId,
      name: template.name,
      template: template.id,
      instructions: template.instructions,
      schedule: null,
      capabilities: template.capabilities.filter((c) => c !== 'memory:write' && c !== 'memory:read' && c !== 'files:read'),
      tools: template.tools.filter((t) => !t.startsWith('memory_') && !t.includes('file')),
      maxTokens: 60_000,
      maxToolCalls: 12,
      maxDurationSeconds: 300,
    });
    const outcome = await runAgent({ db: database.as('worker'), platform, chat: mistralChat }, agent, 'manual');
    await new Promise((resolve) => setTimeout(resolve, 1000));
    const { rows: [run] } = await owner.query('SELECT status, model_tokens, tool_calls, duration_ms, error, length(output_markdown) AS output_chars FROM agent_runs WHERE id = $1', [outcome!.runId]);
    const { rows: audit } = await owner.query("SELECT action, status, client, count(*) FROM audit_log WHERE kind = 'tool' GROUP BY 1, 2, 3 ORDER BY 1");
    console.log('LIVE RUN', JSON.stringify({ template: template.id, run, audit }, null, 1));
  } finally {
    await database.drop();
  }
}

main().then(() => process.exit(0), (error) => { console.error(error); process.exit(1); });
