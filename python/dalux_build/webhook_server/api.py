"""Embedded scheduled-monitor API exposed as ``DaluxClient.webhook_server``."""

from __future__ import annotations

from typing import TYPE_CHECKING

from ..api_client import ApiClient
from ..dashboards.api import DashboardApiMixin
from ..models import FileNameFilter
from .errors import WebhookServerAlreadyRunning, WebhookServerNotRunning

if TYPE_CHECKING:
    from .controller import Jobs
    from .models import TestWebhookResponse
    from .runtime import ServerThread
    from .scheduler import Scheduler
    from .store import Store


class WebhookServerApi(DashboardApiMixin):
    dashboard_resource = "webhook_server"

    def __init__(self, api_client: ApiClient) -> None:
        self._client = api_client
        self._api_client = api_client
        self._store: Store | None = None
        self._jobs: Jobs | None = None
        self._scheduler: Scheduler | None = None
        self._server: ServerThread | None = None

    def start(
        self,
        *,
        management_token: str | None = None,
        master_key: str | None = None,
        host: str | None = None,
        port: int | None = None,
        state_db_path: str | None = None,
        default_timezone: str | None = None,
        max_delivery_attempts: int | None = None,
        startup_timeout: float = 5.0,
    ) -> None:
        if self.is_running:
            raise WebhookServerAlreadyRunning("scheduled monitor is already running")
        from .app import build_app
        from .config import MonitorConfig
        from .controller import Jobs
        from .crypto import SecretBox
        from .delivery import DeliveryWorker
        from .monitor import Monitor
        from .runtime import ServerThread
        from .scheduler import Scheduler
        from .store import Store

        env = MonitorConfig.from_env()
        config = MonitorConfig(
            management_token=(
                management_token if management_token is not None else env.management_token
            ),
            master_key=master_key if master_key is not None else env.master_key,
            default_base_url=self._api_client.configuration.base_url,
            default_timezone=default_timezone or env.default_timezone,
            state_db_path=state_db_path or env.state_db_path,
            host=host or env.host,
            port=port if port is not None else env.port,
            max_delivery_attempts=(
                max_delivery_attempts
                if max_delivery_attempts is not None
                else env.max_delivery_attempts
            ),
        )
        config.validate()
        store = Store(config.state_db_path)
        box = SecretBox(config.master_key)
        jobs = Jobs(store, box, config.default_base_url, config.default_timezone)
        monitor = Monitor(store, box)
        scheduler = Scheduler(
            store, monitor, DeliveryWorker(store, box, config.max_delivery_attempts)
        )
        app = build_app(
            jobs=jobs,
            store=store,
            scheduler=scheduler,
            management_token=config.management_token,
        )
        server = ServerThread(app, config.host, config.port)
        server.start_and_wait_ready(startup_timeout)
        self._store, self._jobs, self._scheduler, self._server = store, jobs, scheduler, server

    def register_change_job(
        self,
        *,
        project_id: str,
        file_area_id: str,
        cron: str,
        callback_url: str,
        scope: str = "all",
        file_ids: list[str] | None = None,
        initial_run: str = "baseline",
        timezone: str | None = None,
        callback_auth_type: str = "none",
        callback_secret: str | None = None,
        dalux_api_key: str | None = None,
        dalux_base_url: str | None = None,
        name: str | None = None,
        idempotency_key: str | None = None,
    ) -> str:
        from .models import ChangeJobRequest

        jobs = self._require_jobs()
        request = ChangeJobRequest.model_validate(
            {
                "name": name,
                "projectId": project_id,
                "fileAreaId": file_area_id,
                "daluxApiKey": dalux_api_key or self._api_client.configuration.api_key,
                "daluxBaseUrl": dalux_base_url or self._api_client.configuration.base_url,
                "cron": cron,
                "timezone": timezone,
                "callback": {
                    "url": callback_url,
                    "authType": callback_auth_type,
                    "secret": callback_secret,
                },
                "scope": {"mode": scope, "fileIds": file_ids or []},
                "initialRun": initial_run,
            }
        )
        view, _ = jobs.create(request, idempotency_key)
        return view.job_id

    def register_freshness_job(
        self,
        *,
        project_id: str,
        file_area_id: str,
        cron: str,
        callback_url: str,
        file_name_filter: FileNameFilter,
        max_age: str,
        folder_ids: list[str] | None = None,
        timezone: str | None = None,
        callback_auth_type: str = "none",
        callback_secret: str | None = None,
        dalux_api_key: str | None = None,
        dalux_base_url: str | None = None,
        name: str | None = None,
        idempotency_key: str | None = None,
    ) -> str:
        from .models import FreshnessJobRequest

        jobs = self._require_jobs()
        request = FreshnessJobRequest.model_validate(
            {
                "name": name,
                "projectId": project_id,
                "fileAreaId": file_area_id,
                "daluxApiKey": dalux_api_key or self._api_client.configuration.api_key,
                "daluxBaseUrl": dalux_base_url or self._api_client.configuration.base_url,
                "cron": cron,
                "timezone": timezone,
                "callback": {
                    "url": callback_url,
                    "authType": callback_auth_type,
                    "secret": callback_secret,
                },
                "folderIds": folder_ids or [],
                "fileNameFilter": file_name_filter,
                "maxAge": max_age,
            }
        )
        view, _ = jobs.create(request, idempotency_key)
        return view.job_id

    def unregister_job(self, job_id: str) -> None:
        self._require_jobs().delete(job_id)

    def test_job(self, job_id: str) -> TestWebhookResponse:
        return self._require_jobs().test_webhook(job_id)

    def test_webhook(self, job_id: str) -> TestWebhookResponse:
        return self.test_job(job_id)

    def _require_jobs(self) -> Jobs:
        if self._jobs is None:
            raise WebhookServerNotRunning("call webhook_server.start() before registering jobs")
        return self._jobs

    def stop(self, timeout: float = 5.0) -> None:
        if self._server:
            self._server.stop(timeout)
        if self._scheduler:
            self._scheduler.stop(timeout)
        if self._store:
            self._store.close()
        self._server = self._scheduler = None
        self._jobs = None
        self._store = None

    @property
    def is_running(self) -> bool:
        return self._server is not None and self._server.is_running

    @property
    def url(self) -> str | None:
        return self._server.bound_url if self._server else None
