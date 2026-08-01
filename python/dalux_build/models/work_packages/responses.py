"""API response models for Work Packages endpoint."""

import json

from pydantic import BaseModel, ConfigDict, field_validator

from ...json_types import JSONDict
from ..common import ItemsToDataFrameMixin, Link, Metadata
from .models import WorkPackage


class WorkPackagesListResponse(ItemsToDataFrameMixin, BaseModel):
    """Response from GET /1.0/projects/{projectId}/workpackages."""

    items: list[WorkPackage] = []
    metadata: Metadata | None = None
    links: list[Link] | None = None

    model_config = ConfigDict(populate_by_name=True)

    @field_validator("items", mode="before")
    @classmethod
    def unwrap_and_convert_items(cls, value: object) -> list[object]:
        """Normalize both wrapped and unwrapped work package list items."""
        if not isinstance(value, list):
            return []

        result: list[object] = []
        for item in value:
            data = item.get("data") if isinstance(item, dict) and "data" in item else item
            if isinstance(data, dict):
                result.append(data)
            elif isinstance(data, WorkPackage):
                result.append(data)
        return result

    @classmethod
    def from_dict(cls, data: JSONDict) -> "WorkPackagesListResponse":
        """Create WorkPackagesListResponse from a dictionary."""
        return cls.model_validate(data)

    @classmethod
    def from_json(cls, json_str: str | bytes) -> "WorkPackagesListResponse":
        """Create WorkPackagesListResponse from a JSON string."""
        if isinstance(json_str, bytes):
            json_str = json_str.decode("utf-8")
        data = json.loads(json_str)
        return cls.from_dict(data)
