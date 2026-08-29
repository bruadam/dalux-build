"""Crawl byggerietsregler.dk and organize it as a themed markdown sitemap."""

from __future__ import annotations

import re
from pathlib import Path
from urllib.parse import urlparse

from .firecrawl_client import CrawledPage, crawl_site

SOURCE_URL = "https://www.byggerietsregler.dk"


def _slugify(text: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")
    return slug or "untitled"


def _theme_and_slug(page: CrawledPage) -> tuple[str, str]:
    """Derive a theme folder and a page slug from the page's URL path.

    Firecrawl doesn't return a link graph, so themes are inferred from the
    URL's first path segment (e.g. everything under
    ``/br18/...`` groups under the ``br18`` theme).
    """
    path = urlparse(page.url).path.strip("/")
    segments = [s for s in path.split("/") if s]
    if not segments:
        return "index", "index"
    theme = _slugify(segments[0])
    slug = _slugify("-".join(segments[1:])) if len(segments) > 1 else theme
    return theme, slug


def save_as_markdown_sitemap(pages: list[CrawledPage], output_dir: Path) -> dict[str, list[Path]]:
    """Write crawled pages to ``<output_dir>/<theme>/<slug>.md``, grouped by URL theme.

    Also writes a human-browsable ``<output_dir>/SITEMAP.md`` index.
    Returns the written paths grouped by theme.
    """
    output_dir.mkdir(parents=True, exist_ok=True)
    by_theme: dict[str, list[Path]] = {}
    seen_paths: set[Path] = set()

    for page in pages:
        theme, slug = _theme_and_slug(page)
        theme_dir = output_dir / theme
        theme_dir.mkdir(parents=True, exist_ok=True)

        file_path = theme_dir / f"{slug}.md"
        # Disambiguate distinct pages that would otherwise collide on the
        # same theme/slug (e.g. two pages under the same top-level segment
        # whose remaining path segments are identical after slugifying).
        suffix = 2
        while file_path in seen_paths:
            file_path = theme_dir / f"{slug}-{suffix}.md"
            suffix += 1
        seen_paths.add(file_path)

        title = page.title or slug
        front_matter = f"---\ntitle: {title}\nsource_url: {page.url}\n---\n\n"
        file_path.write_text(front_matter + page.markdown, encoding="utf-8")

        by_theme.setdefault(theme, []).append(file_path)

    _write_sitemap_index(output_dir, by_theme)
    return by_theme


def _write_sitemap_index(output_dir: Path, by_theme: dict[str, list[Path]]) -> None:
    lines = ["# byggerietsregler.dk — Markdown Sitemap", ""]
    for theme in sorted(by_theme):
        lines.append(f"## {theme}")
        for path in sorted(by_theme[theme]):
            lines.append(f"- [{path.stem}]({path.relative_to(output_dir)})")
        lines.append("")
    (output_dir / "SITEMAP.md").write_text("\n".join(lines), encoding="utf-8")


def crawl_and_save(
    output_dir: Path,
    *,
    api_key: str | None = None,
    limit: int = 10000,
    verbose: bool = False,
) -> dict[str, list[Path]]:
    """Crawl byggerietsregler.dk and save it as a themed markdown sitemap."""
    pages = crawl_site(SOURCE_URL, api_key=api_key, limit=limit, verbose=verbose)
    if not pages:
        raise RuntimeError(f"Firecrawl returned no pages with markdown content for {SOURCE_URL}.")
    return save_as_markdown_sitemap(pages, output_dir)
