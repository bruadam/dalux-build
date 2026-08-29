"""Tests for the byggerietsregler.dk crawl-to-markdown-sitemap logic."""

from dalux_build.ai.reference.byggerietsregler import (
    _slugify,
    _theme_and_slug,
    save_as_markdown_sitemap,
)
from dalux_build.ai.reference.firecrawl_client import CrawledPage


def _page(url, title=None, markdown="content"):
    return CrawledPage(url=url, title=title, markdown=markdown)


def test_slugify_normalizes_text():
    assert _slugify("BR18 / Brandforhold!") == "br18-brandforhold"
    assert _slugify("") == "untitled"


def test_theme_and_slug_uses_first_path_segment_as_theme():
    theme, slug = _theme_and_slug(_page("https://www.byggerietsregler.dk/br18/brand/regel-1"))

    assert theme == "br18"
    assert slug == "brand-regel-1"


def test_theme_and_slug_handles_root_page():
    theme, slug = _theme_and_slug(_page("https://www.byggerietsregler.dk/"))

    assert theme == "index"
    assert slug == "index"


def test_theme_and_slug_single_segment_path():
    theme, slug = _theme_and_slug(_page("https://www.byggerietsregler.dk/br18"))

    assert theme == "br18"
    assert slug == "br18"


def test_save_as_markdown_sitemap_writes_files_grouped_by_theme(tmp_path):
    pages = [
        _page("https://www.byggerietsregler.dk/br18/brand/regel-1", title="Regel 1", markdown="A"),
        _page("https://www.byggerietsregler.dk/br18/brand/regel-2", title="Regel 2", markdown="B"),
        _page("https://www.byggerietsregler.dk/entrepriseret/ab18", title="AB18", markdown="C"),
    ]

    by_theme = save_as_markdown_sitemap(pages, tmp_path)

    assert set(by_theme.keys()) == {"br18", "entrepriseret"}
    assert len(by_theme["br18"]) == 2
    assert len(by_theme["entrepriseret"]) == 1

    written = (tmp_path / "br18" / "brand-regel-1.md").read_text(encoding="utf-8")
    assert "title: Regel 1" in written
    assert "source_url: https://www.byggerietsregler.dk/br18/brand/regel-1" in written
    assert written.endswith("A")

    assert (tmp_path / "SITEMAP.md").exists()
    sitemap = (tmp_path / "SITEMAP.md").read_text(encoding="utf-8")
    assert "## br18" in sitemap
    assert "## entrepriseret" in sitemap


def test_save_as_markdown_sitemap_disambiguates_slug_collisions(tmp_path):
    pages = [
        _page("https://www.byggerietsregler.dk/br18/a/b", markdown="first"),
        _page("https://www.byggerietsregler.dk/br18/a-b", markdown="second"),
    ]

    by_theme = save_as_markdown_sitemap(pages, tmp_path)

    # Both pages slugify to "br18/a-b" — the second must not overwrite the first.
    assert len(by_theme["br18"]) == 2
    contents = {p.read_text(encoding="utf-8").splitlines()[-1] for p in by_theme["br18"]}
    assert contents == {"first", "second"}
