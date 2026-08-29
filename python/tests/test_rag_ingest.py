"""Tests for PDF download + cache invalidation (dalux_build.ai.rag.ingest)."""

import datetime

import pytest

from dalux_build.ai.rag import cache_paths, ingest
from dalux_build.models import File


@pytest.fixture(autouse=True)
def _isolated_cache(tmp_path, monkeypatch):
    """Point the cache root at a temp dir instead of the real user cache dir."""
    monkeypatch.setattr(cache_paths, "user_cache_dir", lambda name: str(tmp_path))


class _FilesApi:
    def __init__(self):
        self.downloads = []

    def download_file_from_link(self, download_link, file_name, save_path=None, verbose=False):
        self.downloads.append((download_link, file_name, save_path))
        # Simulate the real download by writing a placeholder file.
        with open(f"{save_path}/{file_name}", "w", encoding="utf-8") as handle:
            handle.write("pdf-bytes")
        return f"{save_path}/{file_name}"


class _Client:
    def __init__(self):
        self.files = _FilesApi()


def _file(file_id, content_hash="hash-1", version=None, last_modified=None, download_link="ok"):
    return File(
        fileId=file_id,
        fileName=f"{file_id}.pdf",
        fileAreaId="fa1",
        downloadLink=download_link,
        contentHash=content_hash,
        version=version,
        lastModified=last_modified,
    )


def test_sync_scope_downloads_new_files():
    client = _Client()

    result = ingest.sync_scope(client, "scope1", [_file("1")])

    assert len(client.files.downloads) == 1
    assert result.dirty_file_ids == frozenset({"1"})
    assert result.removed_file_ids == frozenset()
    assert result.documents[0].file_id == "1"


def test_sync_scope_skips_unchanged_files_on_second_run():
    client = _Client()
    ingest.sync_scope(client, "scope1", [_file("1", content_hash="hash-1")])

    result = ingest.sync_scope(client, "scope1", [_file("1", content_hash="hash-1")])

    assert len(client.files.downloads) == 1  # no second download
    assert result.dirty_file_ids == frozenset()
    assert result.documents[0].file_id == "1"


def test_sync_scope_redownloads_when_content_hash_changes():
    client = _Client()
    ingest.sync_scope(client, "scope1", [_file("1", content_hash="hash-1")])

    result = ingest.sync_scope(client, "scope1", [_file("1", content_hash="hash-2")])

    assert len(client.files.downloads) == 2
    assert result.dirty_file_ids == frozenset({"1"})


def test_sync_scope_falls_back_to_version_then_last_modified():
    client = _Client()
    ingest.sync_scope(
        client, "scope1", [_file("1", content_hash=None, version="v1", last_modified=None)]
    )

    # version changes -> re-download
    result = ingest.sync_scope(
        client, "scope1", [_file("1", content_hash=None, version="v2", last_modified=None)]
    )
    assert result.dirty_file_ids == frozenset({"1"})

    # neither content_hash nor version -> falls back to last_modified
    client2 = _Client()
    ingest.sync_scope(
        client2,
        "scope2",
        [_file("2", content_hash=None, version=None, last_modified=datetime.date(2026, 1, 1))],
    )
    result2 = ingest.sync_scope(
        client2,
        "scope2",
        [_file("2", content_hash=None, version=None, last_modified=datetime.date(2026, 1, 2))],
    )
    assert result2.dirty_file_ids == frozenset({"2"})


def test_sync_scope_prunes_files_removed_from_live_scope():
    client = _Client()
    ingest.sync_scope(client, "scope1", [_file("1"), _file("2")])

    result = ingest.sync_scope(client, "scope1", [_file("1")])

    assert result.removed_file_ids == frozenset({"2"})
    assert [doc.file_id for doc in result.documents] == ["1"]
    assert not (cache_paths.pdf_dir("scope1") / "2.pdf").exists()


def test_sync_scope_skips_files_without_download_link():
    client = _Client()

    result = ingest.sync_scope(client, "scope1", [_file("1", download_link=None)])

    assert client.files.downloads == []
    assert result.documents == []
