"""API response models for Projects endpoint."""

import json

from pydantic import BaseModel, ConfigDict, field_validator

from ...json_types import JSONDict
from ..common import ItemsToDataFrameMixin, Link, Metadata
from .models import Project


class ProjectsListResponse(ItemsToDataFrameMixin, BaseModel):
    """Response from GET /5.1/projects - List all projects."""

    items: list[Project] = []
    metadata: Metadata | None = None
    links: list[Link] | None = None

    model_config = ConfigDict(populate_by_name=True)

    @field_validator("items", mode="before")
    @classmethod
    def unwrap_and_convert_items(cls, v: object) -> list[object]:
        """Automatically unwrap items that have 'data' wrapper and convert to Project models."""
        if not isinstance(v, list):
            return []

        result: list[object] = []
        for item in v:
            # Unwrap data wrapper if present
            data = item.get("data") if isinstance(item, dict) and "data" in item else item

            # Convert dict to Project model
            if isinstance(data, dict):
                result.append(data)  # Let Pydantic handle the conversion
            elif isinstance(data, Project):
                result.append(data)

        return result

    @classmethod
    def from_dict(cls, data: JSONDict) -> "ProjectsListResponse":
        """Create ProjectsListResponse from a dictionary.

        Args:
            data: Dictionary containing the API response

        Returns:
            ProjectsListResponse instance with all items as Project objects
        """
        return cls.model_validate(data)

    @classmethod
    def from_json(cls, json_str: str | bytes) -> "ProjectsListResponse":
        """Create ProjectsListResponse from a JSON string.

        Args:
            json_str: JSON string or bytes containing the API response

        Returns:
            ProjectsListResponse instance with all items as Project objects
        """
        if isinstance(json_str, bytes):
            json_str = json_str.decode("utf-8")
        data = json.loads(json_str)
        return cls.from_dict(data)


class ProjectResponse(BaseModel):
    """Response from GET /5.0/projects/{projectId} - Get single project."""

    data: Project
    links: list[Link] | None = None

    model_config = ConfigDict(populate_by_name=True)
