"""Data models for Tasks endpoint."""
from datetime import date, datetime
from typing import Any, Dict, Optional

from pydantic import BaseModel, ConfigDict, Field, field_validator


class Task(BaseModel):
    """Task model."""

    task_id: Optional[str] = Field(None, alias="taskId")

    model_config = ConfigDict(populate_by_name=True, extra="allow")


class TaskListParams(BaseModel):
    """Typed query params for listing tasks."""

    type_id: Optional[str] = Field(None, alias="typeId")
    filter: Optional[str] = Field(None, alias="$filter")
    select: Optional[str] = Field(None, alias="$select")
    order_by: Optional[str] = Field(None, alias="$orderby")
    top: Optional[int] = Field(None, alias="$top")
    skip: Optional[int] = Field(None, alias="$skip")
    bookmark: Optional[str] = None

    model_config = ConfigDict(populate_by_name=True, extra="allow")


class TaskChangeActor(BaseModel):
    """Flexible nested actor model used by task change fields."""

    user_id: Optional[str] = Field(None, alias="userId")
    role_id: Optional[str] = Field(None, alias="roleId")
    role_name: Optional[str] = Field(None, alias="roleName")
    user_name: Optional[str] = Field(None, alias="userName")
    name: Optional[str] = None

    model_config = ConfigDict(populate_by_name=True, extra="allow")


class TaskChangeLocation(BaseModel):
    """Flexible nested location model used by task change fields."""

    model_config = ConfigDict(populate_by_name=True, extra="allow")


class TaskChangeFields(BaseModel):
    """Typed fields payload for task change events."""

    current_responsible: Optional[TaskChangeActor] = Field(None, alias="currentResponsible")
    assigned_to: Optional[TaskChangeActor] = Field(None, alias="assignedTo")
    title: Optional[str] = None
    deadline: Optional[date | datetime] = None
    status: Optional[str] = None
    modified_by: Optional[TaskChangeActor] = Field(None, alias="modifiedBy")
    user_defined_fields: Optional[Dict[str, Any]] = Field(None, alias="userDefinedFields")
    workpackage_id: Optional[str] = Field(None, alias="workpackageId")
    location: Optional[TaskChangeLocation] = None

    model_config = ConfigDict(populate_by_name=True, extra="allow")

    @field_validator("deadline", mode="before")
    @classmethod
    def normalize_deadline(cls, value: Any) -> Any:
        """Unwrap API payloads where deadline is returned as an object."""
        if isinstance(value, dict):
            if value.get("empty") is True:
                return None
            if "value" in value:
                return value.get("value")
            if "date" in value:
                return value.get("date")
            if "datetime" in value:
                return value.get("datetime")
        return value


class TaskChange(BaseModel):
    """Single task change item from ``/tasks/changes`` endpoint."""

    task_id: str = Field(..., alias="taskId")
    description: Optional[str] = None
    timestamp: datetime
    action: str
    fields: Optional[TaskChangeFields] = None

    class Config:
        populate_by_name = True


class TaskAttachment(BaseModel):
    """Task attachment model from ``/tasks/attachments`` endpoint."""

    attachment_id: Optional[str] = Field(None, alias="attachmentId")
    task_id: Optional[str] = Field(None, alias="taskId")
    file_id: Optional[str] = Field(None, alias="fileId")

    model_config = ConfigDict(populate_by_name=True, extra="allow")
