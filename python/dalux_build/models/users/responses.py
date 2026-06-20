"""API response models for Users endpoint."""
import json
from typing import Any, Dict, List, Optional, Union

from pydantic import BaseModel, field_validator

from ..common import Link, Metadata
from .models import ProjectUser, User


class UsersListResponse(BaseModel):
    """Response from GET /1.2/projects/{projectId}/users - List project users."""

    items: List[ProjectUser] = []
    metadata: Optional[Metadata] = None
    links: Optional[List[Link]] = None

    class Config:
        populate_by_name = True

    @field_validator("items", mode="before")
    @classmethod
    def unwrap_and_convert_items(cls, v):
        """Automatically unwrap items that have 'data' wrapper and convert to ProjectUser models."""
        if not isinstance(v, list):
            return []

        result = []
        for item in v:
            data = item.get("data") if isinstance(item, dict) and "data" in item else item

            if isinstance(data, dict):
                result.append(data)  # Let Pydantic handle the conversion
            elif isinstance(data, ProjectUser):
                result.append(data)

        return result

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "UsersListResponse":
        """Create UsersListResponse from a dictionary."""
        return cls.model_validate(data)

    @classmethod
    def from_json(cls, json_str: Union[str, bytes]) -> "UsersListResponse":
        """Create UsersListResponse from a JSON string."""
        if isinstance(json_str, bytes):
            json_str = json_str.decode('utf-8')
        data = json.loads(json_str)
        return cls.from_dict(data)


class UserResponse(BaseModel):
    """Response from GET /1.1/users/{userId} - Get single user."""

    data: User
    links: Optional[List[Link]] = None

    class Config:
        populate_by_name = True
