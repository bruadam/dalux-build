"""API response models for Tasks endpoint."""

import json

from pydantic import BaseModel, ConfigDict, field_validator, model_validator

from ...json_types import JSONDict
from ..common import ItemsToDataFrameMixin, Link, Metadata
from .models import Task, TaskAttachment, TaskChange


class TasksListResponse(ItemsToDataFrameMixin, BaseModel):
    """Response from GET /5.2/projects/{projectId}/tasks - List tasks."""

    items: list[Task] = []
    metadata: Metadata | None = None
    links: list[Link] | None = None

    model_config = ConfigDict(populate_by_name=True)

    @field_validator("items", mode="before")
    @classmethod
    def unwrap_items(cls, v: object) -> list[object]:
        """Automatically unwrap items that have 'data' wrapper."""
        if not isinstance(v, list):
            return []

        unwrapped = []
        for item in v:
            data = item.get("data") if isinstance(item, dict) and "data" in item else item
            unwrapped.append(data)
        return unwrapped

    @classmethod
    def from_dict(cls, data: JSONDict) -> "TasksListResponse":
        """Create TasksListResponse from a dictionary."""
        return cls.model_validate(data)

    @classmethod
    def from_json(cls, json_str: str | bytes) -> "TasksListResponse":
        """Create TasksListResponse from a JSON string."""
        if isinstance(json_str, bytes):
            json_str = json_str.decode("utf-8")
        data = json.loads(json_str)
        return cls.from_dict(data)


class TaskResponse(BaseModel):
    """Response from GET /3.4/projects/{projectId}/tasks/{taskId} - Get single task."""

    data: Task
    links: list[Link] | None = None

    model_config = ConfigDict(populate_by_name=True)


class TaskChangeResponse(BaseModel):
    """Response with a single task change payload."""

    data: TaskChange
    links: list[Link] | None = None

    model_config = ConfigDict(populate_by_name=True)


class TaskChanges(ItemsToDataFrameMixin, BaseModel):
    """Response from GET /2.2/projects/{projectId}/tasks/changes."""

    items: list[TaskChange] = []
    metadata: Metadata | None = None
    links: list[Link] | None = None

    model_config = ConfigDict(populate_by_name=True)

    @model_validator(mode="before")
    @classmethod
    def wrap_list_payloads(cls, values: object) -> object:
        """Allow API payloads that are returned as a bare list."""
        if isinstance(values, list):
            return {"items": values}
        return values

    @field_validator("items", mode="before")
    @classmethod
    def unwrap_items(cls, v: object) -> list[object]:
        """Automatically unwrap items that have 'data' wrapper."""
        if not isinstance(v, list):
            return []

        unwrapped = []
        for item in v:
            data = item.get("data") if isinstance(item, dict) and "data" in item else item
            unwrapped.append(data)
        return unwrapped

    @classmethod
    def from_dict(cls, data: JSONDict) -> "TaskChanges":
        """Create TaskChanges from a dictionary."""
        return cls.model_validate(data)

    @classmethod
    def from_json(cls, json_str: str | bytes) -> "TaskChanges":
        """Create TaskChanges from a JSON string."""
        if isinstance(json_str, bytes):
            json_str = json_str.decode("utf-8")
        data = json.loads(json_str)
        return cls.from_dict(data)


class TaskAttachmentsListResponse(ItemsToDataFrameMixin, BaseModel):
    """Response from GET /1.1/projects/{projectId}/tasks/attachments."""

    items: list[TaskAttachment] = []
    metadata: Metadata | None = None
    links: list[Link] | None = None

    model_config = ConfigDict(populate_by_name=True)

    @field_validator("items", mode="before")
    @classmethod
    def unwrap_items(cls, v: object) -> list[object]:
        """Automatically unwrap items that have 'data' wrapper."""
        if not isinstance(v, list):
            return []

        unwrapped = []
        for item in v:
            data = item.get("data") if isinstance(item, dict) and "data" in item else item
            unwrapped.append(data)
        return unwrapped
