import type { HostedAgent } from '@/lib/server/agents';

/** On, or why the agent is off. */
export function AgentState({ agent }: { agent: Pick<HostedAgent, 'enabled' | 'pausedReason'> }) {
  if (agent.enabled) return <span>On</span>;
  return (
    <span>
      Off
      {agent.pausedReason && <span className="block max-w-xs text-xs text-muted-foreground">{agent.pausedReason}</span>}
    </span>
  );
}
