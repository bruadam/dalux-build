type DaluxLink = { rel?: string | null; href?: string | null };

type DaluxMetadata = { totalRemainingItems?: number | null };

type DaluxListResponse<T> = {
  items?: T[] | null;
  links?: DaluxLink[] | null;
  metadata?: DaluxMetadata | null;
} | null | undefined;

function getNextBookmark(links: DaluxLink[] | null | undefined): string | undefined {
  const nextHref = links?.find((link) => link?.rel === 'nextPage')?.href;
  if (!nextHref) return undefined;
  try {
    return new URL(nextHref).searchParams.get('bookmark') ?? undefined;
  } catch {
    // Some APIs may return relative links.
    return new URL(nextHref, 'https://dalux.local').searchParams.get('bookmark') ?? undefined;
  }
}

/**
 * Follows Dalux bookmark pagination until exhaustion and returns all items.
 */
export async function collectAllDaluxItems<T>(
  fetchPage: (params: Record<string, unknown>) => Promise<DaluxListResponse<T>>,
  baseParams: Record<string, unknown> = {},
): Promise<T[]> {
  const items: T[] = [];
  const seenBookmarks = new Set<string>();
  let bookmark: string | undefined;

  for (;;) {
    const params = bookmark ? { ...baseParams, bookmark } : baseParams;
    const page = await fetchPage(params);
    const pageItems = page?.items ?? [];
    if (pageItems.length > 0) {
      items.push(...pageItems);
    }

    const nextBookmark = getNextBookmark(page?.links);
    const remaining = page?.metadata?.totalRemainingItems;
    const done =
      !nextBookmark ||
      pageItems.length === 0 ||
      (typeof remaining === 'number' && remaining <= 0) ||
      seenBookmarks.has(nextBookmark);

    if (done) {
      break;
    }

    seenBookmarks.add(nextBookmark);
    bookmark = nextBookmark;
  }

  return items;
}
