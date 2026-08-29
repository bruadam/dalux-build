"""Persistent vector store for standing reference corpora.

Unlike the per-Dalux-scope PDF stores in ``dalux_build.ai.rag`` (synced
automatically on every ``.agent()`` call, keyed by file content hash),
reference corpora here are indexed explicitly and infrequently — crawl once,
index once, then every deep agent picks up the resulting store automatically
via ``reference_store_exists()``. Re-crawling/re-indexing is a separate,
manual operation.
"""

from __future__ import annotations

import shutil
from pathlib import Path
from typing import TYPE_CHECKING, Protocol

from platformdirs import user_cache_dir

if TYPE_CHECKING:
    from langchain_chroma import Chroma

_APP_NAME = "dalux-build"
DEFAULT_CHUNK_SIZE = 1500
DEFAULT_CHUNK_OVERLAP = 200


class _ProgressBar(Protocol):
    """The subset of tqdm's interface used for indexing progress."""

    def update(self, n: float) -> bool | None: ...
    def close(self) -> None: ...
    def set_postfix_str(self, s: str) -> None: ...


try:
    from tqdm import tqdm
except ImportError:
    tqdm = None  # type: ignore[assignment, misc]


def reference_dir(name: str) -> Path:
    """Root cache directory for a named reference corpus."""
    path = Path(user_cache_dir(_APP_NAME)) / "reference" / name
    path.mkdir(parents=True, exist_ok=True)
    return path


def markdown_dir(name: str) -> Path:
    """Directory where a corpus's crawled markdown files live."""
    path = reference_dir(name) / "markdown"
    path.mkdir(parents=True, exist_ok=True)
    return path


def chroma_dir(name: str) -> Path:
    """Persist directory for a corpus's Chroma collection."""
    return reference_dir(name) / "chroma"


def reference_store_exists(name: str) -> bool:
    """Whether a reference corpus has been indexed at least once."""
    directory = chroma_dir(name)
    return directory.exists() and any(directory.iterdir())


def open_reference_store(name: str, embeddings_provider: str = "local") -> Chroma:
    """Open (creating if necessary) a named reference corpus's Chroma collection."""
    from langchain_chroma import Chroma

    from ..rag.vectorstore import build_embeddings

    return Chroma(
        collection_name=f"reference-{name}",
        embedding_function=build_embeddings(embeddings_provider),
        persist_directory=str(chroma_dir(name)),
    )


def index_markdown_directory(
    name: str,
    *,
    embeddings_provider: str = "local",
    chunk_size: int = DEFAULT_CHUNK_SIZE,
    chunk_overlap: int = DEFAULT_CHUNK_OVERLAP,
    verbose: bool = False,
) -> Chroma:
    """(Re-)index every ``.md`` file under this corpus's markdown/ directory.

    Always does a full rebuild (drops and recreates the collection) rather
    than incremental diffing — this corpus is refreshed manually and
    infrequently, so the simplicity/correctness of a clean rebuild outweighs
    the cost of an incremental sync (unlike the per-Dalux-scope PDF stores,
    which sync automatically and frequently).
    """
    directory = markdown_dir(name)
    md_files = sorted(directory.rglob("*.md"))
    if not md_files:
        raise ValueError(f"No markdown files found under {directory}; run crawl_and_save() first.")

    from langchain_text_splitters import MarkdownTextSplitter

    collection_dir = chroma_dir(name)
    if collection_dir.exists():
        shutil.rmtree(collection_dir)

    store = open_reference_store(name, embeddings_provider)
    splitter = MarkdownTextSplitter(chunk_size=chunk_size, chunk_overlap=chunk_overlap)

    progress: _ProgressBar | None = None
    if verbose and tqdm is not None:
        progress = tqdm(total=len(md_files), desc=f"Indexing {name}", unit="file", leave=True)

    for md_path in md_files:
        relative = str(md_path.relative_to(directory))
        if progress is not None:
            progress.set_postfix_str(relative)

        chunks = splitter.split_text(md_path.read_text(encoding="utf-8"))
        if chunks:
            metadatas = [{"source": relative} for _ in chunks]
            ids = [f"{relative}:{index}" for index in range(len(chunks))]
            store.add_texts(chunks, metadatas=metadatas, ids=ids)

        if progress is not None:
            progress.update(1)

    if progress is not None:
        progress.close()

    return store
