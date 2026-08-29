"""Tests for the standing reference-corpus store (dalux_build.ai.reference.store)."""

import pytest

from dalux_build.ai.reference import store


@pytest.fixture(autouse=True)
def _isolated_cache(tmp_path, monkeypatch):
    """Point the cache root at a temp dir instead of the real user cache dir."""
    monkeypatch.setattr(store, "user_cache_dir", lambda name: str(tmp_path))


def test_reference_store_exists_false_when_never_indexed():
    assert store.reference_store_exists("byggerietsregler") is False


def test_reference_store_exists_true_once_chroma_dir_has_content():
    chroma_dir = store.chroma_dir("byggerietsregler")
    chroma_dir.mkdir(parents=True, exist_ok=True)
    (chroma_dir / "chroma.sqlite3").write_text("placeholder", encoding="utf-8")

    assert store.reference_store_exists("byggerietsregler") is True


def test_markdown_dir_is_created_and_scoped_per_corpus():
    md_dir_a = store.markdown_dir("byggerietsregler")
    md_dir_b = store.markdown_dir("other-corpus")

    assert md_dir_a.exists()
    assert md_dir_b.exists()
    assert md_dir_a != md_dir_b


def test_index_markdown_directory_raises_when_no_markdown_files():
    with pytest.raises(ValueError, match="No markdown files found"):
        store.index_markdown_directory("byggerietsregler")
