"""Embedding batching, ordering, errors, and query parity."""

from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest

pytest.importorskip("langchain_core")
pytest.importorskip("mistralai.client")
from dalux_build.ai.rag.embeddings import MistralEmbeddings


def test_batching_order_and_query(monkeypatch):
    monkeypatch.setenv("MISTRAL_API_KEY", "test-key")
    adapter = MistralEmbeddings()
    calls = []

    def embed(*, model, inputs):
        calls.append((model, inputs))
        return SimpleNamespace(
            data=[
                SimpleNamespace(index=index, embedding=[float(text)])
                for index, text in reversed(list(enumerate(inputs)))
            ]
        )

    adapter.client.embeddings.create = embed
    assert adapter.embed_documents([str(i) for i in range(200)]) == [[float(i)] for i in range(200)]
    assert [len(inputs) for _, inputs in calls] == [96, 96, 8]
    assert all(model == "mistral-embed" for model, _ in calls)
    assert adapter.embed_query("12") == [12.0]
    assert adapter.embed_documents([]) == []
    assert len(calls) == 4


def test_batches_split_by_size_and_retry_is_configured(monkeypatch):
    monkeypatch.setenv("MISTRAL_API_KEY", "test-key")
    adapter = MistralEmbeddings()
    sizes = []

    def embed(*, model, inputs):
        sizes.append(len(inputs))
        return SimpleNamespace(
            data=[SimpleNamespace(index=index, embedding=[1.0]) for index in range(len(inputs))]
        )

    adapter.client.embeddings.create = embed
    adapter.embed_documents(["x" * 1000] * 100)
    assert sizes == [32, 32, 32, 4]
    assert adapter.client.sdk_configuration.retry_config.strategy == "backoff"


def test_missing_key(monkeypatch):
    monkeypatch.delenv("MISTRAL_API_KEY", raising=False)
    with pytest.raises(ValueError, match="MISTRAL_API_KEY"):
        MistralEmbeddings()


def test_incomplete_response_rejected(monkeypatch):
    monkeypatch.setenv("MISTRAL_API_KEY", "test-key")
    adapter = MistralEmbeddings()
    adapter.client.embeddings.create = MagicMock(return_value=SimpleNamespace(data=[]))
    with pytest.raises(ValueError, match="incomplete"):
        adapter.embed_documents(["text"])


def test_provider_errors_propagate(monkeypatch):
    monkeypatch.setenv("MISTRAL_API_KEY", "test-key")
    adapter = MistralEmbeddings()
    adapter.client.embeddings.create = MagicMock(side_effect=RuntimeError("rate limited"))
    with pytest.raises(RuntimeError, match="rate limited"):
        adapter.embed_query("text")
