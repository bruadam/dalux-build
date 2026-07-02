"""API response models for Tasks endpoint."""
import json
from typing import Any, Dict, List, Optional, Union

from pydantic import BaseModel, field_validator, model_validator

from ..common import Link, Metadata
from .models import Task, TaskAttachment, TaskChange


class TasksListResponse(BaseModel):
    """Response from GET /5.2/projects/{projectId}/tasks - List tasks."""

    items: List[Task] = []
    metadata: Optional[Metadata] = None
    links: Optional[List[Link]] = None

    class Config:
        populate_by_name = True

    @field_validator("items", mode="before")
    @classmethod
    def unwrap_items(cls, v):
        """Automatically unwrap items that have 'data' wrapper."""
        if not isinstance(v, list):
            return []

        unwrapped = []
        for item in v:
            data = item.get("data") if isinstance(item, dict) and "data" in item else item
            unwrapped.append(data)
        return unwrapped

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "TasksListResponse":
        """Create TasksListResponse from a dictionary."""
        return cls.model_validate(data)

    @classmethod
    def from_json(cls, json_str: Union[str, bytes]) -> "TasksListResponse":
        """Create TasksListResponse from a JSON string."""
        if isinstance(json_str, bytes):
            json_str = json_str.decode('utf-8')
        data = json.loads(json_str)
        return cls.from_dict(data)


class TaskResponse(BaseModel):
    """Response from GET /3.4/projects/{projectId}/tasks/{taskId} - Get single task."""

    data: Task
    links: Optional[List[Link]] = None

    class Config:
        populate_by_name = True


class TaskChangeResponse(BaseModel):
    """Response with a single task change payload."""

    data: TaskChange
    links: Optional[List[Link]] = None

    class Config:
        populate_by_name = True


class TaskChanges(BaseModel):
    """Response from GET /2.2/projects/{projectId}/tasks/changes."""

    items: List[TaskChange] = []
    metadata: Optional[Metadata] = None
    links: Optional[List[Link]] = None

    class Config:
        populate_by_name = True

    @model_validator(mode="before")
    @classmethod
    def wrap_list_payloads(cls, values: Any):
        """Allow API payloads that are returned as a bare list."""
        if isinstance(values, list):
            return {"items": values}
        return values

    @field_validator("items", mode="before")
    @classmethod
    def unwrap_items(cls, v):
        """Automatically unwrap items that have 'data' wrapper."""
        if not isinstance(v, list):
            return []

        unwrapped = []
        for item in v:
            data = item.get("data") if isinstance(item, dict) and "data" in item else item
            unwrapped.append(data)
        return unwrapped

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "TaskChanges":
        """Create TaskChanges from a dictionary."""
        return cls.model_validate(data)

    @classmethod
    def from_json(cls, json_str: Union[str, bytes]) -> "TaskChanges":
        """Create TaskChanges from a JSON string."""
        if isinstance(json_str, bytes):
            json_str = json_str.decode("utf-8")
        data = json.loads(json_str)
        return cls.from_dict(data)


class TaskAttachmentsListResponse(BaseModel):
    """Response from GET /1.1/projects/{projectId}/tasks/attachments."""

    items: List[TaskAttachment] = []
    metadata: Optional[Metadata] = None
    links: Optional[List[Link]] = None

    class Config:
        populate_by_name = True

    @field_validator("items", mode="before")
    @classmethod
    def unwrap_items(cls, v):
        """Automatically unwrap items that have 'data' wrapper."""
        if not isinstance(v, list):
            return []

        unwrapped = []
        for item in v:
            data = item.get("data") if isinstance(item, dict) and "data" in item else item
            unwrapped.append(data)
        return unwrapped
