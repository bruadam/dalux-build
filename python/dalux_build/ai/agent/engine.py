"""Launch a local deep-agent RAG backend (``langgraph dev``) plus its browser
chat UI (``deep-agents-ui``), and manage their lifecycle.

Mirrors the subprocess-launch-and-poll pattern already used for local
Streamlit dashboards (``dalux_build.dashboards.engine``), extended to two
cooperating processes: a Python LangGraph API server and a Node/Next.js
frontend that talks to it.
"""

from __future__ import annotations

import importlib.util
import json
import os
import shutil
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
from typing import TYPE_CHECKING, TextIO

from .errors import AgentStartupError, MissingAgentDependencies
from .scope import AgentScope, resolve_pdf_files

if TYPE_CHECKING:
    from ... import DaluxClient

_GRAPH_NAME = "dalux_agent"
_DEEP_AGENTS_UI_REPO = "https://github.com/langchain-ai/deep-agents-ui.git"

_REQUIRED_MODULES = (
    "deepagents",
    "langgraph_cli",
    "langchain_core",
    "langchain_chroma",
    "langchain_community",
    "langchain_text_splitters",
    "langchain_huggingface",
    "pypdf",
    "platformdirs",
    "yaml",
)

# Maps a provider name to the env var carrying its API key.
_PROVIDER_API_KEY_ENV_VARS = {
    "openrouter": "OPENROUTER_API_KEY",
    "mistral": "MISTRAL_API_KEY",
}


@dataclass
class AgentHandle:
    """A running local RAG agent (backend + chat UI) and its lifecycle controls."""

    backend_url: str
    ui_url: str
    assistant_id: str
    _backend_process: subprocess.Popen[str] = field(repr=False)
    _ui_process: subprocess.Popen[str] = field(repr=False)
    _backend_log: TextIO = field(repr=False)
    _ui_log: TextIO = field(repr=False)

    @property
    def is_running(self) -> bool:
        """Return whether both the backend and UI processes are still running."""
        return self._backend_process.poll() is None and self._ui_process.poll() is None

    def stop(self, timeout: float = 5.0) -> None:
        """Stop both processes and release their log files."""
        for process in (self._ui_process, self._backend_process):
            if process.poll() is None:
                process.terminate()
                try:
                    process.wait(timeout=timeout)
                except subprocess.TimeoutExpired:
                    process.kill()
                    process.wait(timeout=timeout)
        for log in (self._ui_log, self._backend_log):
            if not log.closed:
                log.close()

    def __enter__(self) -> AgentHandle:
        return self

    def __exit__(self, exc_type: object, exc_value: object, traceback: object) -> None:
        self.stop()


def _require_dependencies() -> None:
    if any(importlib.util.find_spec(module) is None for module in _REQUIRED_MODULES):
        raise MissingAgentDependencies()


def _require_external_tools() -> None:
    missing = [tool for tool in ("langgraph", "git", "yarn") if shutil.which(tool) is None]
    if missing:
        raise AgentStartupError(
            "The RAG agent requires these tools on PATH: "
            f"{', '.join(missing)}. Install the LangGraph CLI "
            "('pip install langgraph-cli[inmem]'), git, and Node/Yarn."
        )


def _available_port(port: int | None) -> int:
    if port is not None and not 1 <= port <= 65535:
        raise ValueError("port must be between 1 and 65535")
    if port is not None:
        return port
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as server:
        server.bind(("127.0.0.1", 0))
        return int(server.getsockname()[1])


def _tail_log(log: TextIO, max_chars: int = 4000) -> str:
    """Read a subprocess's captured stdout/stderr, most recent output last."""
    try:
        log.seek(0)
        content = log.read()
    except OSError:
        return "(log unavailable)"
    return content[-max_chars:] if content else "(no output captured)"


def _wait_until_ready(
    process: subprocess.Popen[str], url: str, timeout: float, *, log: TextIO | None = None
) -> None:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if process.poll() is not None:
            message = f"Process exited with status {process.returncode} during startup"
            if log is not None:
                message += f"\n\n--- process output ---\n{_tail_log(log)}"
            raise AgentStartupError(message)
        try:
            with urllib.request.urlopen(url, timeout=0.5):
                return
        except urllib.error.HTTPError:
            # Any HTTP response (even a 404) means the server is up.
            return
        except (urllib.error.URLError, TimeoutError):
            time.sleep(0.25)
    message = f"{url} did not become ready within {timeout:g} seconds"
    if log is not None:
        message += f"\n\n--- process output so far ---\n{_tail_log(log)}"
    raise AgentStartupError(message)


