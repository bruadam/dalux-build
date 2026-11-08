import { randomUUID } from 'node:crypto';

import { runWithCallStats } from '../observability/callStats';
import { logJson } from '../observability/log';
import { recordToolCall } from '../observability/metrics';
import { authorize } from './authorize';
import type { RequestContext } from './context';
import type { FolderLookup } from './folders';
import { TOOL_ACCESS } from './registry';
import { runWithContext } from './requestScope';

const MAX_FILE_IDS = 20;
/** Arguments that hold search or filter text; recorded only while the admin setting `log_query_text` is on. */
const QUERY_ARGS = ['query', 'fileNameContains', 'pathContains', 'projectName'];

/** One tool call, as written to the audit log. Holds no results and no document or task content. */
export interface ToolCallRecord {
  tool: string;
  capability: string;
  projectId?: string;
  fileAreaId?: string;
  folderId?: string;
  /** At most 20; `fileCount` has the real number. */
  fileIds?: string[];
  fileCount?: number;
  status: 'ok' | 'denied' | 'error';
  durationMs: number;
  denialReason?: string;
  errorCode?: string;
  resultItems?: number;
  resultBytes?: number;
  resultTruncated?: boolean;
  daluxCalls: number;
  daluxErrors: number;
  daluxRateLimited: number;
  mistralTokens: number;
  queryText?: string;
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

/** " (request id …)", added to error messages so support can find the call in the logs. */
export function requestIdNote(context: RequestContext): string {
  return context.request ? ` (request id ${context.request.requestId})` : '';
}

function touchedResources(tool: string, args: Record<string, unknown>) {
  let scopes: ReturnType<(typeof TOOL_ACCESS)[string]['scopes']> = [];
  try {
    scopes = TOOL_ACCESS[tool]?.scopes(args) ?? [];
  } catch {
    // The argument shape is the tool's business; a resolver that cannot read it tells us nothing to record.
  }
  const first = <K extends 'projectId' | 'fileAreaId' | 'folderId'>(key: K) => scopes.find((scope) => scope[key])?.[key];
  const fileIds = [...new Set(scopes.flatMap((scope) => (scope.fileId ? [scope.fileId] : [])))];
  return {
    projectId: first('projectId') ?? (typeof args.projectId === 'string' ? args.projectId : undefined),
    fileAreaId: first('fileAreaId'),
    folderId: first('folderId'),
    fileIds: fileIds.length ? fileIds.slice(0, MAX_FILE_IDS) : undefined,
    fileCount: fileIds.length || undefined,
  };
}

function queryText(args: Record<string, unknown>): string | undefined {
  const parts = QUERY_ARGS.flatMap((key) => (typeof args[key] === 'string' && args[key] ? [`${key}=${args[key]}`] : []));
  return parts.length ? parts.join(' ').slice(0, 300) : undefined;
}

/** The size of what the caller gets back: text and inline images. */
function resultBytes(result: unknown): number {
  const content = (result as { content?: { type?: string; text?: string; data?: string }[] }).content;
  if (!Array.isArray(content)) return 0;
  return content.reduce((total, part) => total + Buffer.byteLength(part.text ?? '') + (part.data?.length ?? 0), 0);
}

export function createToolGuard(context: RequestContext, options: ToolGuardOptions = {}): ToolGuard {
  return (tool, args, denied, call) =>
    runWithContext(context, () => runWithCallStats(async (stats) => {
      const startedAt = Date.now();
      const finish = (status: ToolCallRecord['status'], extra: { denialReason?: string; result?: unknown } = {}) => {
        const record: ToolCallRecord = {
          tool,
          capability: TOOL_ACCESS[tool]?.capability ?? 'none',
          ...touchedResources(tool, args),
          status,
          durationMs: Date.now() - startedAt,
          denialReason: extra.denialReason,
          errorCode: status === 'error' ? (stats.errorCode ?? 'tool_error') : undefined,
          resultItems: stats.resultItems,
          resultBytes: extra.result === undefined ? undefined : resultBytes(extra.result),
          resultTruncated: stats.resultTruncated,
          daluxCalls: stats.daluxCalls,
          daluxErrors: stats.daluxErrors,
          daluxRateLimited: stats.daluxRateLimited,
          mistralTokens: stats.mistralTokens,
          queryText: context.request?.logQueryText ? queryText(args) : undefined,
        };
        recordToolCall(record);
        logJson(
          {
            request_id: context.request?.requestId ?? randomUUID(),
            account_id: context.account?.id,
            auth_method: context.request?.authMethod,
            agent_id: context.request?.agent?.id,
            tool,
            connection: context.connection?.slug ?? context.connection?.id,
            project_id: record.projectId,
            status,
            duration_ms: record.durationMs,
            denial_reason: record.denialReason,
            error_code: record.errorCode,
            result_items: record.resultItems,
            result_bytes: record.resultBytes,
            dalux_calls: record.daluxCalls,
            ip: context.request?.ip,
          },
          status === 'ok' ? 'info' : status === 'denied' ? 'warn' : 'error',
        );
        options.audit?.(record);
      };

      const decision = await authorize(context, tool, args, options.folders);
      if (!decision.allowed) {
        finish('denied', { denialReason: decision.code });
        return denied(decision.reason + requestIdNote(context));
      }
      try {
        const result = await call();
        finish(result.isError ? 'error' : 'ok', { result });
        return result;
      } catch (error) {
        finish('error');
        throw error;
      }
    }));
}
