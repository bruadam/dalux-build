"""Run a FastAPI app with uvicorn in a background daemon thread.

Only ever imported lazily (from ``WebhookServerApi.start()``), so importing
``uvicorn`` at module scope is safe — it is never touched by a plain
``import dalux_build``.
"""

from __future__ import annotations

import threading
import time

import uvicorn
from fastapi import FastAPI


class ServerThread:
    """Wraps a ``uvicorn.Server`` running in a background daemon thread."""

    def __init__(self, app: FastAPI, host: str, port: int) -> None:
        self._host = host
        self._port = port
        config = uvicorn.Config(app, host=host, port=port, log_level="info")
        self._server = uvicorn.Server(config)
        self._thread = threading.Thread(target=self._server.run, daemon=True)

    def start_and_wait_ready(self, timeout: float = 5.0) -> None:
        self._thread.start()
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            if self._server.started:
                return
            time.sleep(0.05)
        raise TimeoutError(
            f"webhook server did not start within {timeout}s on {self._host}:{self._port}"
        )

    def stop(self, timeout: float = 5.0) -> None:
        self._server.should_exit = True
        self._thread.join(timeout)

    @property
    def is_running(self) -> bool:
        return self._thread.is_alive() and self._server.started and not self._server.should_exit

    @property
    def bound_url(self) -> str | None:
        if not self.is_running:
            return None
        return f"http://{self._host}:{self._port}"
