"""Tests for dashboard process launching and lifecycle."""

import subprocess

import pytest

from dalux_build.api_client import ApiClient
from dalux_build.configuration import Configuration
from dalux_build.dashboards import engine


class FakeProcess:
    pid = 321
    returncode = None

    def __init__(self):
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


def _api_client():
    return ApiClient(
        Configuration(
            base_url="https://api.example.test",
            api_key="top-secret",
            project_id="p1",
        )
    )


def test_launch_uses_environment_for_credentials(monkeypatch):
    captured = {}
    process = FakeProcess()

    def fake_popen(command, **kwargs):
        captured["command"] = command
        captured["environment"] = kwargs["env"]
        return process

    monkeypatch.setattr(engine, "_require_dependencies", lambda: None)
    monkeypatch.setattr(engine, "_available_port", lambda port: 8765)
    monkeypatch.setattr(engine, "_wait_until_ready", lambda process, url, timeout: None)
    monkeypatch.setattr(subprocess, "Popen", fake_popen)

    handle = engine.launch_dashboard(
        resource="tasks",
        template="task-timeline",
        api_client=_api_client(),
        template_options={"timezone": "UTC"},
        open_browser=False,
    )
    try:
        command = captured["command"]
        environment = captured["environment"]
        assert "top-secret" not in " ".join(command)
        assert environment["DALUX_API_KEY"] == "top-secret"
        assert environment["DALUX_PROJECT_ID"] == "p1"
        assert handle.url == "http://127.0.0.1:8765"
        assert handle.process_id == 321
        assert handle.is_running
    finally:
        handle.stop()

    assert process.terminated
    assert not handle.is_running


def test_invalid_port_is_rejected():
    with pytest.raises(ValueError, match="between 1 and 65535"):
        engine._available_port(70000)


def test_startup_failure_terminates_process(monkeypatch):
    process = FakeProcess()
    monkeypatch.setattr(engine, "_require_dependencies", lambda: None)
    monkeypatch.setattr(engine, "_available_port", lambda port: 8765)
    monkeypatch.setattr(subprocess, "Popen", lambda *args, **kwargs: process)

    def fail_startup(process, url, timeout):
        raise engine.DashboardStartupError("failed")

    monkeypatch.setattr(engine, "_wait_until_ready", fail_startup)

    with pytest.raises(engine.DashboardStartupError, match="failed"):
        engine.launch_dashboard(
            resource="tasks",
            template="task-timeline",
            api_client=_api_client(),
            open_browser=False,
        )

    assert process.terminated
