import { and, eq, isNull, or } from 'drizzle-orm';
import {
  adminStopAgent,
  AgentError,
  createAgent,
  deleteAgent,
  effectiveAccess,
  requestAgentRun,
  setAgentEnabled,
  updateAgent,
  type AgentInput,
  type Db,
} from '@dalux-platform/db';
import { TOOL_ACCESS } from '../../../../mcp-server/src/access/registry';
import { TOOLSETS } from '../../../../mcp-server/src/toolsets';
import { CAPABILITIES, isCapability } from '../capabilities';
import { assertAdmin, audit, type Actor } from './actor';
import { UserError } from './errors';

export { AGENT_LIMITS, AGENT_TEMPLATES, getAgent, getRunFile, listAgents, listRuns, nextRunAt, type AgentRun, type HostedAgent } from '@dalux-platform/db';

/** Tools an agent can be given. Index builds are admin-only and memory switches belong to the person, not to an agent. */
const NOT_FOR_AGENTS = new Set(['memory_set_enabled', 'memory_forget', 'report_feedback', 'get_skill']);

export const AGENT_TOOLSETS = (['core', 'files', 'tasks', 'forms', 'quality', 'scheduling', 'search', 'consistency', 'memory'] as const).map((name) => ({
  name,
  tools: TOOLSETS[name].filter((tool) => !TOOL_ACCESS[tool]?.adminOnly && !NOT_FOR_AGENTS.has(tool)),
}));
const AGENT_TOOLS = new Set<string>(AGENT_TOOLSETS.flatMap((set) => set.tools));

export { CAPABILITIES };

const asUserError = async <T>(change: () => Promise<T>): Promise<T> => {
  try {
    return await change();
  } catch (error) {
    if (error instanceof AgentError) throw new UserError(error.message);
    throw error;
  }
};

/** An agent never gets more than its owner holds on the project (the worker also intersects at every run). */
async function checkAgentInput(db: Db, actor: Actor, input: AgentInput): Promise<void> {
  if (!input.tools.every((tool) => AGENT_TOOLS.has(tool))) throw new UserError('One of the chosen tools is not available to agents');
  if (!input.capabilities.every(isCapability)) throw new UserError('Unknown capability');
  const held = await db
    .select({ capability: effectiveAccess.capability })
    .from(effectiveAccess)
    .where(
      and(
        eq(effectiveAccess.accountId, actor.accountId),
        eq(effectiveAccess.connectionId, input.connectionId),
        or(isNull(effectiveAccess.projectId), eq(effectiveAccess.projectId, input.projectId.trim())),
      ),
    );
  const heldNames = new Set(held.map((row) => row.capability));
  const missing = input.capabilities.filter((capability) => !heldNames.has(capability));
  if (missing.length) throw new UserError(`You do not hold ${missing.join(', ')} on this project, so the agent cannot have it`);
}

export async function createOwnAgent(db: Db, actor: Actor, input: AgentInput): Promise<string> {
  await checkAgentInput(db, actor, input);
  return asUserError(() => createAgent(db, actor.accountId, input));
}

export async function updateOwnAgent(db: Db, actor: Actor, id: string, input: AgentInput): Promise<void> {
  await checkAgentInput(db, actor, input);
  await asUserError(() => updateAgent(db, actor.accountId, id, input));
}

export const switchAgent = (db: Db, actor: Actor, id: string, enabled: boolean) => asUserError(() => setAgentEnabled(db, actor.accountId, id, enabled));
export const runAgentNow = (db: Db, actor: Actor, id: string) => asUserError(() => requestAgentRun(db, actor.accountId, id));
export const deleteOwnAgent = (db: Db, actor: Actor, id: string) => deleteAgent(db, actor.accountId, id);

export async function stopAnyAgent(db: Db, actor: Actor, id: string, stop: boolean): Promise<void> {
  assertAdmin(actor);
  await asUserError(() => adminStopAgent(db, actor.accountId, id, stop));
  await audit(db, actor, stop ? 'agent.stop' : 'agent.release', 'hosted_agent', id);
}

/** An agent's form fields as the shared input type. */
export function agentInputFrom(form: FormData): AgentInput {
  const text = (name: string) => String(form.get(name) ?? '');
  const number = (name: string) => (text(name).trim() ? Number(text(name)) : undefined);
  return {
    connectionId: text('connectionId'),
    projectId: text('projectId'),
    name: text('name'),
    template: text('template') || null,
    instructions: text('instructions'),
    schedule: text('schedule').trim() || null,
    capabilities: form.getAll('capabilities').map(String),
    tools: form.getAll('tools').map(String),
    maxTokens: number('maxTokens'),
    maxToolCalls: number('maxToolCalls'),
    maxDurationSeconds: number('maxDurationSeconds'),
  };
}
