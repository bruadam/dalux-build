/**
 * Task view models.
 *
 * Dalux task list items are loosely typed (the client's `TaskSchema` only
 * types `taskId`). `toTaskSummary` reads the fields of the published task
 * schema: taskId, number, subject, usage, type, workflow, created, createdBy
 * and userDefinedFields.
 *
 * Status, current responsible, assignee, deadline and work package are not on
 * the task itself. They come from the task change history (the client's typed
 * `TaskChangeSchema`), folded per task by `foldTaskChanges`.
 */

import type { RankField } from "./rank";

export interface TaskSummary {
  taskId: string;
  number?: string;
  subject?: string;
  usage?: string;
  typeName?: string;
  workflowName?: string;
  created?: string;
  createdByUserId?: string;
  userDefinedFields: { name: string; value: string }[];
}

export interface TaskComment {
  timestamp: string;
  action?: string;
  text: string;
  userId?: string;
}

export interface TaskState {
  status?: string;
  responsibleUserId?: string;
  assignedTo?: string;
  workpackageId?: string;
  deadline?: string;
  lastChangeAt?: string;
  lastModifiedByUserId?: string;
  comments: TaskComment[];
}

/** Matches the client's `TaskChangeActorSchema`. */
interface ChangeActor {
  userId?: string | null;
  roleId?: string | null;
  roleName?: string | null;
  userName?: string | null;
  name?: string | null;
}

/** The subset of the client's `TaskChangeSchema` used here. */
export interface TaskChange {
  taskId: string;
  description?: string | null;
  timestamp: string;
  action: string;
  fields?: {
    currentResponsible?: ChangeActor | null;
    assignedTo?: ChangeActor | null;
    deadline?: string | null;
    status?: string | null;
    modifiedBy?: ChangeActor | null;
    workpackageId?: string | null;
  } | null;
}

const MAX_COMMENTS = 5;
const MAX_COMMENT_CHARS = 500;

function str(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function child(value: unknown, key: string): unknown {
  return value && typeof value === "object" ? (value as Record<string, unknown>)[key] : undefined;
}

/** Flattens a user-defined field value of any shape into display text. */
export function formatFieldValue(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return String(value);
  const parts = Array.isArray(value) ? value : Object.values(value as Record<string, unknown>);
  return parts.map(formatFieldValue).filter(Boolean).join(", ");
}

export function toTaskSummary(raw: unknown): TaskSummary | undefined {
  const data = (child(raw, "data") ?? raw) as Record<string, unknown> | undefined;
  const taskId = str(data?.taskId);
  if (!data || !taskId) return undefined;

  const fieldItems = child(data.userDefinedFields, "items");
  const userDefinedFields = (Array.isArray(fieldItems) ? fieldItems : [])
    .map((field) => ({
      name: str(child(field, "name")) ?? str(child(field, "key")) ?? "",
      value: formatFieldValue(child(field, "values")),
    }))
    .filter((field) => field.name && field.value);

  return {
    taskId,
    number: str(data.number),
    subject: str(data.subject),
    usage: str(data.usage),
    typeName: str(child(data.type, "name")),
    workflowName: str(child(data.workflow, "name")),
    created: str(data.created),
    createdByUserId: str(child(data.createdBy, "userId")),
    userDefinedFields,
  };
}

function actorLabel(actor: ChangeActor | null | undefined): string | undefined {
  return str(actor?.roleName) ?? str(actor?.userName) ?? str(actor?.name);
}

/** Folds a change history into the latest known state per task id. */
export function foldTaskChanges(changes: readonly TaskChange[]): Record<string, TaskState> {
  const states: Record<string, TaskState> = {};
  const ordered = [...changes].sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  for (const change of ordered) {
    const state = (states[change.taskId] ??= { comments: [] });
    const fields = change.fields ?? {};
    state.lastChangeAt = change.timestamp;
    state.status = str(fields.status) ?? state.status;
    state.deadline = str(fields.deadline) ?? state.deadline;
    state.workpackageId = str(fields.workpackageId) ?? state.workpackageId;
    state.lastModifiedByUserId = str(fields.modifiedBy?.userId) ?? state.lastModifiedByUserId;
    if (fields.currentResponsible) state.responsibleUserId = str(fields.currentResponsible.userId);
    if (fields.assignedTo) state.assignedTo = actorLabel(fields.assignedTo) ?? str(fields.assignedTo.userId);

    const text = str(change.description);
    if (text) {
      state.comments.unshift({
        timestamp: change.timestamp,
        action: str(change.action),
        text: text.length > MAX_COMMENT_CHARS ? `${text.slice(0, MAX_COMMENT_CHARS)}…` : text,
        userId: str(fields.modifiedBy?.userId),
      });
      state.comments.length = Math.min(state.comments.length, MAX_COMMENTS);
    }
  }
  return states;
}

export function isClosed(state: TaskState | undefined): boolean {
  return state?.status?.toLowerCase() === "closed";
}

export interface TaskContext {
  state?: TaskState;
  responsibleName?: string;
  workPackageName?: string;
}

export function taskRankFields(task: TaskSummary, context: TaskContext): RankField[] {
  return [
    { text: task.number, weight: 3 },
    { text: task.subject, weight: 3 },
    { text: task.typeName, weight: 1.5 },
    { text: context.responsibleName, weight: 1.5 },
    { text: task.workflowName, weight: 1 },
    { text: task.usage, weight: 1 },
    { text: context.state?.status, weight: 1 },
    { text: context.workPackageName, weight: 1 },
    ...task.userDefinedFields.map((field) => ({ text: field.value, weight: 0.8 })),
    ...(context.state?.comments ?? []).map((comment) => ({ text: comment.text, weight: 0.5 })),
  ];
}
