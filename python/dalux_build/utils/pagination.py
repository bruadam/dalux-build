"""Pagination utilities for handling API responses with multiple pages."""

from typing import Any, Dict, List, Optional
from urllib.parse import parse_qs, urlparse


def has_next_page(response: Dict[str, Any]) -> bool:
    """Check if response has a next page.
    
    Args:
        response: API response dictionary
        
    Returns:
        True if there's a next page, False otherwise
    """
    if not response:
        return False
    
    links = response.get("links", [])
    next_link = next((l for l in links if l.get("rel") == "nextPage"), None)
    return next_link is not None


def get_next_page_params(response: Dict[str, Any], base_params: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    """Get parameters for the next page.
    
    Args:
        response: API response dictionary
        base_params: Original parameters to merge with
        
    Returns:
        Parameters for the next page request
    """
    base_params = base_params or {}
    next_link = next(
        (l for l in (response.get("links") or []) if l.get("rel") == "nextPage"),
        None
    )
    
    if not next_link:
        return {}
    
    qs = parse_qs(urlparse(next_link["href"]).query)
    bookmark = qs.get("bookmark", [None])[0]
    
    if bookmark:
        return {**base_params, "bookmark": bookmark}
    
    return base_params


def paginate(
    endpoint: str,
    client: Any,
    params: Optional[Dict[str, Any]] = None,
    verbose: bool = False,
    item_accessor: str = "items"
) -> List[Any]:
    """Generic pagination handler for any API endpoint.
    
    Args:
        endpoint: API endpoint URL
        client: API client with get method
        params: Query parameters
        verbose: Whether to print progress
        item_accessor: Key to access items in response (default: "items")
        
    Returns:
        List of all items across all pages
    """
    all_items = []
    current_params = dict(params or {})
    page_count = 0
    seen_bookmarks = set()
    
    while True:
        page_count += 1
        response = client.get(endpoint, params=current_params)
        
        if not response:
            break
            
        items = response.get(item_accessor, [])
        all_items.extend(items)
        
        if verbose:
            metadata = response.get("metadata", {})
            remaining = metadata.get("totalRemainingItems", 0)
            print(f"Page {page_count}: {len(items)} items, Total: {len(all_items)}, Remaining: {remaining}")
        
        if not has_next_page(response):
            break
            
        # Check for duplicate bookmarks to prevent infinite loops
        next_link = next(
            (l for l in (response.get("links") or []) if l.get("rel") == "nextPage"),
            None
        )
        if next_link:
            qs = parse_qs(urlparse(next_link["href"]).query)
            bookmark = qs.get("bookmark", [None])[0]
            if bookmark:
                if bookmark in seen_bookmarks:
                    if verbose:
                        print(f"Detected duplicate bookmark '{bookmark}', stopping pagination to prevent infinite loop")
                    break
                seen_bookmarks.add(bookmark)
        
        current_params = get_next_page_params(response, params)
        if not current_params:
            break
    
    if verbose:
        print(f"Pagination complete. Total items retrieved: {len(all_items)}")
    
    return all_items