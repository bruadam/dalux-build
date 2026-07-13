'use strict';

/**
 * Check whether an API response has a next page link.
 * @param {object} response
 * @returns {boolean}
 */
function hasNextPage(response) {
  if (!response) return false;
  const links = response.links || [];
  return links.some((l) => l.rel === 'nextPage');
}

/**
 * Extract the bookmark for the next page from an API response.
 * @param {object} response
 * @returns {string|null}
 */
function getNextBookmark(response) {
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
 *
 * @param {string} endpoint - API path.
 * @param {object} client - ApiClient instance.
 * @param {object} [params] - Base query parameters.
 * @param {boolean} [verbose=false] - Log progress to console.
 * @param {string} [itemAccessor='items'] - Key to read items from each response.
 * @returns {Promise<any[]>} All items across all pages.
 */
async function paginate(endpoint, client, params = {}, verbose = false, itemAccessor = 'items') {
  const allItems = [];
  let currentParams = { ...params };
  let pageCount = 0;
  const seenBookmarks = new Set();

  while (true) {
    pageCount += 1;
    const response = await client.get(endpoint, currentParams);
    if (!response) break;

    const items = response[itemAccessor] || [];
    allItems.push(...items);

    if (verbose) {
      const meta = response.metadata || {};
      const remaining = meta.totalRemainingItems ?? 0;
      console.log(
        `Page ${pageCount}: ${items.length} items, Total: ${allItems.length}, Remaining: ${remaining}`,
      );
    }

    if (!hasNextPage(response)) break;

    const bookmark = getNextBookmark(response);
    if (!bookmark) break;
    if (seenBookmarks.has(bookmark)) {
      if (verbose) {
        console.log(`Detected duplicate bookmark '${bookmark}', stopping pagination to prevent infinite loop`);
      }
      break;
    }
    seenBookmarks.add(bookmark);
    currentParams = { ...params, bookmark };
  }

  if (verbose) {
    console.log(`Pagination complete. Total items retrieved: ${allItems.length}`);
  }
  return allItems;
}

module.exports = { hasNextPage, getNextBookmark, paginate };
