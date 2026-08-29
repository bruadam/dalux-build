"""Tests for RAG agent process orchestration (dalux_build.ai.agent.engine)."""

import subprocess

import pytest

from dalux_build.ai.agent import engine
from dalux_build.ai.agent.scope import AgentScope
from dalux_build.ai.rag import ingest as rag_ingest
from dalux_build.ai.rag import vectorstore as rag_vectorstore


class FakeProcess:
    def __init__(self, pid):
        self.pid = pid
        self.returncode = None
        self.running = True
        self.terminated = False

    def poll(self):
        return None if self.running else 0

    def terminate(self):
        self.terminated = True
        self.running = False

    def kill(self):
        self.running = False

    def wait(self, timeout=None):
        self.running = False
        return 0


class _Configuration:
    base_url = "https://api.example.test"
    api_key = "top-secret"


class _Client:
    configuration = _Configuration()


def _scope():
    return AgentScope(project_id="p1", file_area_id="fa1", folder_id=None)


def _base_patches(monkeypatch, tmp_path, processes):
    ports = iter([9001, 9002])
    monkeypatch.setattr(engine, "_require_dependencies", lambda: None)
    monkeypatch.setattr(engine, "_require_external_tools", lambda: None)
    monkeypatch.setattr(engine, "_available_port", lambda port: port or next(ports))
    monkeypatch.setattr(
        engine, "_wait_until_ready", lambda process, url, timeout, *, log=None: None
    )
    monkeypatch.setattr(engine, "_write_langgraph_run_dir", lambda cache_key: tmp_path)
    monkeypatch.setattr(engine, "_ensure_ui_checkout", lambda ui_dir, *, log: None)
    monkeypatch.setattr(engine, "resolve_pdf_files", lambda client, scope, **kwargs: [object()])
    monkeypatch.setattr(
        rag_ingest,
        "sync_scope",
        lambda client, cache_key, files, **kwargs: rag_ingest.SyncResult(
            documents=[], dirty_file_ids=frozenset(), removed_file_ids=frozenset()
        ),
    )
    monkeypatch.setattr(rag_vectorstore, "load_or_build", lambda *a, **kw: None)

    processes_iter = iter(processes)

    def fake_popen(command, **kwargs):
        captured = {"command": command, "kwargs": kwargs}
        process = next(processes_iter)
        process.captured = captured
        return process

    monkeypatch.setattr(subprocess, "Popen", fake_popen)
    monkeypatch.setenv("OPENROUTER_API_KEY", "or-secret")


def test_launch_agent_passes_credentials_via_environment(monkeypatch, tmp_path):
    backend = FakeProcess(101)
    ui = FakeProcess(102)
    _base_patches(monkeypatch, tmp_path, [backend, ui])

    handle = engine.launch_agent(scope=_scope(), client=_Client(), open_browser=False)
    try:
        backend_env = backend.captured["kwargs"]["env"]
        backend_command = backend.captured["command"]
        assert "top-secret" not in " ".join(backend_command)
        assert "or-secret" not in " ".join(backend_command)
        assert backend_env["DALUX_API_KEY"] == "top-secret"
        assert backend_env["OPENROUTER_API_KEY"] == "or-secret"
        assert backend_env["DALUX_AGENT_FILE_AREA_ID"] == "fa1"
        assert handle.backend_url == "http://127.0.0.1:9001"
        assert handle.ui_url == "http://localhost:9002"
        assert handle.assistant_id == "dalux_agent"
        assert handle.is_running
    finally:
        handle.stop()

    assert backend.terminated
    assert ui.terminated
    assert not handle.is_running


def test_launch_agent_raises_without_openrouter_key(monkeypatch, tmp_path):
    backend = FakeProcess(101)
    ui = FakeProcess(102)
    _base_patches(monkeypatch, tmp_path, [backend, ui])
    monkeypatch.delenv("OPENROUTER_API_KEY", raising=False)

    with pytest.raises(engine.AgentStartupError, match="OPENROUTER_API_KEY"):
        engine.launch_agent(scope=_scope(), client=_Client(), open_browser=False)


def test_launch_agent_supports_mistral_provider(monkeypatch, tmp_path):
    backend = FakeProcess(101)
    ui = FakeProcess(102)
    _base_patches(monkeypatch, tmp_path, [backend, ui])
    monkeypatch.setenv("MISTRAL_API_KEY", "mistral-secret")

    handle = engine.launch_agent(
        scope=_scope(), client=_Client(), provider="mistral", open_browser=False
    )
    try:
        backend_env = backend.captured["kwargs"]["env"]
        backend_command = backend.captured["command"]
        assert "mistral-secret" not in " ".join(backend_command)
        assert backend_env["MISTRAL_API_KEY"] == "mistral-secret"
        assert backend_env["DALUX_AGENT_PROVIDER"] == "mistral"
    finally:
        handle.stop()


def test_launch_agent_raises_for_unsupported_provider(monkeypatch, tmp_path):
    backend = FakeProcess(101)
    ui = FakeProcess(102)
    _base_patches(monkeypatch, tmp_path, [backend, ui])

    with pytest.raises(engine.AgentStartupError, match="Unsupported provider"):
        engine.launch_agent(
            scope=_scope(), client=_Client(), provider="not-a-real-provider", open_browser=False
        )


def test_launch_agent_raises_without_mistral_key(monkeypatch, tmp_path):
    backend = FakeProcess(101)
    ui = FakeProcess(102)
    _base_patches(monkeypatch, tmp_path, [backend, ui])
    monkeypatch.delenv("MISTRAL_API_KEY", raising=False)

    with pytest.raises(engine.AgentStartupError, match="MISTRAL_API_KEY"):
        engine.launch_agent(
            scope=_scope(), client=_Client(), provider="mistral", open_browser=False
        )


def test_launch_agent_raises_when_scope_has_no_pdfs(monkeypatch, tmp_path):
    backend = FakeProcess(101)
    ui = FakeProcess(102)
    _base_patches(monkeypatch, tmp_path, [backend, ui])
    monkeypatch.setattr(engine, "resolve_pdf_files", lambda client, scope, **kwargs: [])

    with pytest.raises(engine.AgentStartupError, match="No PDF files"):
        engine.launch_agent(scope=_scope(), client=_Client(), open_browser=False)


def test_launch_agent_startup_failure_terminates_backend(monkeypatch, tmp_path):
    backend = FakeProcess(101)
    ui = FakeProcess(102)
    _base_patches(monkeypatch, tmp_path, [backend, ui])

    def fail_startup(process, url, timeout, *, log=None):
        raise engine.AgentStartupError("backend failed")

    monkeypatch.setattr(engine, "_wait_until_ready", fail_startup)

    with pytest.raises(engine.AgentStartupError, match="backend failed"):
        engine.launch_agent(scope=_scope(), client=_Client(), open_browser=False)

    assert backend.terminated


def test_invalid_port_is_rejected():
    with pytest.raises(ValueError, match="between 1 and 65535"):
        engine._available_port(70000)
