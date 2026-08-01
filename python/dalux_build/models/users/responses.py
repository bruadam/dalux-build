"""API response models for Users endpoint."""

import json

from pydantic import BaseModel, ConfigDict, field_validator

from ...json_types import JSONDict
from ..common import ItemsToDataFrameMixin, Link, Metadata
from .models import ProjectUser, User


class UsersListResponse(ItemsToDataFrameMixin, BaseModel):
    """Response from GET /1.2/projects/{projectId}/users - List project users."""

    items: list[ProjectUser] = []
    metadata: Metadata | None = None
    links: list[Link] | None = None

    model_config = ConfigDict(populate_by_name=True)

    @field_validator("items", mode="before")
    @classmethod
    def unwrap_and_convert_items(cls, v: object) -> list[object]:
        """Automatically unwrap items that have 'data' wrapper and convert to ProjectUser models."""
        if not isinstance(v, list):
            return []

        result: list[object] = []
        for item in v:
            data = item.get("data") if isinstance(item, dict) and "data" in item else item

            if isinstance(data, dict):
                result.append(data)  # Let Pydantic handle the conversion
            elif isinstance(data, ProjectUser):
                result.append(data)

        return result

    @classmethod
    def from_dict(cls, data: JSONDict) -> "UsersListResponse":
        """Create UsersListResponse from a dictionary."""
        return cls.model_validate(data)

    @classmethod
    def from_json(cls, json_str: str | bytes) -> "UsersListResponse":
        """Create UsersListResponse from a JSON string."""
        if isinstance(json_str, bytes):
            json_str = json_str.decode("utf-8")
        data = json.loads(json_str)
        return cls.from_dict(data)


class UserResponse(BaseModel):
    """Response from GET /1.1/users/{userId} - Get single user."""

    data: User
    links: list[Link] | None = None

    model_config = ConfigDict(populate_by_name=True)
