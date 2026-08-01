"""FastAPI application exposing the webhook receiver and a conditional download endpoint.

The endpoint logic itself lives in ``dalux_build.webhook_server.app.build_app``
(shared with the embedded ``DaluxClient.webhook_server``); this module only
wires up this package's own env-var-driven configuration (``Settings``) and
builds the collaborators (``Store``, ``WatchList``, ``DaluxService``) from it,
since this CLI process legitimately owns its own long-lived ``create_client()``
session rather than being handed one.

Endpoints:

* ``GET  /healthz``           - liveness probe.
* ``POST /webhooks/dalux``    - receive Dalux file-change webhooks.
* ``GET  /files/{file_id}``   - conditional download for pull-based clients
                                (honours ``If-None-Match`` and returns 304).
"""

from __future__ import annotations

import logging
import os

from dalux_build import create_client
from dalux_build.webhook_server.app import build_app
from dalux_build.webhook_server.config import QaConfig
from fastapi import FastAPI

from . import qa
from .config import Settings, get_settings
from .dalux import DaluxService
from .store import Store
from .watchlist import WatchList

logger = logging.getLogger("dalux_webhook.app")


class AppContext:
    """Holds the long-lived collaborators wired from settings."""

    def __init__(self, settings: Settings) -> None:
        settings.require_dalux()
        self.settings = settings
        self.store = Store(settings.state_db_path)
        self.watchlist = (
            WatchList.load(settings.watchlist_path)
            if os.path.exists(settings.watchlist_path)
            else WatchList([])
        )
        client = create_client(base_url=settings.dalux_base_url, api_key=settings.dalux_api_key)
        self.dalux = DaluxService(client.files, settings.download_dir, self.store)
        self.qa_config = QaConfig(
            qa_webhook_url=settings.qa_webhook_url,
            qa_webhook_token=settings.qa_webhook_token,
            qa_command=settings.qa_command,
        )


def create_app(settings: Settings | None = None) -> FastAPI:
    settings = settings or get_settings()
    ctx = AppContext(settings)

    app = build_app(
        watchlist=ctx.watchlist,
        store=ctx.store,
        service=ctx.dalux,
        webhook_secret=settings.webhook_secret,
        signature_header=settings.webhook_signature_header,
        qa_config=ctx.qa_config,
        # Delegate through this package's own qa.trigger (not the shared
        # module's) so `monkeypatch.setattr(qa, "trigger", ...)` in this
        # package's tests keeps working.
        qa_trigger=lambda _qa_config, event: qa.trigger(settings, event),
    )
    app.state.ctx = ctx
    return app


app = None


def get_app() -> FastAPI:
    """Lazy app factory used by ``uvicorn dalux_webhook.app:get_app --factory``."""
    return create_app()