def _write_langgraph_run_dir(cache_key: str) -> Path:
    """Write a tiny per-scope work dir containing langgraph.json + a graph
    re-export, so `langgraph dev` can find the graph via a relative path
    regardless of whether module-path graph references are supported."""
    from ..rag.cache_paths import scope_cache_dir

    run_dir = scope_cache_dir(cache_key) / "langgraph_run"
    run_dir.mkdir(parents=True, exist_ok=True)

    (run_dir / "graph.py").write_text(
        "from dalux_build.ai.agent.graph import graph\n\n__all__ = ['graph']\n",
        encoding="utf-8",
    )
    (run_dir / "langgraph.json").write_text(
        json.dumps({"dependencies": ["."], "graphs": {_GRAPH_NAME: "./graph.py:graph"}}, indent=2),
        encoding="utf-8",
    )
    return run_dir


def _ensure_ui_checkout(ui_dir: Path, *, log: TextIO) -> None:
    if not (ui_dir / "package.json").exists():
        ui_dir.parent.mkdir(parents=True, exist_ok=True)
        subprocess.run(
            ["git", "clone", "--depth", "1", _DEEP_AGENTS_UI_REPO, str(ui_dir)],
            check=True,
            stdout=log,
            stderr=subprocess.STDOUT,
        )
    if not (ui_dir / "node_modules").exists():
        subprocess.run(
            ["yarn", "install"], cwd=ui_dir, check=True, stdout=log, stderr=subprocess.STDOUT
        )


