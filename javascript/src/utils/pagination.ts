export interface ResponseLink {
  rel: string;
  href: string;
  method?: string | null;
}

export interface PaginatedResponse {
  links?: ResponseLink[];
  metadata?: { totalRemainingItems?: number | null; totalItems?: number | null };
  [itemAccessor: string]: unknown;
}

export interface PaginationClient {
  get(endpoint: string, params?: Record<string, unknown>): Promise<PaginatedResponse | null | undefined>;
}

/**
 * Check whether an API response has a next page link.
 */
export function hasNextPage(response: PaginatedResponse | null | undefined): boolean {
  if (!response) return false;
  const links = response.links || [];
  return links.some((l) => l.rel === 'nextPage');
}

/**
 * Extract the bookmark for the next page from an API response.
 */
export function getNextBookmark(response: PaginatedResponse | null | undefined): string | null {
  const links = (response && response.links) || [];
  const nextLink = links.find((l) => l.rel === 'nextPage');
  if (!nextLink) return null;
  try {
    return new URL(nextLink.href).searchParams.get('bookmark');
  } catch {
    return null;
  }
}

/**
 * Generic pagination handler: follows bookmark pages until exhausted.
 */
export async function paginate(
  endpoint: string,
  client: PaginationClient,
  params: Record<string, unknown> = {},
  verbose = false,
  itemAccessor = 'items',
): Promise<unknown[]> {
  const allItems: unknown[] = [];
  let currentParams: Record<string, unknown> = { ...params };
  let pageCount = 0;
  const seenBookmarks = new Set<string>();

  while (true) {
    pageCount += 1;
    const response = await client.get(endpoint, currentParams);
    if (!response) break;

    const items = (response[itemAccessor] as unknown[]) || [];
    allItems.push(...items);

    if (verbose) {
      const meta = response.metadata || {};
      const remaining = meta.totalRemainingItems ?? 0;
      // eslint-disable-next-line no-console
      console.log(
        `Page ${pageCount}: ${items.length} items, Total: ${allItems.length}, Remaining: ${remaining}`,
      );
    }

    if (!hasNextPage(response)) break;

    const bookmark = getNextBookmark(response);
    if (!bookmark) break;
    if (seenBookmarks.has(bookmark)) {
      if (verbose) {
        // eslint-disable-next-line no-console
        console.log(`Detected duplicate bookmark '${bookmark}', stopping pagination to prevent infinite loop`);
      }
      break;
    }
    seenBookmarks.add(bookmark);
    currentParams = { ...params, bookmark };
  }

  if (verbose) {
    // eslint-disable-next-line no-console
    console.log(`Pagination complete. Total items retrieved: ${allItems.length}`);
  }
  return allItems;
}
