"""Tests for OpenRouter model discovery/picking (dalux_build.ai.agent.models)."""

import pytest

from dalux_build.ai.agent import models


class _FakeResponse:
    def __init__(self, payload):
        self._payload = payload

    def raise_for_status(self):
        pass

    def json(self):
        return self._payload


_CATALOG = {
    "data": [
        {
            "id": "z-ai/glm-5.2:free",
            "name": "Z.ai: GLM 5.2 (free)",
            "context_length": 256000,
            "pricing": {"prompt": "0", "completion": "0"},
            "supported_parameters": ["tools", "tool_choice", "temperature"],
        },
        {
            "id": "anthropic/claude-3.5-sonnet",
            "name": "Claude 3.5 Sonnet",
            "context_length": 200000,
            "pricing": {"prompt": "0.000003", "completion": "0.000015"},
            "supported_parameters": ["tools", "tool_choice", "temperature"],
        },
        {
            "id": "some-provider/no-tools-model",
            "name": "No Tools Model",
            "context_length": 32000,
            "pricing": {"prompt": "0", "completion": "0"},
            "supported_parameters": ["temperature"],
        },
    ]
}


def test_list_openrouter_models_default_filters_to_tool_capable(monkeypatch):
    monkeypatch.setattr(models.requests, "get", lambda url, timeout: _FakeResponse(_CATALOG))

    result = models.list_openrouter_models()

    ids = {model.id for model in result}
    assert ids == {"z-ai/glm-5.2:free", "anthropic/claude-3.5-sonnet"}


def test_list_openrouter_models_free_only(monkeypatch):
    monkeypatch.setattr(models.requests, "get", lambda url, timeout: _FakeResponse(_CATALOG))

    result = models.list_openrouter_models(free_only=True)

    assert [model.id for model in result] == ["z-ai/glm-5.2:free"]


def test_list_openrouter_models_require_tools_false_includes_everything(monkeypatch):
    monkeypatch.setattr(models.requests, "get", lambda url, timeout: _FakeResponse(_CATALOG))

    result = models.list_openrouter_models(require_tools=False)

    assert len(result) == 3


def test_list_openrouter_models_sorted_by_id(monkeypatch):
    monkeypatch.setattr(models.requests, "get", lambda url, timeout: _FakeResponse(_CATALOG))

    result = models.list_openrouter_models()

    assert [model.id for model in result] == sorted(model.id for model in result)


def test_pick_openrouter_model_returns_selected_id(monkeypatch):
    monkeypatch.setattr(models.requests, "get", lambda url, timeout: _FakeResponse(_CATALOG))
    monkeypatch.setattr("builtins.input", lambda prompt: "1")

    chosen = models.pick_openrouter_model()

    # Results are sorted by id: "anthropic/..." sorts before "z-ai/...".
    assert chosen == "anthropic/claude-3.5-sonnet"


def test_pick_openrouter_model_reprompts_on_invalid_input(monkeypatch, capsys):
    monkeypatch.setattr(models.requests, "get", lambda url, timeout: _FakeResponse(_CATALOG))
    responses = iter(["not-a-number", "99", "2"])
    monkeypatch.setattr("builtins.input", lambda prompt: next(responses))

    chosen = models.pick_openrouter_model()

    assert chosen == "z-ai/glm-5.2:free"
    output = capsys.readouterr().out
    assert "Invalid input" in output
    assert "between 1 and" in output


def test_pick_openrouter_model_raises_when_no_matches(monkeypatch):
    monkeypatch.setattr(models.requests, "get", lambda url, timeout: _FakeResponse({"data": []}))

    with pytest.raises(RuntimeError, match="No OpenRouter models"):
        models.pick_openrouter_model()
