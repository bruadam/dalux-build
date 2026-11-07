"""Unchanged downloaded PDFs must populate a new model-specific collection."""

from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest

pytest.importorskip("langchain_community")
from langchain_community import document_loaders
from langchain_core.documents import Document

from dalux_build.ai.rag import vectorstore


def test_missing_vectors_are_rebuilt_even_when_downloads_are_unchanged(monkeypatch, tmp_path):
    store = MagicMock()
    store.get.return_value = {"metadatas": []}
    monkeypatch.setattr(vectorstore, "open_vectorstore", lambda *a, **kw: store)
    loader = MagicMock()
    loader.load.return_value = [Document(page_content="The doors shall be fire rated.")]
    monkeypatch.setattr(document_loaders, "PyPDFLoader", lambda path: loader)
    doc = SimpleNamespace(file_id="f1", file_name="fire.pdf", local_pdf_path=tmp_path / "fire.pdf")
    vectorstore.load_or_build("scope", [doc], dirty_file_ids=frozenset())
    store.add_documents.assert_called_once()
    chunks = store.add_documents.call_args.args[0]
    assert chunks[0].metadata["file_id"] == "f1"
