"""Standalone wiring for the shared scheduled monitor."""

from __future__ import annotations

from dalux_build.webhook_server.app import build_app
from dalux_build.webhook_server.controller import Jobs
from dalux_build.webhook_server.crypto import SecretBox
from dalux_build.webhook_server.delivery import DeliveryWorker
from dalux_build.webhook_server.monitor import Monitor
from dalux_build.webhook_server.scheduler import Scheduler
from dalux_build.webhook_server.store import Store
from fastapi import FastAPI

from .config import Settings, get_settings


class AppContext:
    def __init__(self, settings: Settings) -> None:
        settings.validate()
        self.settings = settings
        self.store = Store(settings.state_db_path)
        self.secrets = SecretBox(settings.master_key)
        self.jobs = Jobs(
            self.store, self.secrets, settings.dalux_base_url, settings.default_timezone
        )
        self.monitor = Monitor(self.store, self.secrets)
        self.scheduler = Scheduler(
            self.store,
            self.monitor,
            DeliveryWorker(self.store, self.secrets, settings.max_delivery_attempts),
        )


def create_app(settings: Settings | None = None) -> FastAPI:
    resolved = settings or get_settings()
    ctx = AppContext(resolved)
    app = build_app(
        jobs=ctx.jobs,
        store=ctx.store,
        scheduler=ctx.scheduler,
        management_token=resolved.management_token,
    )
    app.state.ctx = ctx
    return app


def get_app() -> FastAPI:
    return create_app()
