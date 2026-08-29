"""Local, on-disk cache layout for the RAG agent (PDFs, manifests, vector stores)."""

from __future__ import annotations

from pathlib import Path

from platformdirs import user_cache_dir

_APP_NAME = "dalux-build"


def scope_cache_dir(cache_key: str) -> Path:
    """Root cache directory for a single agent scope (one file_area/folder)."""
    path = Path(user_cache_dir(_APP_NAME)) / "rag" / cache_key
    path.mkdir(parents=True, exist_ok=True)
    return path


def pdf_dir(cache_key: str) -> Path:
    """Directory where downloaded PDFs for this scope are cached."""
    path = scope_cache_dir(cache_key) / "pdfs"
    path.mkdir(parents=True, exist_ok=True)
    return path


def manifest_path(cache_key: str) -> Path:
    """Path to the per-file invalidation manifest (content_hash/version) for this scope."""
    return scope_cache_dir(cache_key) / "manifest.json"


def chroma_dir(cache_key: str) -> Path:
    """Persist directory for this scope's Chroma collection."""
    path = scope_cache_dir(cache_key) / "chroma"
    path.mkdir(parents=True, exist_ok=True)
    return path
