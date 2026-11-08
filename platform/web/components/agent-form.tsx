import type { FormState } from '@/lib/form-state';
import { Field, selectClass } from '@/components/field';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ActionForm } from '@/components/action-form';
import { AGENT_LIMITS, AGENT_TOOLSETS, CAPABILITIES, type HostedAgent } from '@/lib/server/agents';

type Values = Pick<HostedAgent, 'connectionId' | 'projectId' | 'name' | 'instructions' | 'schedule' | 'capabilities' | 'tools' | 'maxTokens' | 'maxToolCalls' | 'maxDurationSeconds'> & {
  template: string | null;
};

/** Create or edit form of a hosted agent. `agentId` set means edit. */
export function AgentForm({
  action,
  values,
  connections,
  agentId,
  submit,
}: {
  action: (state: FormState, form: FormData) => Promise<FormState>;
  values: Values;
  connections: { id: string; name: string }[];
  agentId?: string;
  submit: string;
}) {
  const id = agentId ?? 'new';
  return (
    <ActionForm action={action} className="space-y-4">
      {agentId && <input type="hidden" name="agentId" value={agentId} />}
      <input type="hidden" name="template" value={values.template ?? ''} />
      <Field label="Name" htmlFor={`${id}-name`}>
        <Input id={`${id}-name`} name="name" defaultValue={values.name} required maxLength={80} />
      </Field>
      <Field label="Connection" htmlFor={`${id}-connection`}>
        <select id={`${id}-connection`} name="connectionId" defaultValue={values.connectionId} className={selectClass} required>
          {connections.map((connection) => (
            <option key={connection.id} value={connection.id}>
              {connection.name}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Dalux project ID" htmlFor={`${id}-project`}>
        <Input id={`${id}-project`} name="projectId" defaultValue={values.projectId} required />
      </Field>
      <div className="basis-full">
        <label htmlFor={`${id}-instructions`} className="mb-1 block text-sm font-medium">
          Instructions
        </label>
        <textarea
          id={`${id}-instructions`}
          name="instructions"
          defaultValue={values.instructions}
          rows={9}
          maxLength={8000}
          required
          className="w-full min-w-80 rounded-md border border-input bg-transparent p-2 text-sm"
        />
      </div>
      <Field label="Schedule (cron, UTC; empty = manual only)" htmlFor={`${id}-schedule`}>
        <Input id={`${id}-schedule`} name="schedule" defaultValue={values.schedule ?? ''} placeholder="0 5 * * *" className="w-48 font-mono" />
      </Field>
      <fieldset className="basis-full">
        <legend className="mb-1 text-sm font-medium">Capabilities (at most what you hold on the project)</legend>
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
          {CAPABILITIES.map((capability) => (
            <label key={capability} className="flex items-center gap-1">
              <input type="checkbox" name="capabilities" value={capability} defaultChecked={values.capabilities.includes(capability)} />
              <code>{capability}</code>
            </label>
          ))}
        </div>
      </fieldset>
      <fieldset className="basis-full">
        <legend className="mb-1 text-sm font-medium">Tools the agent may call</legend>
        <div className="grid gap-2 text-sm">
          {AGENT_TOOLSETS.map((set) => (
            <details key={set.name} open={set.tools.some((tool) => values.tools.includes(tool))}>
              <summary className="cursor-pointer">{set.name}</summary>
              <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 pl-4">
                {set.tools.map((tool) => (
                  <label key={tool} className="flex items-center gap-1">
                    <input type="checkbox" name="tools" value={tool} defaultChecked={values.tools.includes(tool)} />
                    <code>{tool}</code>
                  </label>
                ))}
              </div>
            </details>
          ))}
        </div>
      </fieldset>
      <Field label="Max model tokens" htmlFor={`${id}-tokens`}>
        <Input id={`${id}-tokens`} name="maxTokens" type="number" min={AGENT_LIMITS.maxTokens.min} max={AGENT_LIMITS.maxTokens.max} defaultValue={values.maxTokens} className="w-32" />
      </Field>
      <Field label="Max tool calls" htmlFor={`${id}-calls`}>
        <Input id={`${id}-calls`} name="maxToolCalls" type="number" min={AGENT_LIMITS.maxToolCalls.min} max={AGENT_LIMITS.maxToolCalls.max} defaultValue={values.maxToolCalls} className="w-24" />
      </Field>
      <Field label="Max duration (seconds)" htmlFor={`${id}-duration`}>
        <Input id={`${id}-duration`} name="maxDurationSeconds" type="number" min={AGENT_LIMITS.maxDurationSeconds.min} max={AGENT_LIMITS.maxDurationSeconds.max} defaultValue={values.maxDurationSeconds} className="w-24" />
      </Field>
      <Button type="submit">{submit}</Button>
    </ActionForm>
  );
}
