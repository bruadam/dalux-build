"""Launch and manage local Streamlit dashboard processes."""

from __future__ import annotations

import importlib.util
import json
import os
import socket
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request
import webbrowser
from dataclasses import dataclass, field
from pathlib import Path
from typing import TextIO

from ..api_client import ApiClient
from ..json_types import JSONDict
from .errors import DashboardStartupError, MissingDashboardDependencies
from .registry import get_template


@dataclass
class DashboardHandle:
    """A running local dashboard and its lifecycle controls."""

    url: str
    _process: subprocess.Popen[str] = field(repr=False)
    _log: TextIO = field(repr=False)

    @property
    def process_id(self) -> int:
        """Return the Streamlit process ID."""
        return self._process.pid

    @property
    def is_running(self) -> bool:
        """Return whether the Streamlit process is still running."""
        return self._process.poll() is None

    def stop(self, timeout: float = 5.0) -> None:
        """Stop the Streamlit process and release its log file."""
        if self.is_running:
            self._process.terminate()
            try:
                self._process.wait(timeout=timeout)
            except subprocess.TimeoutExpired:
                self._process.kill()
                self._process.wait(timeout=timeout)
        if not self._log.closed:
            self._log.close()

    def __enter__(self) -> DashboardHandle:
        return self

    def __exit__(self, exc_type: object, exc_value: object, traceback: object) -> None:
        self.stop()


def _require_dependencies() -> None:
    if importlib.util.find_spec("streamlit") is None or importlib.util.find_spec("plotly") is None:
        raise MissingDashboardDependencies()


def _available_port(port: int | None) -> int:
    if port is not None and not 1 <= port <= 65535:
        raise ValueError("port must be between 1 and 65535")
    if port is not None:
        return port
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as server:
        server.bind(("127.0.0.1", 0))
        return int(server.getsockname()[1])


def _wait_until_ready(process: subprocess.Popen[str], url: str, timeout: float) -> None:
    deadline = time.monotonic() + timeout
    health_url = f"{url}/_stcore/health"
    while time.monotonic() < deadline:
        if process.poll() is not None:
            raise DashboardStartupError(
                f"Dashboard process exited with status {process.returncode} during startup"
            )
        try:
            with urllib.request.urlopen(health_url, timeout=0.25) as response:
                if response.status == 200:
                    return
        except (urllib.error.URLError, TimeoutError):
            time.sleep(0.05)
    raise DashboardStartupError(f"Dashboard did not become ready within {timeout:g} seconds")


def launch_dashboard(
    *,
    resource: str,
    template: str,
    api_client: ApiClient,
    template_options: JSONDict | None = None,
    open_browser: bool = True,
    port: int | None = None,
    startup_timeout: float = 10.0,
) -> DashboardHandle:
    """Start a resource-compatible dashboard in a local Streamlit process."""
    get_template(resource, template)
    options = template_options or {}
    try:
        encoded_options = json.dumps(options)
    except (TypeError, ValueError) as exc:
        raise ValueError("template_options must contain only JSON-compatible values") from exc

    _require_dependencies()
    selected_port = _available_port(port)
    url = f"http://127.0.0.1:{selected_port}"
    app_path = Path(__file__).with_name("app.py")
    command = [
        sys.executable,
        "-m",
        "streamlit",
        "run",
        str(app_path),
        "--server.address=127.0.0.1",
        f"--server.port={selected_port}",
        "--server.headless=true",
        "--browser.gatherUsageStats=false",
    ]
    configuration = api_client.configuration
    environment = {
        **os.environ,
        "DALUX_DASHBOARD_RESOURCE": resource,
        "DALUX_DASHBOARD_TEMPLATE": template,
        "DALUX_DASHBOARD_OPTIONS": encoded_options,
        "DALUX_BASE_URL": configuration.base_url,
        "DALUX_API_KEY": configuration.api_key,
    }
    if configuration.project_id:
        environment["DALUX_PROJECT_ID"] = configuration.project_id
    if configuration.file_area_id:
        environment["DALUX_FILE_AREA_ID"] = configuration.file_area_id

    log = tempfile.TemporaryFile(mode="w+t", encoding="utf-8")
    process = subprocess.Popen(
        command,
        env=environment,
        stdout=log,
        stderr=subprocess.STDOUT,
        text=True,
    )
    try:
        _wait_until_ready(process, url, startup_timeout)
    except Exception:
        if process.poll() is None:
            process.terminate()
            try:
                process.wait(timeout=2.0)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait(timeout=2.0)
        log.close()
        raise

    handle = DashboardHandle(url=url, _process=process, _log=log)
    if open_browser:
        webbrowser.open(url)
    return handle
