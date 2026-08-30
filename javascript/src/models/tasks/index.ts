import { z } from 'zod';
import { listResponseSchema, singleResponseSchema } from '../helpers';

/** Mirrors models/tasks/models.py::Task (extra="allow" -> passthrough; only taskId is typed). */
export const TaskSchema = z.object({
  taskId: z.string().nullish(),
}).passthrough();

/**
 * Mirrors models/tasks/models.py::TaskListParams. Field names are the
 * actual OData query keys (matches what src/api/TasksApi.js's
 * normalizeTaskParams reads/writes) rather than Python's snake_case
 * attribute names, since JS has no alias layer to bridge the two. These are
 * developer-supplied query params (not API responses), so plain `.optional()`
 * is fine.
 */
export const TaskListParamsSchema = z.object({
  typeId: z.string().optional(),
  $filter: z.string().optional(),
  $select: z.string().optional(),
  $orderby: z.string().optional(),
  $top: z.number().optional(),
  $skip: z.number().optional(),
  bookmark: z.string().optional(),
}).passthrough();

/** Mirrors models/tasks/models.py::TaskChangeActor. */
export const TaskChangeActorSchema = z.object({
  userId: z.string().nullish(),
  roleId: z.string().nullish(),
  roleName: z.string().nullish(),
  userName: z.string().nullish(),
  name: z.string().nullish(),
}).passthrough();

/** Mirrors models/tasks/models.py::TaskChangeLocation (empty passthrough). */
export const TaskChangeLocationSchema = z.object({}).passthrough();

/**
 * Preprocesses the deadline field the same way Python's
 * `normalize_deadline` field_validator does: unwraps API payloads where
 * deadline is returned as an object instead of a bare string.
 */
const deadlineSchema = z.preprocess((value) => {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const obj = value as Record<string, unknown>;
    if (obj.empty === true) return undefined;
    if ('value' in obj) return obj.value;
    if ('date' in obj) return obj.date;
    if ('datetime' in obj) return obj.datetime;
  }
  return value;
}, z.string().nullish());

/** Mirrors models/tasks/models.py::TaskChangeFields. */
export const TaskChangeFieldsSchema = z.object({
  currentResponsible: TaskChangeActorSchema.nullish(),
  assignedTo: TaskChangeActorSchema.nullish(),
  title: z.string().nullish(),
  deadline: deadlineSchema,
  status: z.string().nullish(),
  modifiedBy: TaskChangeActorSchema.nullish(),
  userDefinedFields: z.record(z.string(), z.any()).nullish(),
  workpackageId: z.string().nullish(),
  location: TaskChangeLocationSchema.nullish(),
}).passthrough();

/** Mirrors models/tasks/models.py::TaskChange. */
export const TaskChangeSchema = z.object({
  taskId: z.string(),
  description: z.string().nullish(),
  timestamp: z.string(),
  action: z.string(),
  fields: TaskChangeFieldsSchema.nullish(),
});

/** Mirrors models/tasks/models.py::TaskAttachment. */
export const TaskAttachmentSchema = z.object({
  attachmentId: z.string().nullish(),
  taskId: z.string().nullish(),
  fileId: z.string().nullish(),
}).passthrough();

export const TasksListResponseSchema = listResponseSchema(TaskSchema);
export const TaskResponseSchema = singleResponseSchema(TaskSchema);
export const TaskChangeResponseSchema = singleResponseSchema(TaskChangeSchema);
/** Bare-list payloads (`[...]` instead of `{items: [...]}`) are handled by listResponseSchema's preprocessor. */
export const TaskChangesSchema = listResponseSchema(TaskChangeSchema);
export const TaskAttachmentsListResponseSchema = listResponseSchema(TaskAttachmentSchema);
