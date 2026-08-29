"""RAG pipeline: fetch, cache, chunk, and embed Dalux PDFs into a local vector store."""

from .cache_paths import chroma_dir, manifest_path, pdf_dir, scope_cache_dir
from .ingest import CachedDocument, SyncResult, sync_scope
from .vectorstore import build_embeddings, load_or_build, open_vectorstore

__all__ = [
    "CachedDocument",
    "SyncResult",
    "sync_scope",
    "build_embeddings",
    "load_or_build",
    "open_vectorstore",
    "scope_cache_dir",
    "pdf_dir",
    "manifest_path",
    "chroma_dir",
]