def launch_agent(
    *,
    scope: AgentScope,
    client: DaluxClient,
    skill: str | None = None,
    provider: str = "openrouter",
    model: str | None = None,
    embeddings_provider: str = "local",
    recursive: bool = True,
    file_type: str | None = "document",
    open_browser: bool = True,
    backend_port: int | None = None,
    ui_port: int | None = None,
    ui_repo_dir: str | None = None,
    startup_timeout: float = 300.0,
    verbose: bool = False,
) -> AgentHandle:
    """Sync scope PDFs into a local vector index, then launch the LangGraph
    backend and the deep-agents-ui chat frontend against it.

    ``startup_timeout`` defaults high because the LangGraph backend loads the
    embeddings model (downloading it from Hugging Face on first use) before
    it can serve requests, which can take several minutes on a cold start.
    """
    _require_dependencies()
    _require_external_tools()

    # Deferred until after the dependency check above, so a missing optional
    # 'rag' extra surfaces as MissingAgentDependencies rather than a raw
    # ImportError from importing platformdirs/langchain transitively.
    from ..rag.cache_paths import scope_cache_dir
    from ..rag.ingest import sync_scope
    from ..rag.vectorstore import load_or_build

    api_key_env_var = _PROVIDER_API_KEY_ENV_VARS.get(provider)
    if api_key_env_var is None:
        raise AgentStartupError(
            f"Unsupported provider {provider!r}; supported: {', '.join(_PROVIDER_API_KEY_ENV_VARS)}"
        )
    provider_api_key = os.environ.get(api_key_env_var)
    if not provider_api_key:
        raise AgentStartupError(f"{api_key_env_var} must be set to use provider={provider!r}.")

    cache_key = scope.cache_key()
    files = resolve_pdf_files(
        client, scope, recursive=recursive, file_type=file_type, verbose=verbose
    )
    if not files:
        raise AgentStartupError("No PDF files found in the requested scope.")
    if verbose:
        print(f"Found {len(files)} PDF(s) in scope.")

    sync_result = sync_scope(client, cache_key, files, verbose=verbose)
    load_or_build(
        cache_key,
        sync_result.documents,
        dirty_file_ids=sync_result.dirty_file_ids,
        removed_file_ids=sync_result.removed_file_ids,
        embeddings_provider=embeddings_provider,
        verbose=verbose,
    )

    run_dir = _write_langgraph_run_dir(cache_key)

    configuration = client.configuration
    backend_selected_port = _available_port(backend_port)
    backend_url = f"http://127.0.0.1:{backend_selected_port}"
    backend_environment = {
        **os.environ,
        "DALUX_BASE_URL": configuration.base_url,
        "DALUX_API_KEY": configuration.api_key,
        api_key_env_var: provider_api_key,
        "DALUX_AGENT_PROVIDER": provider,
        "DALUX_AGENT_CACHE_KEY": cache_key,
        "DALUX_AGENT_EMBEDDINGS_PROVIDER": embeddings_provider,
        **scope.to_env(),
    }
    if model:
        backend_environment["DALUX_AGENT_MODEL"] = model
    if skill:
        backend_environment["DALUX_AGENT_SKILL"] = skill
    if verbose:
        backend_environment["DALUX_AGENT_VERBOSE"] = "1"

    if verbose:
        print(f"Starting langgraph dev backend on {backend_url} (cwd={run_dir})...")
    backend_log = tempfile.TemporaryFile(mode="w+t", encoding="utf-8")
    backend_process = subprocess.Popen(
        # --no-reload: graph.py/langgraph.json are generated once per launch
        # and never edited afterward, so file-watch auto-reload only adds
        # risk — it can restart the backend mid-chat (e.g. on incidental
        # writes under the watched directory) and drop the browser's
        # streaming connection to it.
        ["langgraph", "dev", "--no-browser", "--no-reload", "--port", str(backend_selected_port)],
        cwd=run_dir,
        env=backend_environment,
        stdout=backend_log,
        stderr=subprocess.STDOUT,
        text=True,
    )
    try:
        _wait_until_ready(backend_process, f"{backend_url}/docs", startup_timeout, log=backend_log)
    except Exception:
        _terminate(backend_process)
        backend_log.close()
        raise
    if verbose:
        print("Backend ready.")

    ui_dir = Path(ui_repo_dir) if ui_repo_dir else scope_cache_dir("_shared") / "deep-agents-ui"
    ui_selected_port = _available_port(ui_port)
    ui_url = f"http://localhost:{ui_selected_port}"
    ui_log = tempfile.TemporaryFile(mode="w+t", encoding="utf-8")
    ui_process: subprocess.Popen[str] | None = None
    try:
        if verbose:
            print(f"Preparing deep-agents-ui in {ui_dir} (clones/installs on first run)...")
        _ensure_ui_checkout(ui_dir, log=ui_log)
        if verbose:
            print(f"Starting deep-agents-ui on {ui_url}...")
        ui_environment = {**os.environ, "PORT": str(ui_selected_port)}
        ui_process = subprocess.Popen(
            ["yarn", "dev"],
            cwd=ui_dir,
            env=ui_environment,
            stdout=ui_log,
            stderr=subprocess.STDOUT,
            text=True,
        )
        _wait_until_ready(ui_process, ui_url, startup_timeout, log=ui_log)
    except subprocess.CalledProcessError as exc:
        message = (
            f"deep-agents-ui setup failed ({exc}).\n\n--- process output ---\n{_tail_log(ui_log)}"
        )
        _terminate(backend_process)
        if ui_process is not None:
            _terminate(ui_process)
        backend_log.close()
        ui_log.close()
        raise AgentStartupError(message) from exc
    except Exception:
        _terminate(backend_process)
        if ui_process is not None:
            _terminate(ui_process)
        backend_log.close()
        ui_log.close()
        raise
    if verbose:
        print("Chat UI ready.")

    handle = AgentHandle(
        backend_url=backend_url,
        ui_url=ui_url,
        assistant_id=_GRAPH_NAME,
        _backend_process=backend_process,
        _ui_process=ui_process,
        _backend_log=backend_log,
        _ui_log=ui_log,
    )

    print(
        "\nDeep agent chat UI starting.\n"
        f"  Open: {ui_url}\n"
        "  In the settings dialog, enter:\n"
        f"    Deployment URL: {backend_url}\n"
        f"    Assistant ID:   {_GRAPH_NAME}\n",
        file=sys.stderr,
    )
    if open_browser:
        webbrowser.open(ui_url)
    return handle


def _terminate(process: subprocess.Popen[str], timeout: float = 2.0) -> None:
    if process.poll() is None:
        process.terminate()
        try:
            process.wait(timeout=timeout)
        except subprocess.TimeoutExpired:
            process.kill()
            process.wait(timeout=timeout)
