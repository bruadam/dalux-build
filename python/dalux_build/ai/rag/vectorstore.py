"""Chunk, embed, and persist Dalux PDFs into a per-scope Chroma vector store."""

from __future__ import annotations

from typing import TYPE_CHECKING, Protocol

from .cache_paths import chroma_dir

if TYPE_CHECKING:
    from langchain_chroma import Chroma
    from langchain_core.embeddings import Embeddings

    from .ingest import CachedDocument


class _ProgressBar(Protocol):
    """The subset of tqdm's interface used for embedding progress."""

    def update(self, n: float) -> bool | None: ...
    def close(self) -> None: ...
    def set_postfix_str(self, s: str) -> None: ...


try:
    from tqdm import tqdm
except ImportError:
    tqdm = None  # type: ignore[assignment, misc]

DEFAULT_CHUNK_SIZE = 1000
DEFAULT_CHUNK_OVERLAP = 150

# OpenRouter serves chat models only, not embeddings — this is the only
# guaranteed API key for this feature, so embeddings default to a local
# sentence-transformers model rather than requiring a second provider key.
DEFAULT_LOCAL_EMBEDDING_MODEL = "BAAI/bge-small-en-v1.5"
DEFAULT_OPENAI_EMBEDDING_MODEL = "text-embedding-3-small"


def build_embeddings(embeddings_provider: str = "local", *, verbose: bool = False) -> Embeddings:
    """Build the embeddings model used to index and query documents.

    Args:
        embeddings_provider: ``"local"`` (default) uses a local
            sentence-transformers model — no extra API key required, but
            pulls in a multi-hundred-MB model on first use. ``"openai"``
            uses ``OpenAIEmbeddings`` instead, when ``OPENAI_API_KEY`` is
            available and a smaller/faster dependency footprint is preferred.
        verbose: If True, print progress while loading the model (the local
            provider especially can take a while on a cold start, since it
            downloads the model from Hugging Face on first use).
    """
    if embeddings_provider == "openai":
        if verbose:
            print(f"Loading OpenAI embeddings model {DEFAULT_OPENAI_EMBEDDING_MODEL}...")
        from langchain_openai import OpenAIEmbeddings

        return OpenAIEmbeddings(model=DEFAULT_OPENAI_EMBEDDING_MODEL)

    if verbose:
        print(
            f"Loading local embeddings model {DEFAULT_LOCAL_EMBEDDING_MODEL} "
            "(downloads on first use, this can take a few minutes)..."
        )
    from langchain_huggingface import HuggingFaceEmbeddings

    embeddings = HuggingFaceEmbeddings(model_name=DEFAULT_LOCAL_EMBEDDING_MODEL)
    if verbose:
        print("Embeddings model loaded.")
    return embeddings


def open_vectorstore(
    cache_key: str, embeddings_provider: str = "local", *, verbose: bool = False
) -> Chroma:
    """Open (creating if necessary) the persisted Chroma collection for a scope."""
    from langchain_chroma import Chroma

    return Chroma(
        collection_name=cache_key,
        embedding_function=build_embeddings(embeddings_provider, verbose=verbose),
        persist_directory=str(chroma_dir(cache_key)),
    )


def load_or_build(
    cache_key: str,
    documents: list[CachedDocument],
    *,
    dirty_file_ids: frozenset[str],
    removed_file_ids: frozenset[str] = frozenset(),
    embeddings_provider: str = "local",
    chunk_size: int = DEFAULT_CHUNK_SIZE,
    chunk_overlap: int = DEFAULT_CHUNK_OVERLAP,
    verbose: bool = False,
) -> Chroma:
    """Bring a scope's Chroma collection up to date and return it.

    New/changed PDFs (``dirty_file_ids``) are chunked and (re-)embedded;
    files no longer in scope (``removed_file_ids``) have their vectors
    dropped. Unaffected files are left untouched.
    """
    from langchain_community.document_loaders import PyPDFLoader
    from langchain_text_splitters import RecursiveCharacterTextSplitter

    store = open_vectorstore(cache_key, embeddings_provider, verbose=verbose)

    if removed_file_ids:
        if verbose:
            print(f"Dropping vectors for {len(removed_file_ids)} removed file(s).")
        store.delete(where={"file_id": {"$in": list(removed_file_ids)}})

    if not dirty_file_ids:
        if verbose:
            print("No new or changed PDFs to embed.")
        return store

    dirty_documents = [doc for doc in documents if doc.file_id in dirty_file_ids]
    if not dirty_documents:
        return store

    # A changed PDF can produce a different number of chunks than its
    # previous revision, so stale trailing chunks must be dropped explicitly
    # before re-adding — id-based upsert alone wouldn't remove them.
    store.delete(where={"file_id": {"$in": [doc.file_id for doc in dirty_documents]}})

    splitter = RecursiveCharacterTextSplitter(chunk_size=chunk_size, chunk_overlap=chunk_overlap)

    progress: _ProgressBar | None = None
    if verbose and tqdm is not None:
        progress = tqdm(total=len(dirty_documents), desc="Embedding PDFs", unit="file", leave=True)

    for doc in dirty_documents:
        if progress is not None:
            progress.set_postfix_str(doc.file_name)
        pages = PyPDFLoader(str(doc.local_pdf_path)).load()
        chunks = splitter.split_documents(pages)
        if chunks:
            for chunk in chunks:
                chunk.metadata["file_id"] = doc.file_id
                chunk.metadata["file_name"] = doc.file_name
            ids = [f"{doc.file_id}:{index}" for index in range(len(chunks))]
            store.add_documents(chunks, ids=ids)
        if progress is not None:
            progress.update(1)

    if progress is not None:
        progress.close()

    return store
