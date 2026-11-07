import { authorize } from './authorize';
import type { RequestContext } from './context';
import type { FolderLookup } from './folders';
import { TOOL_ACCESS } from './registry';
import { runWithContext } from './requestScope';

/** One tool call, as written to the audit log. Holds no arguments or results. */
export interface ToolCallRecord {
  tool: string;
  capability: string;
  projectId?: string;
  status: 'ok' | 'denied' | 'error';
  durationMs: number;
}

/**
 * Runs a tool call for the caller: access check first (`denied` builds the
 * refusal), then the call itself inside the caller's request scope.
 */
export type ToolGuard = <R extends { isError?: boolean }>(
  tool: string,
  args: Record<string, unknown>,
  denied: (reason: string) => R,
  call: () => Promise<R>,
) => Promise<R>;

export interface ToolGuardOptions {
  folders?: FolderLookup;
  audit?: (record: ToolCallRecord) => void;
}

export function createToolGuard(context: RequestContext, options: ToolGuardOptions = {}): ToolGuard {
  return (tool, args, denied, call) =>
    runWithContext(context, async () => {
      const startedAt = Date.now();
      const record = (status: ToolCallRecord['status']) =>
        options.audit?.({
          tool,
          capability: TOOL_ACCESS[tool]?.capability ?? 'none',
          projectId: typeof args.projectId === 'string' ? args.projectId : undefined,
          status,
          durationMs: Date.now() - startedAt,
        });

      const decision = await authorize(context, tool, args, options.folders);
      if (!decision.allowed) {
        record('denied');
        return denied(decision.reason);
      }
      try {
        const result = await call();
        record(result.isError ? 'error' : 'ok');
        return result;
      } catch (error) {
        record('error');
        throw error;
      }
    });
}
