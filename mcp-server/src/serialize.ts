export interface PaginatedForLlm<T> {
  items: T[];
  totalCount: number;
  returnedCount: number;
  truncated: boolean;
}

export interface PaginationParams {
  /** Max items to return (default 50, capped at 200). */
  limit?: number;
  /** Number of items to skip before returning results. */
  offset?: number;
}

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

/**
 * Truncate an already-fetched list of items to an LLM-safe page, reporting
 * enough metadata (`totalCount`/`truncated`) for the caller to know whether
 * to narrow its query. The underlying `dalux-build-api` `getAllX()` helpers
 * already follow bookmark pagination to completion and can return thousands
 * of items — this is the boundary that keeps a single tool call from
 * blowing an LLM's context window.
 */
export function paginateForLlm<T>(items: readonly T[], params: PaginationParams = {}): PaginatedForLlm<T> {
  const offset = Math.max(0, params.offset ?? 0);
  const limit = Math.min(MAX_LIMIT, Math.max(1, params.limit ?? DEFAULT_LIMIT));
  const page = items.slice(offset, offset + limit);
  return {
    items: page,
    totalCount: items.length,
    returnedCount: page.length,
    truncated: offset + page.length < items.length,
  };
}
