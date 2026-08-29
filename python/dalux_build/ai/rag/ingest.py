"""Download Dalux PDFs into a local per-scope cache, with hash-based invalidation."""

from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path
from typing import TYPE_CHECKING, Protocol

from .cache_paths import manifest_path, pdf_dir

if TYPE_CHECKING:
    from ... import DaluxClient
    from ...models import File


class _ProgressBar(Protocol):
    """The subset of tqdm's interface used for sync progress."""

    def update(self, n: float) -> bool | None: ...
    def close(self) -> None: ...
    def set_postfix_str(self, s: str) -> None: ...


try:
    from tqdm import tqdm
except ImportError:
    tqdm = None  # type: ignore[assignment, misc]


@dataclass(frozen=True)
class CachedDocument:
    """A PDF that is present, and up to date, in the local scope cache."""

    file_id: str
    file_name: str
    local_pdf_path: Path


@dataclass(frozen=True)
class SyncResult:
    """Outcome of reconciling the local cache with the live set of scoped PDFs."""

    documents: list[CachedDocument]
    dirty_file_ids: frozenset[str]
    removed_file_ids: frozenset[str]


def _invalidation_key(file: File) -> str:
    """Best available signal that a file's content changed since the last sync."""
    if file.content_hash:
        return file.content_hash
    if file.version:
        return file.version
    if file.last_modified:
        return file.last_modified.isoformat()
    return ""


def _load_manifest(cache_key: str) -> dict[str, dict[str, str]]:
    path = manifest_path(cache_key)
    if not path.exists():
        return {}
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        return {}
    return data if isinstance(data, dict) else {}


def _save_manifest(cache_key: str, manifest: dict[str, dict[str, str]]) -> None:
    manifest_path(cache_key).write_text(json.dumps(manifest, indent=2), encoding="utf-8")


def sync_scope(
    client: DaluxClient,
    cache_key: str,
    files: list[File],
    *,
    verbose: bool = False,
) -> SyncResult:
    """Ensure every PDF in *files* is downloaded and current in the local cache.

    Files whose ``content_hash``/``version``/``last_modified`` is unchanged
    since the last sync are reused from disk. Files previously cached but no
    longer present in *files* are deleted from disk and dropped from the
    manifest (the caller is responsible for also removing their vectors).
    """
    manifest = _load_manifest(cache_key)
    live_file_ids = {file.file_id for file in files}
    directory = pdf_dir(cache_key)

    documents: list[CachedDocument] = []
    dirty_file_ids: set[str] = set()

    progress: _ProgressBar | None = None
    if verbose and tqdm is not None:
        progress = tqdm(total=len(files), desc="Syncing PDFs", unit="file", leave=True)

    for file in files:
        if progress is not None:
            progress.set_postfix_str(file.file_name)

        if not file.download_link:
            if verbose:
                print(f"Skipping {file.file_name}: no download link")
            if progress is not None:
                progress.update(1)
            continue

        local_path = directory / f"{file.file_id}.pdf"
        key = _invalidation_key(file)
        entry = manifest.get(file.file_id)

        if entry is not None and entry.get("key") == key and local_path.exists():
            documents.append(CachedDocument(file.file_id, file.file_name, local_path))
            if progress is not None:
                progress.update(1)
            continue

        # Always non-verbose here: the outer "Syncing PDFs" progress bar above
        # already reports per-file progress, so passing verbose=True here
        # would just interleave a "GET <url>" line per file underneath it.
        client.files.download_file_from_link(
            file.download_link, local_path.name, save_path=str(directory), verbose=False
        )
        manifest[file.file_id] = {"key": key, "file_name": file.file_name}
        documents.append(CachedDocument(file.file_id, file.file_name, local_path))
        dirty_file_ids.add(file.file_id)
        if progress is not None:
            progress.update(1)

    if progress is not None:
        progress.close()

    removed_file_ids = set(manifest) - live_file_ids
    for file_id in removed_file_ids:
        stale_path = directory / f"{file_id}.pdf"
        if stale_path.exists():
            stale_path.unlink()
        del manifest[file_id]

    _save_manifest(cache_key, manifest)
    return SyncResult(
        documents=documents,
        dirty_file_ids=frozenset(dirty_file_ids),
        removed_file_ids=frozenset(removed_file_ids),
    )
