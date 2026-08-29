"""Tests for dalux.ai.<resource>.agent() wiring (namespace.py)."""

import pytest

from dalux_build.ai import namespace
from dalux_build.ai.agent import engine as agent_engine
from dalux_build.ai.agent import models as agent_models
from dalux_build.ai.agent import scope as agent_scope
from dalux_build.ai.namespace import AIEndpointProxy


class _Client:
    """Stand-in for DaluxClient; AIEndpointProxy only needs to pass it through."""

    file_areas = object()


def test_agent_resolves_scope_and_launches(monkeypatch):
    client = _Client()
    proxy = AIEndpointProxy(endpoint=object(), resource_name="file", client=client)

    captured = {}

    def fake_resolve_scope(passed_client, **kwargs):
        captured["resolve_scope"] = (passed_client, kwargs)
        return "the-resolved-scope"

    def fake_launch_agent(**kwargs):
        captured["launch_agent"] = kwargs
        return "the-handle"

    monkeypatch.setattr(agent_scope, "resolve_scope", fake_resolve_scope)
    monkeypatch.setattr(agent_engine, "launch_agent", fake_launch_agent)

    result = proxy.agent(folder_id="f1", skill="legal-contract-review")

    assert result == "the-handle"
    resolved_client, resolve_kwargs = captured["resolve_scope"]
    assert resolved_client is client
    assert resolve_kwargs["folder_id"] == "f1"

    launch_kwargs = captured["launch_agent"]
    assert launch_kwargs["scope"] == "the-resolved-scope"
    assert launch_kwargs["client"] is client
    assert launch_kwargs["skill"] == "legal-contract-review"


@pytest.mark.parametrize("resource_name", ["file", "file_area", "folder"])
def test_agent_allowed_on_scoped_resources(monkeypatch, resource_name):
    monkeypatch.setattr(agent_scope, "resolve_scope", lambda client, **kwargs: "scope")
    monkeypatch.setattr(agent_engine, "launch_agent", lambda **kwargs: "handle")
    proxy = AIEndpointProxy(endpoint=object(), resource_name=resource_name, client=_Client())

    assert proxy.agent() == "handle"


def test_agent_raises_not_implemented_on_other_resources():
    proxy = AIEndpointProxy(endpoint=object(), resource_name="task", client=_Client())

    with pytest.raises(NotImplementedError, match="only available"):
        proxy.agent()


def test_agent_requires_client_reference():
    proxy = AIEndpointProxy(endpoint=object(), resource_name="file", client=None)

    with pytest.raises(RuntimeError, match="requires a client reference"):
        proxy.agent()


def test_agent_pick_model_resolves_model_before_launch(monkeypatch):
    monkeypatch.setattr(agent_scope, "resolve_scope", lambda client, **kwargs: "scope")
    captured = {}

    def fake_launch_agent(**kwargs):
        captured["launch_agent"] = kwargs
        return "handle"

    monkeypatch.setattr(agent_engine, "launch_agent", fake_launch_agent)
    monkeypatch.setattr(
        agent_models, "pick_openrouter_model", lambda *, free_only: "picked-model-id"
    )
    proxy = AIEndpointProxy(endpoint=object(), resource_name="file", client=_Client())

    result = proxy.agent(pick_model=True, free_only=True)

    assert result == "handle"
    assert captured["launch_agent"]["model"] == "picked-model-id"


def test_agent_explicit_model_wins_over_pick_model(monkeypatch):
    monkeypatch.setattr(agent_scope, "resolve_scope", lambda client, **kwargs: "scope")
    captured = {}
    monkeypatch.setattr(agent_engine, "launch_agent", lambda **kwargs: captured.update(kwargs))

    def fail_if_called(*, free_only):
        raise AssertionError("pick_openrouter_model should not be called when model is explicit")

    monkeypatch.setattr(agent_models, "pick_openrouter_model", fail_if_called)
    proxy = AIEndpointProxy(endpoint=object(), resource_name="file", client=_Client())

    proxy.agent(model="explicit-model-id", pick_model=True)

    assert captured["model"] == "explicit-model-id"


def test_agent_passes_provider_through_to_launch(monkeypatch):
    monkeypatch.setattr(agent_scope, "resolve_scope", lambda client, **kwargs: "scope")
    captured = {}
    monkeypatch.setattr(agent_engine, "launch_agent", lambda **kwargs: captured.update(kwargs))
    proxy = AIEndpointProxy(endpoint=object(), resource_name="file", client=_Client())

    proxy.agent(provider="mistral", model="mistral-large-latest")

    assert captured["provider"] == "mistral"
    assert captured["model"] == "mistral-large-latest"


def test_agent_pick_model_rejected_for_non_openrouter_provider():
    proxy = AIEndpointProxy(endpoint=object(), resource_name="file", client=_Client())

    with pytest.raises(ValueError, match="provider='openrouter'"):
        proxy.agent(provider="mistral", pick_model=True)


def test_ai_namespace_exposes_file_areas_proxy():
    client = _Client()
    ai_namespace = namespace.AINamespace(client)

    proxy = ai_namespace.file_areas

    assert isinstance(proxy, AIEndpointProxy)
    assert proxy._resource_name == "file_area"
    assert proxy._client is client
    assert ai_namespace.file_areas is proxy  # cached
