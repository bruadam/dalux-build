"""Job registration shared by HTTP and embedded APIs."""

from __future__ import annotations

import json
import sqlite3
import uuid
from datetime import datetime, timezone
from typing import Literal, cast

from .cron import next_run, validate_timezone
from .crypto import SecretBox
from .delivery import send_test_webhook
from .models import (
    CallbackConfig,
    ChangeJobRequest,
    FreshnessJobRequest,
    JobView,
    TestWebhookResponse,
)
from .monitor import build_test_event_payload
from .store import Store


class Jobs:
    def __init__(
        self, store: Store, secrets: SecretBox, default_base_url: str, default_timezone: str
    ) -> None:
        self.store = store
        self.secrets = secrets
        self.default_base_url = default_base_url.rstrip("/")
        self.default_timezone = default_timezone
        validate_timezone(default_timezone)

    def create(
        self, request: ChangeJobRequest | FreshnessJobRequest, idempotency_key: str | None = None
    ) -> tuple[JobView, bool]:
        if idempotency_key:
            existing = self.store.job_by_idempotency(idempotency_key)
            if existing is not None:
                return self.view(existing), False
        timezone_name = request.timezone or self.default_timezone
        validate_timezone(timezone_name)
        base_url = (request.dalux_base_url or self.default_base_url).rstrip("/")
        if not base_url:
            raise ValueError("daluxBaseUrl is required when DALUX_BASE_URL has no default")
        job_id = str(uuid.uuid4())
        kind = "change" if isinstance(request, ChangeJobRequest) else "freshness"
        config = (
            {
                "scope": request.scope.model_dump(by_alias=True),
                "initialRun": request.initial_run,
            }
            if isinstance(request, ChangeJobRequest)
            else {
                "folderIds": request.folder_ids,
                "fileNameFilter": request.file_name_filter.model_dump(exclude_none=True),
                "maxAge": request.max_age,
            }
        )
        following = next_run(request.cron, timezone_name)
        values: dict[str, object] = {
            "job_id": job_id,
            "kind": kind,
            "name": request.name,
            "project_id": request.project_id,
            "file_area_id": request.file_area_id,
            "base_url": base_url,
            "api_key_encrypted": self.secrets.encrypt(request.dalux_api_key),
            "cron": request.cron,
            "timezone": timezone_name,
            "callback_url": str(request.callback.url),
            "callback_auth_type": request.callback.auth_type,
            "callback_secret_encrypted": (
                self.secrets.encrypt(request.callback.secret or "")
                if request.callback.auth_type != "none"
                else None
            ),
            "test_callback_url": (
                str(request.test_callback.url) if request.test_callback else None
            ),
            "test_callback_auth_type": (
                request.test_callback.auth_type if request.test_callback else None
            ),
            "test_callback_secret_encrypted": (
                self.secrets.encrypt(request.test_callback.secret or "")
                if request.test_callback and request.test_callback.auth_type != "none"
                else None
            ),
            "config_json": json.dumps(config, separators=(",", ":")),
            "next_run_at": following.isoformat(),
            "idempotency_key": idempotency_key,
            "created_at": datetime.now(timezone.utc).isoformat(),
        }
        if not self.store.create_job(values):
            if idempotency_key:
                existing = self.store.job_by_idempotency(idempotency_key)
                if existing is not None:
                    return self.view(existing), False
            raise RuntimeError("job could not be created")
        row = self.store.get_job(job_id)
        assert row is not None
        return self.view(row), True

    def delete(self, job_id: str) -> None:
        self.store.delete_job(job_id)

    def set_enabled(self, job_id: str, enabled: bool) -> JobView:
        row = self.store.get_job(job_id)
        if row is None:
            raise KeyError(job_id)
        # Re-arm from "now" on resume so a job paused across several cron
        # cycles doesn't immediately fire a backlog of missed runs.
        following = next_run(row["cron"], row["timezone"]) if enabled else None
        if not self.store.set_enabled(job_id, enabled, following):
            raise KeyError(job_id)
        row = self.store.get_job(job_id)
        assert row is not None
        return self.view(row)

    def test_webhook(self, job_id: str) -> TestWebhookResponse:
        row = self.store.get_job(job_id)
        if row is None:
            raise KeyError(job_id)
        callback = self._test_callback(row)
        event_type = cast(Literal["change", "freshness"], row["kind"])
        payload = build_test_event_payload(self.store, self.secrets, row)
        return send_test_webhook(callback, event_type, payload)

    def _test_callback(self, row: sqlite3.Row) -> CallbackConfig:
        """Resolve the callback for the 'send test webhook' action — the job's
        dedicated test callback (e.g. an n8n /webhook-test/ URL) if one was
        registered, otherwise the production callback."""
        if row["test_callback_url"]:
            encrypted = row["test_callback_secret_encrypted"]
            return CallbackConfig.model_validate(
                {
                    "url": row["test_callback_url"],
                    "authType": row["test_callback_auth_type"] or "none",
                    "secret": self.secrets.decrypt(encrypted) if encrypted else None,
                }
            )
        encrypted = row["callback_secret_encrypted"]
        return CallbackConfig.model_validate(
            {
                "url": row["callback_url"],
                "authType": row["callback_auth_type"],
                "secret": self.secrets.decrypt(encrypted) if encrypted else None,
            }
        )

    @staticmethod
    def view(row: sqlite3.Row) -> JobView:
        return JobView(
            jobId=row["job_id"],
            type=row["kind"],
            name=row["name"],
            projectId=row["project_id"],
            fileAreaId=row["file_area_id"],
            daluxBaseUrl=row["base_url"],
            cron=row["cron"],
            timezone=row["timezone"],
            callbackUrl=row["callback_url"],
            callbackAuthType=row["callback_auth_type"],
            testCallbackUrl=row["test_callback_url"],
            testCallbackAuthType=row["test_callback_auth_type"],
            nextRunAt=datetime.fromisoformat(row["next_run_at"]),
            enabled=bool(row["enabled"]),
        )
