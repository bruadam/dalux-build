"""Standing reference corpora (crawled sites, etc.) for the RAG deep agent.

Independent of any Dalux project scope: crawl + index once, and every
``.agent()`` call picks up the resulting store automatically (see
``dalux_build.ai.agent.graph``). Re-crawling/re-indexing is a separate,
explicit operation — call ``crawl_and_index_byggerietsregler()`` again to
refresh.
"""

from __future__ import annotations

from .byggerietsregler import SOURCE_URL, crawl_and_save
from .firecrawl_client import CrawledPage, WebSearchResult, crawl_site, web_search
from .store import (
    index_markdown_directory,
    markdown_dir,
    open_reference_store,
    reference_store_exists,
)

BYGGERIETSREGLER_CORPUS = "byggerietsregler"


def crawl_and_index_byggerietsregler(
    *,
    api_key: str | None = None,
    limit: int = 10000,
    embeddings_provider: str = "local",
    verbose: bool = False,
) -> None:
    """Crawl byggerietsregler.dk, save it as a themed markdown sitemap, and index it.

    Requires: pip install dalux-build[rag], and a FIRECRAWL_API_KEY
    environment variable (or pass *api_key* explicitly).
    """
    crawl_and_save(
        markdown_dir(BYGGERIETSREGLER_CORPUS), api_key=api_key, limit=limit, verbose=verbose
    )
    index_markdown_directory(
        BYGGERIETSREGLER_CORPUS, embeddings_provider=embeddings_provider, verbose=verbose
    )


__all__ = [
    "SOURCE_URL",
    "BYGGERIETSREGLER_CORPUS",
    "crawl_and_save",
    "crawl_and_index_byggerietsregler",
    "crawl_site",
    "CrawledPage",
    "web_search",
    "WebSearchResult",
    "index_markdown_directory",
    "markdown_dir",
    "open_reference_store",
    "reference_store_exists",
]
