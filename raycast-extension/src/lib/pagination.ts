/**
 * Bookmark pagination over Dalux list endpoints.
 *
 * Follows `links[rel=nextPage]` until it disappears. `metadata` is only used
 * for progress: `totalRemainingItems` is not consistent across endpoints, so
 * it is never used to decide when to stop.
 */

export interface DaluxPage<T> {
  items?: T[] | null;
  links?: { rel?: string | null; href?: string | null }[] | null;
  metadata?: { totalItems?: number | null; totalRemainingItems?: number | null } | null;
}

export type ProgressCallback = (loaded: number, total: number | undefined) => void;

export interface CollectOptions {
  params?: Record<string, unknown>;
  onProgress?: ProgressCallback;
  sleep?: (ms: number) => Promise<void>;
}

const MAX_ATTEMPTS = 5;

export function nextBookmark(links: DaluxPage<unknown>["links"]): string | undefined {
  const href = links?.find((link) => link?.rel === "nextPage")?.href;
  if (!href) return undefined;
  return new URL(href, "https://dalux.invalid").searchParams.get("bookmark") ?? undefined;
}

function isRateLimit(error: unknown): boolean {
  return error instanceof Error && error.name === "RateLimitError";
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export async function collectAll<T>(
  fetchPage: (params: Record<string, unknown>) => Promise<DaluxPage<T> | null | undefined>,
  { params = {}, onProgress, sleep = defaultSleep }: CollectOptions = {},
): Promise<T[]> {
  const items: T[] = [];
  const seen = new Set<string>();
  let bookmark: string | undefined;
  let total: number | undefined;

  for (;;) {
    const pageParams = bookmark ? { ...params, bookmark } : params;
    let page: DaluxPage<T> | null | undefined;
    for (let attempt = 1; ; attempt += 1) {
      try {
        page = await fetchPage(pageParams);
        break;
      } catch (error) {
        if (!isRateLimit(error) || attempt === MAX_ATTEMPTS) throw error;
        await sleep(1000 * 2 ** (attempt - 1));
      }
    }

    const pageItems = page?.items ?? [];
    items.push(...pageItems);
    total ??= page?.metadata?.totalItems ?? undefined;
    onProgress?.(items.length, total);

    const next = nextBookmark(page?.links);
    if (!next || !pageItems.length || seen.has(next)) return items;
    seen.add(next);
    bookmark = next;
  }
}
