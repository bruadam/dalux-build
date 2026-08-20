"""Pagination utilities for handling API responses with multiple pages."""

from typing import Protocol
from urllib.parse import parse_qs, urlparse

from ..json_types import JSONDict, JSONValue, QueryParams

try:
    from tqdm import tqdm
except ImportError:
    tqdm = None  # type: ignore[assignment, misc]


class SupportsGet(Protocol):
    """The subset of ``ApiClient`` that pagination needs."""

    def get(self, path: str, params: QueryParams | None = None) -> JSONValue | None: ...


def _find_next_page_link(response: JSONDict) -> JSONDict | None:
    links = response.get("links")
    if not isinstance(links, list):
        return None
    for link in links:
        if isinstance(link, dict) and link.get("rel") == "nextPage":
            return link
    return None


def has_next_page(response: JSONDict) -> bool:
    """Check if response has a next page.

    Args:
        response: API response dictionary

    Returns:
        True if there's a next page, False otherwise
    """
    if not response:
        return False

    return _find_next_page_link(response) is not None


def get_next_page_params(response: JSONDict, base_params: QueryParams | None = None) -> QueryParams:
    """Get parameters for the next page.

    Args:
        response: API response dictionary
        base_params: Original parameters to merge with

    Returns:
        Parameters for the next page request
    """
    base_params = base_params or {}
    next_link = _find_next_page_link(response)

    if not next_link:
        return {}

    href = next_link.get("href")
    if not isinstance(href, str):
        return {}

    qs = parse_qs(urlparse(href).query)
    bookmark = qs.get("bookmark", [None])[0]

    if bookmark:
        return {**base_params, "bookmark": bookmark}

    return base_params


def paginate(
    endpoint: str,
    client: SupportsGet,
    params: QueryParams | None = None,
    verbose: bool = False,
    item_accessor: str = "items",
) -> list[JSONValue]:
    """Generic pagination handler for any API endpoint.

    Args:
        endpoint: API endpoint URL
        client: API client with get method
        params: Query parameters
        verbose: Whether to print progress with tqdm
        item_accessor: Key to access items in response (default: "items")

    Returns:
        List of all items across all pages
    """
    all_items: list[JSONValue] = []
    current_params: QueryParams = dict(params or {})
    page_count = 0
    seen_bookmarks: set[str] = set()

    pbar = None

    try:
        while True:
            page_count += 1
            response = client.get(endpoint, params=current_params)

            if not response or not isinstance(response, dict):
                break

            items = response.get(item_accessor, [])
            item_count = len(items) if isinstance(items, list) else 0
            if isinstance(items, list):
                all_items.extend(items)

            # Initialize progress bar after first response with known total
            if pbar is None and verbose and tqdm is not None:
                metadata = response.get("metadata", {})
                total = None
                if isinstance(metadata, dict):
                    total_remaining = metadata.get("totalRemainingItems")
                    if isinstance(total_remaining, (int, float)):
                        # totalRemainingItems already includes items from this page
                        total = int(total_remaining)
                pbar = tqdm(total=total, desc="Fetching pages", unit="item", leave=True)
                pbar.update(item_count)
            elif pbar is not None:
                pbar.update(item_count)

            if not has_next_page(response):
                break

            # Check for duplicate bookmarks to prevent infinite loops
            next_link = _find_next_page_link(response)
            if next_link:
                href = next_link.get("href")
                if isinstance(href, str):
                    qs = parse_qs(urlparse(href).query)
                    bookmark = qs.get("bookmark", [None])[0]
                    if bookmark:
                        if bookmark in seen_bookmarks:
                            break
                        seen_bookmarks.add(bookmark)

            current_params = get_next_page_params(response, params)
            if not current_params:
                break
    finally:
        if pbar is not None:
            pbar.close()

    return all_items
