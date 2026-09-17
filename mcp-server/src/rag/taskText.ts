/**
 * Rendering a Dalux task (plus, optionally, its change history) into plain-text
 * lines suitable for keyword/BM25/embedding search.
 *
 * Shared between the ad-hoc `search_tasks` tool (tools/tasks.ts, no persistence)
 * and the persistent task index (rag/taskBuild.ts), so a task reads the same way
 * in both — the index is just the ad-hoc renderer with caching bolted on.
 *
 * Task payloads are loosely typed on the Dalux side (task *type* determines most
 * of the schema — see TaskSchema in dalux-build-api), so every field here is read
 * defensively and simply omitted from the rendered text when absent.
 */

import { createHash } from 'node:crypto';
import type { TextChunk } from '../extract';

/** One task attachment's extracted text, as produced by rag/taskAttachments.ts. */
export interface AttachmentText {
  fileName: string;
  chunks: readonly TextChunk[];
}

export function unwrapTask(raw: unknown): Record<string, unknown> {
  const record = (raw ?? {}) as Record<string, unknown>;
  return ((record.data as Record<string, unknown>) ?? record) as Record<string, unknown>;
}

export function str(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function nested(value: unknown, key: string): string | null {
  if (!value || typeof value !== 'object') return null;
  return str((value as Record<string, unknown>)[key]);
}

/**
 * One line per task field, one line per change with a non-empty description,
 * and one line per extracted attachment passage. `changes`/`attachments` may
 * both be empty — the ad-hoc search tool skips fetching them by default
 * since each one is an extra round of API calls (and, for attachments,
 * downloads + parsing) for a use case that is usually answered by the
 * task's own fields.
 */
export function renderTaskLines(
  task: Record<string, unknown>,
  changes: readonly Record<string, unknown>[],
  attachments: readonly AttachmentText[] = [],
): string[] {
  const lines: string[] = [];

  const header = [
    `Task ${str(task.number) ?? String(task.taskId ?? '')}`,
    str(task.subject) ?? str(task.title),
    nested(task.type, 'name') ? `type: ${nested(task.type, 'name')}` : null,
    str(task.usage) ? `usage: ${str(task.usage)}` : null,
    nested(task.workflow, 'name') ?? str(task.status)
      ? `status: ${nested(task.workflow, 'name') ?? str(task.status)}`
      : null,
    nested(task.createdBy, 'name') ? `created by: ${nested(task.createdBy, 'name')}` : null,
    str(task.created) ? `created: ${str(task.created)}` : null,
    str(task.deadline) ? `deadline: ${str(task.deadline)}` : null,
  ]
    .filter(Boolean)
    .join(' | ');
  lines.push(header);

  const description = str(task.description) ?? str(task.comment);
  if (description) lines.push(`Description: ${description}`);

  const udf = task.userDefinedFields;
  if (udf && typeof udf === 'object' && !Array.isArray(udf)) {
    for (const [key, value] of Object.entries(udf as Record<string, unknown>)) {
      if (value === null || value === undefined || value === '') continue;
      lines.push(`${key}: ${typeof value === 'string' ? value : JSON.stringify(value)}`);
    }
  }

  for (const change of changes) {
    const description = str(change.description);
    if (!description) continue;
    const timestamp = str(change.timestamp);
    const action = str(change.action);
    lines.push(`Change${timestamp ? ` (${timestamp})` : ''}${action ? ` [${action}]` : ''}: ${description}`);
  }

  for (const attachment of attachments) {
    for (const chunk of attachment.chunks) {
      const text = chunk.text.trim();
      if (!text) continue;
      lines.push(`Attachment "${attachment.fileName}"${chunk.location ? ` [${chunk.location}]` : ''}: ${text}`);
    }
  }

  return lines;
}

/**
 * Changes newer than the currently-indexed revision, any field edit, or the
 * set of attachments on the task (added/removed — not re-hashed by content,
 * since a changed attachment gets a new fileDownload URL rather than
 * mutating in place) invalidate the cached chunks/vectors.
 */
export function taskRevisionKey(
  task: Record<string, unknown>,
  changes: readonly Record<string, unknown>[],
  attachments: readonly Record<string, unknown>[] = [],
): string {
  const latestChangeTimestamp = changes.reduce((latest, change) => {
    const timestamp = str(change.timestamp) ?? '';
    return timestamp > latest ? timestamp : latest;
  }, '');
  return createHash('sha256')
    .update(JSON.stringify(task))
    .update('|')
    .update(String(changes.length))
    .update('|')
    .update(latestChangeTimestamp)
    .update('|')
    .update(JSON.stringify(attachments))
    .digest('hex')
    .slice(0, 16);
}

export function groupChangesByTaskId(changes: readonly Record<string, unknown>[]): Map<string, Record<string, unknown>[]> {
  const byTaskId = new Map<string, Record<string, unknown>[]>();
  for (const change of changes) {
    const taskId = change.taskId as string | undefined;
    if (!taskId) continue;
    byTaskId.set(taskId, [...(byTaskId.get(taskId) ?? []), change]);
  }
  return byTaskId;
}
