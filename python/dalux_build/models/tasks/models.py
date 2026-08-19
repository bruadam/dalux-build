"""Data models for Tasks endpoint."""

from datetime import date, datetime
from typing import TYPE_CHECKING

from pydantic import BaseModel, ConfigDict, Field, JsonValue, field_validator

if TYPE_CHECKING:
    from ..users import ProjectUser


class Task(BaseModel):
    """Task model."""

    task_id: str | None = Field(None, alias="taskId")

    model_config = ConfigDict(populate_by_name=True, extra="allow")


class TaskListParams(BaseModel):
    """Typed query params for listing tasks."""

    type_id: str | None = Field(None, alias="typeId")
    filter: str | None = Field(None, alias="$filter")
    select: str | None = Field(None, alias="$select")
    order_by: str | None = Field(None, alias="$orderby")
    top: int | None = Field(None, alias="$top")
    skip: int | None = Field(None, alias="$skip")
    bookmark: str | None = None

    model_config = ConfigDict(populate_by_name=True, extra="allow")


class TaskChangeActor(BaseModel):
    """Flexible nested actor model used by task change fields."""

    user_id: str | None = Field(None, alias="userId")
    user: "ProjectUser | None" = Field(None)
    role_id: str | None = Field(None, alias="roleId")
    role_name: str | None = Field(None, alias="roleName")
    user_name: str | None = Field(None, alias="userName")
    name: str | None = None

    model_config = ConfigDict(populate_by_name=True, extra="allow")


class TaskChangeLocation(BaseModel):
    """Flexible nested location model used by task change fields."""

    model_config = ConfigDict(populate_by_name=True, extra="allow")


class TaskChangeFields(BaseModel):
    """Typed fields payload for task change events."""

    current_responsible: TaskChangeActor | None = Field(None, alias="currentResponsible")
    assigned_to: TaskChangeActor | None = Field(None, alias="assignedTo")
    title: str | None = None
    deadline: date | datetime | None = None
    status: str | None = None
    modified_by: TaskChangeActor | None = Field(None, alias="modifiedBy")
    user_defined_fields: dict[str, JsonValue] | None = Field(None, alias="userDefinedFields")
    workpackage_id: str | None = Field(None, alias="workpackageId")
    location: TaskChangeLocation | None = None

    model_config = ConfigDict(populate_by_name=True, extra="allow")

    @field_validator("deadline", mode="before")
    @classmethod
    def normalize_deadline(cls, value: object) -> object:
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
    description: str | None = None
    timestamp: datetime
    action: str
    fields: TaskChangeFields | None = None

    model_config = ConfigDict(populate_by_name=True)


class TaskAttachment(BaseModel):
    """Task attachment model from ``/tasks/attachments`` endpoint."""

    attachment_id: str | None = Field(None, alias="attachmentId")
    task_id: str | None = Field(None, alias="taskId")
    file_id: str | None = Field(None, alias="fileId")

    model_config = ConfigDict(populate_by_name=True, extra="allow")
