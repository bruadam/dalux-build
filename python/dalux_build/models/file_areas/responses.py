"""API response models for File Areas endpoint."""

import json

from pydantic import BaseModel, ConfigDict, field_validator

from ...json_types import JSONDict
from ..common import ItemsToDataFrameMixin, Link, Metadata
from .models import FileArea


class FileAreasListResponse(ItemsToDataFrameMixin, BaseModel):
    """Response from GET /5.1/projects/{projectId}/file_areas - List file areas."""

    items: list[FileArea] = []
    metadata: Metadata | None = None
    links: list[Link] | None = None

    model_config = ConfigDict(populate_by_name=True)

    @field_validator("items", mode="before")
    @classmethod
    def unwrap_and_convert_items(cls, v: object) -> list[object]:
        """Unwrap items that have a 'data' wrapper and convert to FileArea models."""
        if not isinstance(v, list):
            return []

        result: list[object] = []
        for item in v:
            data = item.get("data") if isinstance(item, dict) and "data" in item else item

            if isinstance(data, dict):
                result.append(data)  # Let Pydantic handle the conversion
            elif isinstance(data, FileArea):
                result.append(data)

        return result

    @classmethod
    def from_dict(cls, data: JSONDict) -> "FileAreasListResponse":
        """Create FileAreasListResponse from a dictionary."""
        return cls.model_validate(data)

    @classmethod
    def from_json(cls, json_str: str | bytes) -> "FileAreasListResponse":
        """Create FileAreasListResponse from a JSON string."""
        if isinstance(json_str, bytes):
            json_str = json_str.decode("utf-8")
        data = json.loads(json_str)
        return cls.from_dict(data)


class FileAreaResponse(BaseModel):
    """Response from GET /1.0/projects/{projectId}/file_areas/{fileAreaId} - Get file area."""

    data: FileArea
    links: list[Link] | None = None

    model_config = ConfigDict(populate_by_name=True)
