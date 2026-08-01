"""API response models for Folders endpoint."""

import json

from pydantic import BaseModel, ConfigDict, field_validator

from ...json_types import JSONDict
from ..common import ItemsToDataFrameMixin, Link, Metadata
from .models import Folder


class FoldersListResponse(ItemsToDataFrameMixin, BaseModel):
    """Response from GET .../file_areas/{fileAreaId}/folders - List folders."""

    items: list[Folder] = []
    metadata: Metadata | None = None
    links: list[Link] | None = None

    model_config = ConfigDict(populate_by_name=True)

    @field_validator("items", mode="before")
    @classmethod
    def unwrap_and_convert_items(cls, v: object) -> list[object]:
        """Unwrap items that have a 'data' wrapper and convert to Folder models."""
        if not isinstance(v, list):
            return []

        result: list[object] = []
        for item in v:
            data = item.get("data") if isinstance(item, dict) and "data" in item else item

            if isinstance(data, dict):
                result.append(data)  # Let Pydantic handle the conversion
            elif isinstance(data, Folder):
                result.append(data)

        return result

    @classmethod
    def from_dict(cls, data: JSONDict) -> "FoldersListResponse":
        """Create FoldersListResponse from a dictionary."""
        return cls.model_validate(data)

    @classmethod
    def from_json(cls, json_str: str | bytes) -> "FoldersListResponse":
        """Create FoldersListResponse from a JSON string."""
        if isinstance(json_str, bytes):
            json_str = json_str.decode("utf-8")
        data = json.loads(json_str)
        return cls.from_dict(data)


class FolderResponse(BaseModel):
    """Response from GET .../file_areas/{fileAreaId}/folders/{folderId} - Get folder."""

    data: Folder
    links: list[Link] | None = None

    model_config = ConfigDict(populate_by_name=True)
