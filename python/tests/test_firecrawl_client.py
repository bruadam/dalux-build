"""Tests for the Firecrawl crawl wrapper (dalux_build.ai.reference.firecrawl_client)."""

from dalux_build.ai.reference.firecrawl_client import crawl_site, web_search


class _Metadata:
    def __init__(self, source_url, title=None, og_title=None):
        self.source_url = source_url
        self.title = title
        self.og_title = og_title


class _Doc:
    def __init__(self, markdown, metadata=None):
        self.markdown = markdown
        self.metadata = metadata


class _Job:
    def __init__(self, data):
        self.data = data


class _SearchResultItem:
    def __init__(self, url, title=None, description=None, markdown=None):
        self.url = url
        self.title = title
        self.description = description
        self.markdown = markdown


class _SearchResponse:
    def __init__(self, web):
        self.web = web


class _FakeClient:
    def __init__(self, data=None, web_results=None):
        self._data = data
        self._web_results = web_results
        self.calls = []
        self.search_calls = []

    def crawl(self, **kwargs):
        self.calls.append(kwargs)
        return _Job(self._data)

    def search(self, query, **kwargs):
        self.search_calls.append((query, kwargs))
        return _SearchResponse(self._web_results)


def test_crawl_site_returns_pages_with_markdown():
    client = _FakeClient(
        [
            _Doc("# Page 1", _Metadata("https://example.test/a", title="A")),
            _Doc("# Page 2", _Metadata("https://example.test/b", og_title="B fallback")),
        ]
    )

    pages = crawl_site("https://example.test", client=client)

    assert [p.url for p in pages] == ["https://example.test/a", "https://example.test/b"]
    assert pages[0].title == "A"
    assert pages[1].title == "B fallback"  # falls back to og_title when title is unset
    assert pages[0].markdown == "# Page 1"


def test_crawl_site_skips_pages_without_markdown():
    client = _FakeClient(
        [
            _Doc("# Has content", _Metadata("https://example.test/a")),
            _Doc(None, _Metadata("https://example.test/b")),
            _Doc("", _Metadata("https://example.test/c")),
        ]
    )

    pages = crawl_site("https://example.test", client=client)

    assert [p.url for p in pages] == ["https://example.test/a"]


def test_crawl_site_handles_missing_metadata():
    client = _FakeClient([_Doc("content", metadata=None)])

    pages = crawl_site("https://example.test", client=client)

    assert pages[0].url == ""
    assert pages[0].title is None


def test_crawl_site_passes_limit_and_formats_to_client():
    client = _FakeClient([])

    crawl_site("https://example.test", client=client, limit=42)

    call = client.calls[0]
    assert call["url"] == "https://example.test"
    assert call["limit"] == 42
    assert call["scrape_options"] == {"formats": ["markdown"]}


def test_web_search_returns_results():
    client = _FakeClient(
        web_results=[
            _SearchResultItem(
                "https://example.test/law", title="Law", description="desc", markdown="# Law text"
            ),
        ]
    )

    results = web_search("some law", client=client)

    assert results[0].url == "https://example.test/law"
    assert results[0].title == "Law"
    assert results[0].description == "desc"
    assert results[0].markdown == "# Law text"


def test_web_search_handles_no_results():
    client = _FakeClient(web_results=None)

    results = web_search("nothing found", client=client)

    assert results == []


def test_web_search_passes_query_and_limit():
    client = _FakeClient(web_results=[])

    web_search("my query", client=client, limit=3)

    query, kwargs = client.search_calls[0]
    assert query == "my query"
    assert kwargs["limit"] == 3
    assert kwargs["scrape_options"] == {"formats": ["markdown"]}


def test_web_search_scrape_content_false_omits_scrape_options_and_markdown():
    client = _FakeClient(
        web_results=[_SearchResultItem("https://example.test/x", markdown="should be dropped")]
    )

    results = web_search("query", client=client, scrape_content=False)

    _, kwargs = client.search_calls[0]
    assert "scrape_options" not in kwargs
    assert results[0].markdown is None
