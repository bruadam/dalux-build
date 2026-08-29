"""Thin wrapper around Firecrawl for crawling an entire site to markdown."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Protocol


class _CrawlDocument(Protocol):
    """The subset of a single crawled page's document this module depends on.

    ``metadata``'s own attributes (``source_url``, ``title``, ``og_title``)
    are read defensively via ``getattr`` rather than typed here, since the
    SDK doesn't ship type stubs for that nested object.
    """

    markdown: str | None
    metadata: object | None


class _CrawlJob(Protocol):
    """The subset of Firecrawl's crawl-job response this module depends on."""

    data: list[_CrawlDocument]


class _SearchResultItem(Protocol):
    """The subset of a single Firecrawl web-search result this module depends on."""

    url: str
    title: str | None
    description: str | None
    markdown: str | None


class _SearchResponse(Protocol):
    """The subset of Firecrawl's search response this module depends on."""

    web: list[_SearchResultItem] | None


class _FirecrawlClient(Protocol):
    """The subset of firecrawl.Firecrawl's interface this module depends on."""

    def crawl(self, **kwargs: object) -> _CrawlJob: ...
    def search(self, query: str, **kwargs: object) -> _SearchResponse: ...


@dataclass(frozen=True)
class CrawledPage:
    """A single crawled page's markdown content and source metadata."""

    url: str
    title: str | None
    markdown: str


@dataclass(frozen=True)
class WebSearchResult:
    """A single web search result, optionally with scraped markdown content."""

    url: str
    title: str | None
    description: str | None
    markdown: str | None


def _page_title(doc: object) -> str | None:
    metadata = getattr(doc, "metadata", None)
    if metadata is None:
        return None
    title = getattr(metadata, "title", None)
    return title if title else getattr(metadata, "og_title", None)


def crawl_site(
    url: str,
    *,
    client: _FirecrawlClient | None = None,
    api_key: str | None = None,
    limit: int = 10000,
    poll_interval: int = 5,
    timeout: int = 14400,
    verbose: bool = False,
) -> list[CrawledPage]:
    """Crawl an entire site with Firecrawl and return every page as markdown.

    Uses the SDK's blocking ``crawl()`` method rather than the lower-level
    ``start_crawl()``/``get_crawl_status()`` pair: per Firecrawl's docs,
    ``crawl()`` handles result pagination automatically, while the manual
    pattern requires following ``.next`` URLs yourself for large result
    sets. For "the entire site" that correctness guarantee matters more
    than a live progress bar, so this call blocks until the crawl finishes
    — which, for a large site, can take a while (``timeout`` defaults to 4
    hours accordingly).

    Args:
        url: Root URL to crawl.
        client: Inject a pre-built Firecrawl client (used by tests). If
            omitted, a real ``firecrawl.Firecrawl`` client is constructed,
            using *api_key* or falling back to the FIRECRAWL_API_KEY
            environment variable (the SDK's own default).
        limit: Maximum pages to crawl. Firecrawl's own hard ceiling is
            10,000; each page consumes 1 credit.
        poll_interval: Seconds between the SDK's internal status checks.
        timeout: Maximum seconds to wait for the crawl to finish.
        verbose: If True, print a start message and a final page count.
    """
    if client is None:
        from firecrawl import Firecrawl

        client = Firecrawl(api_key=api_key) if api_key else Firecrawl()

    if verbose:
        print(f"Starting Firecrawl crawl of {url} (limit={limit}); this can take a while...")

    job = client.crawl(
        url=url,
        limit=limit,
        scrape_options={"formats": ["markdown"]},
        poll_interval=poll_interval,
        timeout=timeout,
    )

    pages = [
        CrawledPage(
            url=(getattr(doc.metadata, "source_url", None) or "") if doc.metadata else "",
            title=_page_title(doc),
            markdown=doc.markdown or "",
        )
        for doc in job.data
        if doc.markdown
    ]

    if verbose:
        print(f"Crawl complete: {len(pages)} page(s) with markdown content.")

    return pages


def web_search(
    query: str,
    *,
    client: _FirecrawlClient | None = None,
    api_key: str | None = None,
    limit: int = 5,
    scrape_content: bool = True,
) -> list[WebSearchResult]:
    """Search the web via Firecrawl and return results, optionally with scraped content.

    Unlike ``crawl_site()``, this is meant for ad-hoc lookups during a
    conversation (e.g. "what does the latest version of this law say"),
    not building a standing indexed corpus.

    Args:
        query: Search query.
        client: Inject a pre-built Firecrawl client (used by tests). If
            omitted, a real ``firecrawl.Firecrawl`` client is constructed,
            using *api_key* or falling back to the FIRECRAWL_API_KEY
            environment variable (the SDK's own default).
        limit: Maximum number of results.
        scrape_content: If True, also scrape each result's page as markdown
            (costs more Firecrawl credits per result but gives the caller
            actual page content instead of just a title/description).
    """
    if client is None:
        from firecrawl import Firecrawl

        client = Firecrawl(api_key=api_key) if api_key else Firecrawl()

    kwargs: dict[str, object] = {"limit": limit}
    if scrape_content:
        kwargs["scrape_options"] = {"formats": ["markdown"]}

    response = client.search(query, **kwargs)
    web_results = response.web or []

    return [
        WebSearchResult(
            url=item.url,
            title=item.title,
            description=item.description,
            markdown=item.markdown if scrape_content else None,
        )
        for item in web_results
    ]
