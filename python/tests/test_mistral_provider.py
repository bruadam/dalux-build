"""Mistral completion and streaming response handling."""

from contextlib import nullcontext
from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest

from dalux_build.ai.providers import AIProviderManager


def test_chat_and_stream_use_mistral_and_respect_token_limit(monkeypatch):
    sdk = pytest.importorskip("mistralai.client")
    monkeypatch.setenv("MISTRAL_API_KEY", "test-key")
    client = MagicMock()
    client.__enter__.return_value = client
    client.chat.complete.return_value = SimpleNamespace(
        choices=[SimpleNamespace(message=SimpleNamespace(content="answer"))]
    )
    client.chat.stream.return_value = nullcontext(
        iter(
            [
                SimpleNamespace(
                    data=SimpleNamespace(
                        choices=[SimpleNamespace(delta=SimpleNamespace(content="hello"))]
                    )
                ),
                SimpleNamespace(
                    data=SimpleNamespace(
                        choices=[SimpleNamespace(delta=SimpleNamespace(content=None))]
                    )
                ),
            ]
        )
    )
    constructor = MagicMock(return_value=client)
    monkeypatch.setattr(sdk, "Mistral", constructor)
    provider = AIProviderManager()
    assert provider.call("question", max_tokens=42) == "answer"
    assert provider.call_stream("question", max_tokens=21) == "hello"
    assert client.chat.complete.call_args.kwargs["max_tokens"] == 42
    assert client.chat.stream.call_args.kwargs["max_tokens"] == 21
    assert client.chat.complete.call_args.kwargs["model"] == "mistral-large-latest"
    constructor.assert_called_with(api_key="test-key")


def test_unsupported_provider_rejected():
    with pytest.raises(ValueError):
        AIProviderManager(provider="retired-provider")
