"""Public ``DaluxClient.webhook_server`` sub-object.

Two usage modes:

* Embedded, in-script: ``dalux.webhook_server.start()`` launches the webhook
  receiver in a background daemon thread and returns once it is accepting
  connections, so ``register()``/``unregister()`` can be called right after in
  the same script — ideal for local testing.
* The standalone ``webhook-server/`` package builds on the same underlying
  modules (``app.py``, ``service.py``, ...) for a long-running, containerized
  deployment; see that package's README for the Docker-based path.

``fastapi``/``uvicorn``/``httpx`` are optional dependencies (the ``webhook``
extra) and are only imported lazily inside :meth:`start`, so a plain
``import dalux_build`` never requires them.
"""
from __future__ import annotations

import os
import threading
from typing import List, Optional

from ..api.files import FilesApi
from ..api_client import ApiClient
from .config import QaConfig, WebhookRuntimeConfig
from .errors import MissingWebhookDependencies, WebhookServerAlreadyRunning
from .service import DaluxFileService
from .store import Store
from .watchlist import WatchedFile, WatchList


class WebhookServerApi:
    def __init__(self, api_client: ApiClient) -> None:
        self._api_client = api_client
        self._files_api = FilesApi(api_client)
        self._watchlist = WatchList()
        self._watchlist_path: Optional[str] = None
        self._store: Optional[Store] = None
        self._server_thread = None
        self._lock = threading.Lock()

    def start(
        self,
        *,
        host: Optional[str] = None,
        port: Optional[int] = None,
        secret: Optional[str] = None,
        signature_header: Optional[str] = None,
        download_dir: Optional[str] = None,
        state_db_path: Optional[str] = None,
        watchlist_path: Optional[str] = None,
        qa_webhook_url: Optional[str] = None,
        qa_webhook_token: Optional[str] = None,
        qa_command: Optional[str] = None,
        startup_timeout: float = 5.0,
    ) -> None:
        """Start the webhook receiver in a background thread and return once ready.

        Settings precedence: keyword arguments here override
        :meth:`WebhookRuntimeConfig.from_env`, which in turn overrides
        hardcoded fallbacks. The Dalux API key/base URL are not settings
        here — they come from the ``DaluxClient`` this sub-object was built
        from.
        """
        with self._lock:
            if self._server_thread is not None and self._server_thread.is_running:
                raise WebhookServerAlreadyRunning(
                    f"webhook_server is already running at {self._server_thread.bound_url}"
                )

            try:
                from . import app as app_module
                from . import runtime
            except ImportError as exc:
                raise MissingWebhookDependencies() from exc

            defaults = WebhookRuntimeConfig.from_env()
            resolved_host = defaults.host if host is None else host
            resolved_port = defaults.port if port is None else port
            resolved_secret = defaults.webhook_secret if secret is None else secret
            resolved_signature_header = (
                defaults.webhook_signature_header
                if signature_header is None
                else signature_header
            )
            resolved_download_dir = (
                defaults.download_dir if download_dir is None else download_dir
            )
            resolved_state_db_path = (
                defaults.state_db_path if state_db_path is None else state_db_path
            )
            resolved_watchlist_path = (
                (defaults.watchlist_path or None) if watchlist_path is None else watchlist_path
            )
            resolved_qa_config = QaConfig(
                qa_webhook_url=(
                    defaults.qa_webhook_url if qa_webhook_url is None else qa_webhook_url
                ),
                qa_webhook_token=(
                    defaults.qa_webhook_token if qa_webhook_token is None else qa_webhook_token
                ),
                qa_command=defaults.qa_command if qa_command is None else qa_command,
            )

            self._watchlist_path = resolved_watchlist_path
            if resolved_watchlist_path and os.path.exists(resolved_watchlist_path):
                self._watchlist.add_many(WatchList.load(resolved_watchlist_path).all())

            self._store = Store(resolved_state_db_path)
            service = DaluxFileService(self._files_api, resolved_download_dir, self._store)
            app = app_module.build_app(
                watchlist=self._watchlist,
                store=self._store,
                service=service,
                webhook_secret=resolved_secret,
                signature_header=resolved_signature_header,
                qa_config=resolved_qa_config,
            )

            server_thread = runtime.ServerThread(app, resolved_host, resolved_port)
            server_thread.start_and_wait_ready(timeout=startup_timeout)
            self._server_thread = server_thread

    def stop(self, timeout: float = 5.0) -> None:
        with self._lock:
            if self._server_thread is None:
                return
            self._server_thread.stop(timeout)
            self._server_thread = None
            if self._store is not None:
                self._store.close()
                self._store = None

    def register(self, project_id: str, file_area_id: str, file_ids: List[str]) -> None:
        """Add files sharing one project/file area to the live watchlist."""
        if not file_ids:
            return
        self._watchlist.add_many(
            [
                WatchedFile(project_id=project_id, file_area_id=file_area_id, file_id=fid)
                for fid in file_ids
            ]
        )
        self._persist_watchlist()

    def unregister(self, file_ids: List[str]) -> None:
        if not file_ids:
            return
        self._watchlist.remove_many(file_ids)
        self._persist_watchlist()

    def list_watched(self) -> List[WatchedFile]:
        return self._watchlist.all()

    def _persist_watchlist(self) -> None:
        if self._watchlist_path:
            self._watchlist.save(self._watchlist_path)

    @property
    def watchlist(self) -> List[WatchedFile]:
        return self._watchlist.all()

    @property
    def is_running(self) -> bool:
        return self._server_thread is not None and self._server_thread.is_running

    @property
    def url(self) -> Optional[str]:
        return self._server_thread.bound_url if self._server_thread is not None else None

    @property
    def webhook_url(self) -> Optional[str]:
        base = self.url
        return f"{base}/webhooks/dalux" if base else None
