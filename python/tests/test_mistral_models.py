"""Mistral catalog filtering and interactive selection."""

from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest

from dalux_build.ai.agent import models


def test_list_models_filters_for_chat_and_tools(monkeypatch):
    sdk = pytest.importorskip("mistralai.client")
    monkeypatch.setenv("MISTRAL_API_KEY", "test-key")
    client = MagicMock()
    client.models.list.return_value.data = [
        SimpleNamespace(
            id=name,
            name=name,
            max_context_length=32000,
            capabilities=SimpleNamespace(completion_chat=chat, function_calling=tools),
        )
        for name, chat, tools in [
            ("z-model", True, True),
            ("a-model", True, True),
            ("embedding", False, False),
            ("no-tools", True, False),
        ]
    ]
    constructor = MagicMock()
    constructor.return_value.__enter__.return_value = client
    monkeypatch.setattr(sdk, "Mistral", constructor)
    assert [model.id for model in models.list_mistral_models()] == ["a-model", "z-model"]
    constructor.assert_called_once_with(api_key="test-key")


def test_pick_model_reprompts_and_selects(monkeypatch):
    monkeypatch.setattr(
        models,
        "list_mistral_models",
        lambda: [models.MistralModel("mistral-large-latest", "Large", 32000)],
    )
    answers = iter(["invalid", "99", "1"])
    monkeypatch.setattr("builtins.input", lambda prompt: next(answers))
    assert models.pick_mistral_model() == "mistral-large-latest"


def test_pick_model_rejects_empty_catalog(monkeypatch):
    monkeypatch.setattr(models, "list_mistral_models", lambda: [])
    with pytest.raises(RuntimeError, match="No Mistral"):
        models.pick_mistral_model()
