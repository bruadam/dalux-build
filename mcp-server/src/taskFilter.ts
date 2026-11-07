/**
 * Task filtering for list_project_tasks / search_tasks / build_task_index.
 *
 * Dalux's tasks endpoint validates its OData options strictly. Probed live
 * (2026-11): `$filter` accepts only `data/type/typeId eq '<id>'` (extra
 * whitespace and wrapping parentheses are fine; `EQ`, double quotes, `ne`,
 * `and`, other fields and `type/typeId` without `data/` are rejected), and
 * every `$select` / `$orderby` value tried was rejected. So the only OData
 * ever sent is that one typeId clause; everything else a model writes is
 * translated into client-side `conditions`, or refused before calling Dalux.
 */
import { z } from 'zod';
import type { DaluxClient } from 'dalux-build-api';
import { collectAllDaluxItems } from './daluxPagination';
import { unwrapTask } from './rag/taskText';

const taskConditionOps = ['eq', 'ne', 'gt', 'ge', 'lt', 'le', 'contains', 'startswith'] as const;

/** A single field/op/value filter, matched against a task's own (unwrapped) JSON. */
export const taskFilterConditionSchema = z.object({
  field: z
    .string().describe('Dot path in the returned task JSON, e.g. "status", "userDefinedFields.Some Field".'),
  op: z.enum(taskConditionOps).describe('contains/startswith are case-insensitive.'),
  value: z.union([z.string(), z.number(), z.boolean()]),
});
export type TaskFilterCondition = z.infer<typeof taskFilterConditionSchema>;

function getByPath(obj: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((acc, key) => {
    if (acc == null || typeof acc !== 'object') return undefined;
    return (acc as Record<string, unknown>)[key];
  }, obj);
}

function compare(actual: unknown, value: unknown): number {
  if (typeof actual === 'number' && typeof value === 'number') return actual - value;
  // ISO 8601 timestamps and plain strings both sort correctly lexically.
  const a = String(actual);
  const b = String(value);
  return a < b ? -1 : a > b ? 1 : 0;
}

function matchesCondition(actual: unknown, condition: TaskFilterCondition): boolean {
  const { op, value } = condition;
  if (op === 'contains' || op === 'startswith') {
    if (typeof actual !== 'string' || typeof value !== 'string') return false;
    const a = actual.toLowerCase();
    const b = value.toLowerCase();
    return op === 'contains' ? a.includes(b) : a.startsWith(b);
  }
  if (actual === null || actual === undefined) return false;

  let cmp: number;
  if (typeof actual === 'boolean' || typeof value === 'boolean') {
    if (op !== 'eq' && op !== 'ne') return false;
    cmp = actual === value ? 0 : 1;
  } else {
    cmp = compare(actual, value);
  }
  switch (op) {
    case 'eq':
      return cmp === 0;
    case 'ne':
      return cmp !== 0;
    case 'gt':
      return cmp > 0;
    case 'ge':
      return cmp >= 0;
    case 'lt':
      return cmp < 0;
    case 'le':
      return cmp <= 0;
    default:
      return false;
  }
}

/** ANDs every condition together against each task's own (unwrapped) fields. */
export function applyConditions<T>(items: readonly T[], conditions: readonly TaskFilterCondition[] | undefined): T[] {
  if (!conditions || conditions.length === 0) return [...items];
  return items.filter((item) => {
    const data = unwrapTask(item);
    return conditions.every((condition) => matchesCondition(getByPath(data, condition.field), condition));
  });
}

export function typeIdFilter(typeId: string): string {
  return `data/type/typeId eq '${typeId.replace(/'/g, "''")}'`;
}

/** `data/workflow/name` or `workflow/name` → `workflow.name`, the `conditions` field syntax. */
export function odataPathToField(path: string): string {
  return path.replace(/^data\//, '').split('/').join('.');
}

// ---------- OData $filter translation ----------

const PATH = String.raw`[A-Za-z_][\w]*(?:/[A-Za-z_][\w]*)*`;
const COMPARISON = new RegExp(String.raw`^(${PATH})\s+(eq|ne|gt|ge|lt|le)\s+(.+)$`, 'i');
const FUNCTION = new RegExp(String.raw`^(contains|startswith)\(\s*(${PATH})\s*,\s*(.+?)\s*\)$`, 'i');
const DATE = /^\d{4}-\d{2}-\d{2}(T[\d:.]+(Z|[+-]\d{2}:\d{2})?)?$/;

function parseLiteral(text: string): string | number | boolean | undefined {
  const quoted = /^'((?:[^']|'')*)'$/.exec(text) ?? /^"([^"]*)"$/.exec(text) ?? /^datetime'([^']*)'$/i.exec(text);
  if (quoted) return quoted[1].replace(/''/g, "'");
  if (/^(true|false)$/i.test(text)) return text.toLowerCase() === 'true';
  if (/^-?\d+(\.\d+)?$/.test(text)) return Number(text);
  if (DATE.test(text)) return text;
  return undefined;
}

/** Strips parentheses wrapping the whole clause, e.g. `((a eq 1))` → `a eq 1`. */
function unwrapParens(text: string): string {
  let current = text.trim();
  while (current.startsWith('(') && current.endsWith(')') && splitTopLevel(current.slice(1, -1), /^$/) !== null) {
    current = current.slice(1, -1).trim();
  }
  return current;
}

/**
 * Splits on a keyword (`and`) outside quotes and parentheses. Returns null
 * when the parentheses don't balance; with a never-matching keyword it only
 * checks balance.
 */
function splitTopLevel(text: string, keyword: RegExp): string[] | null {
  const parts: string[] = [];
  let depth = 0;
  let quote: string | null = null;
  let start = 0;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (quote) {
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === "'" || ch === '"') quote = ch;
    else if (ch === '(') depth += 1;
    else if (ch === ')') {
      depth -= 1;
      if (depth < 0) return null;
    } else if (depth === 0 && /\s/.test(ch)) {
      const match = keyword.exec(text.slice(i));
      if (match && match[0]) {
        parts.push(text.slice(start, i));
        i += match[0].length - 1;
        start = i + 1;
      }
    }
  }
  if (depth !== 0 || quote) return null;
  parts.push(text.slice(start));
  return parts;
}

