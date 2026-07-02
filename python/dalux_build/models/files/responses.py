"""API response models for Files endpoint."""
import json
from typing import Any, Dict, List, Optional, Union

from pydantic import BaseModel, field_validator

from ..common import Link, Metadata
from .models import File


class FilesListResponse(BaseModel):
    """Response from GET /6.1/projects/{projectId}/file_areas/{fileAreaId}/files - List files."""

    items: List[File] = []
    metadata: Optional[Metadata] = None
    links: Optional[List[Link]] = None

    class Config:
        populate_by_name = True

    @field_validator("items", mode="before")
    @classmethod
    def unwrap_and_convert_items(cls, v):
        """Automatically unwrap items that have 'data' wrapper and convert to File models."""
        if not isinstance(v, list):
            return []

        result = []
        for item in v:
            data = item.get("data") if isinstance(item, dict) and "data" in item else item

            if isinstance(data, dict):
                result.append(data)  # Let Pydantic handle the conversion
            elif isinstance(data, File):
                result.append(data)

        return result


    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "FilesListResponse":
        """Create FilesListResponse from a dictionary."""
        return cls.model_validate(data)

    @classmethod
    def from_json(cls, json_str: Union[str, bytes]) -> "FilesListResponse":
        """Create FilesListResponse from a JSON string."""
        if isinstance(json_str, bytes):
            json_str = json_str.decode('utf-8')
        data = json.loads(json_str)
        return cls.from_dict(data)


class FileResponse(BaseModel):
    """Response from GET /5.0/projects/{projectId}/file_areas/{fileAreaId}/files/{fileId} - Get single file."""

    data: File
    links: Optional[List[Link]] = None

    class Config:
        populate_by_name = True
