"""Public models for scheduled Dalux file monitoring."""

from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, HttpUrl, model_validator

from ..models import FileNameFilter


class CallbackConfig(BaseModel):
    url: HttpUrl
    auth_type: Literal["none", "bearer", "hmac-sha256"] = Field("none", alias="authType")
    secret: str | None = None

    model_config = ConfigDict(populate_by_name=True)

    @model_validator(mode="after")
    def validate_secret(self) -> CallbackConfig:
        if self.auth_type != "none" and not self.secret:
            raise ValueError("callback secret is required for bearer and hmac-sha256 auth")
        return self


class FileScope(BaseModel):
    mode: Literal["all", "fileIds"]
    file_ids: list[str] = Field(default_factory=list, alias="fileIds")

    model_config = ConfigDict(populate_by_name=True)

    @model_validator(mode="after")
    def validate_ids(self) -> FileScope:
        if self.mode == "fileIds" and not self.file_ids:
            raise ValueError("fileIds scope requires at least one file ID")
        if self.mode == "all" and self.file_ids:
            raise ValueError("all scope must not include fileIds")
        return self


class JobBaseRequest(BaseModel):
    name: str | None = None
    project_id: str = Field(alias="projectId")
    file_area_id: str = Field(alias="fileAreaId")
    dalux_api_key: str = Field(alias="daluxApiKey", min_length=1)
    dalux_base_url: str | None = Field(None, alias="daluxBaseUrl")
    cron: str
    timezone: str | None = None
    callback: CallbackConfig

    model_config = ConfigDict(populate_by_name=True)


class ChangeJobRequest(JobBaseRequest):
    scope: FileScope
    initial_run: Literal["baseline", "emitCurrent"] = Field("baseline", alias="initialRun")


class FreshnessJobRequest(JobBaseRequest):
    folder_ids: list[str] = Field(default_factory=list, alias="folderIds")
    file_name_filter: FileNameFilter = Field(alias="fileNameFilter")
    max_age: str = Field(alias="maxAge", pattern=r"^P[1-9][0-9]*D$")

    @model_validator(mode="after")
    def require_filter(self) -> FreshnessJobRequest:
        values = self.file_name_filter.model_dump(exclude_none=True)
        if not any(value for key, value in values.items() if key != "contains_match"):
            raise ValueError("fileNameFilter must contain at least one filename rule")
        return self


class TestWebhookResponse(BaseModel):
    delivery_id: str = Field(alias="deliveryId")
    event_type: Literal["change", "freshness"] = Field(alias="eventType")
    status_code: int = Field(alias="statusCode")

    model_config = ConfigDict(populate_by_name=True)


class JobView(BaseModel):
    job_id: str = Field(alias="jobId")
    type: Literal["change", "freshness"]
    name: str | None
    project_id: str = Field(alias="projectId")
    file_area_id: str = Field(alias="fileAreaId")
    dalux_base_url: str = Field(alias="daluxBaseUrl")
    cron: str
    timezone: str
    callback_url: str = Field(alias="callbackUrl")
    callback_auth_type: str = Field(alias="callbackAuthType")
    next_run_at: datetime = Field(alias="nextRunAt")

    model_config = ConfigDict(populate_by_name=True)