type ClauseResult = { odata: string } | { condition: TaskFilterCondition } | { error: string };

function translateClause(clause: string): ClauseResult {
  const text = unwrapParens(clause);
  if (/^not\b/i.test(text) || (splitTopLevel(text, /^\s+or\s+/i)?.length ?? 1) > 1) {
    return { error: `\`${text}\` (or/not are not supported; conditions are ANDed, so make one call per alternative)` };
  }

  const comparison = COMPARISON.exec(text);
  const fn = comparison ? null : FUNCTION.exec(text);
  const match = comparison ?? fn;
  if (!match) return { error: `\`${text}\` (not a simple comparison, contains() or startswith())` };

  const [, first, second, literalText] = match;
  const path = comparison ? first : second;
  const op = (comparison ? second : first).toLowerCase() as TaskFilterCondition['op'];
  const value = parseLiteral(literalText.trim());
  if (value === undefined) return { error: `\`${text}\` (unsupported value \`${literalText.trim()}\`)` };
  if (fn && typeof value !== 'string') return { error: `\`${text}\` (${op}() needs a string)` };

  const field = odataPathToField(path);
  if (field === 'type.typeId' && op === 'eq' && typeof value === 'string') return { odata: typeIdFilter(value) };
  return { condition: { field, op, value } };
}

export type TranslatedFilter = {
  /** The only $filter Dalux accepts (typeId), if the filter had one. */
  odataFilter?: string;
  conditions: TaskFilterCondition[];
  /** Set when the filter was not sent as-is. */
  note?: string;
};

/**
 * Turns a model-written OData $filter into what Dalux accepts plus client-side
 * conditions. Throws (before any Dalux call) when part of it can't be translated.
 */
export function translateTaskFilter(filter: string): TranslatedFilter {
  const clauses = splitTopLevel(unwrapParens(filter), /^\s+and\s+/i);
  const results = clauses?.map(translateClause) ?? [{ error: `\`${filter}\` (unbalanced quotes or parentheses)` }];

  const errors = results.flatMap((r) => ('error' in r ? [r.error] : []));
  const conditions = results.flatMap((r) => ('condition' in r ? [r.condition] : []));
  const odata = results.flatMap((r) => ('odata' in r ? [r.odata] : []));
  // Dalux takes one typeId clause; any further one is checked client-side.
  conditions.push(...odata.slice(1).map((f) => ({ field: 'type.typeId', op: 'eq' as const, value: /'(.*)'$/.exec(f)![1].replace(/''/g, "'") })));

  if (errors.length > 0) {
    throw new Error(
      `filter not sent to Dalux: unsupported part ${errors.join('; ')}. ` +
        `Dalux's $filter accepts only data/type/typeId eq '<id>' (or use typeId). Use conditions for other filters` +
        (conditions.length > 0 ? `; the supported part is conditions: ${JSON.stringify(conditions)}` : ', e.g. conditions: [{"field":"workflow.name","op":"eq","value":"Open"}]') +
        '.',
    );
  }

  const odataFilter = odata[0];
  if (conditions.length === 0) return { odataFilter, conditions };
  return {
    odataFilter,
    conditions,
    note: `filter translated to ${odataFilter ? `$filter "${odataFilter}" + ` : ''}conditions ${JSON.stringify(conditions)}; pass conditions directly next time.`,
  };
}

// ---------- fetching ----------

export type TaskQuery = {
  typeId?: string;
  filter?: string;
  conditions?: TaskFilterCondition[];
};

export type ResolvedTaskQuery = { odataFilter?: string; conditions: TaskFilterCondition[]; note?: string };

/** Resolves typeId/filter/conditions into the $filter to send and the conditions to apply. */
export function resolveTaskQuery({ typeId, filter, conditions = [] }: TaskQuery): ResolvedTaskQuery {
  const translated = filter !== undefined && filter.trim() ? translateTaskFilter(filter) : { conditions: [] };
  const odataFilter = translated.odataFilter ?? (typeId !== undefined ? typeIdFilter(typeId) : undefined);
  return { odataFilter, conditions: [...translated.conditions, ...conditions], note: 'note' in translated ? translated.note : undefined };
}

/**
 * Fetches every task matching the resolved query. Dalux errors carry the
 * OData that was sent, since "Parameter validation failed for OData query"
 * alone doesn't say which part was rejected.
 */
export async function collectProjectTasks(
  client: DaluxClient,
  projectId: string,
  query: ResolvedTaskQuery,
  params: Record<string, unknown> = {},
): Promise<unknown[]> {
  const odata: Record<string, unknown> = { ...params };
  if (query.odataFilter !== undefined) odata.$filter = query.odataFilter;
  let items: unknown[];
  try {
    items = await collectAllDaluxItems((pageParams) => client.tasks.getProjectTasks(projectId, { ...odata, ...pageParams }));
  } catch (err) {
    if (!(err instanceof Error)) throw err;
    const sent = Object.entries(odata).map(([key, value]) => `${key}=${JSON.stringify(value)}`);
    err.message = `${err.message} (sent ${sent.length > 0 ? sent.join(', ') : 'no query options'})`;
    throw err;
  }
  return applyConditions(items, query.conditions);
}
