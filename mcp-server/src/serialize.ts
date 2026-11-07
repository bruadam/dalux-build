import { z } from 'zod';

export interface PaginatedForLlm<T> {
  items: T[];
  totalCount: number;
  returnedCount: number;
  truncated: boolean;
  /** Offset of the next page; present only when `truncated` is true. */
  nextOffset?: number;
}

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

/** The `limit`/`offset` arguments every list tool accepts. */
export const pageInput = {
  limit: z
    .number()
    .int()
    .min(1)
    .max(MAX_LIMIT)
    .optional()
    .describe(`Max items to return (default ${DEFAULT_LIMIT}, max ${MAX_LIMIT}).`),
  offset: z.number().int().min(0).optional().describe('Items to skip; pass the previous result\'s nextOffset.'),
};

export interface PaginationParams {
  limit?: number;
  offset?: number;
}

/**
 * Truncate an already-fetched list of items to an LLM-safe page, reporting
 * enough metadata (`totalCount`/`truncated`/`nextOffset`) for the caller to
 * fetch the next page or narrow its query. The underlying `dalux-build-api`
 * `getAllX()` helpers already follow bookmark pagination to completion and
 * can return thousands of items — this is the boundary that keeps a single
 * tool call from blowing an LLM's context window.
 */
export function paginateForLlm<T>(items: readonly T[], params: PaginationParams = {}): PaginatedForLlm<T> {
  const offset = Math.max(0, params.offset ?? 0);
  const limit = Math.min(MAX_LIMIT, Math.max(1, params.limit ?? DEFAULT_LIMIT));
  const page = items.slice(offset, offset + limit);
  const end = offset + page.length;
  const truncated = end < items.length;
  return {
    items: page,
    totalCount: items.length,
    returnedCount: page.length,
    truncated,
    ...(truncated && { nextOffset: end }),
  };
}

/**
 * The optional `fields` argument of list tools that return a lean item by
 * default: names extra top-level item fields to return, or ["*"] for all.
 */
export function fieldsInput(defaults: readonly string[]) {
  return z
    .array(z.string())
    .optional()
    .describe(`Extra item fields to return besides the default ${defaults.join(', ')}; ["*"] returns every field.`);
}

/** Reduces each item of a page to the default fields plus any requested extras. */
export function pickFields<T>(
  page: PaginatedForLlm<T>,
  defaults: readonly string[],
  fields: readonly string[] = [],
): PaginatedForLlm<unknown> {
  if (fields.includes('*')) return page;
  const keep = new Set([...defaults, ...fields]);
  const items = page.items.map((item) =>
    Object.fromEntries(Object.entries(item as Record<string, unknown>).filter(([key]) => keep.has(key))),
  );
  return { ...page, items };
}
