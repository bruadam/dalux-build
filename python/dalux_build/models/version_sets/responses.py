"""API response models for Version Sets endpoint."""
import json
from typing import Any, Dict, List, Optional, Union

from pydantic import BaseModel, field_validator

from ..common import Link, Metadata
from .models import VersionSet


class VersionSetsListResponse(BaseModel):
    """Response from GET /2.1/projects/{projectId}/version_sets - List version sets."""

    items: List[VersionSet] = []
    metadata: Optional[Metadata] = None
    links: Optional[List[Link]] = None

    class Config:
        populate_by_name = True

    @field_validator("items", mode="before")
    @classmethod
    def unwrap_and_convert_items(cls, v):
        """Automatically unwrap items that have 'data' wrapper and convert to VersionSet models."""
        if not isinstance(v, list):
            return []

        result = []
        for item in v:
            data = item.get("data") if isinstance(item, dict) and "data" in item else item

            if isinstance(data, dict):
                result.append(data)  # Let Pydantic handle the conversion
            elif isinstance(data, VersionSet):
                result.append(data)

        return result

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "VersionSetsListResponse":
        """Create VersionSetsListResponse from a dictionary."""
        return cls.model_validate(data)

    @classmethod
    def from_json(cls, json_str: Union[str, bytes]) -> "VersionSetsListResponse":
        """Create VersionSetsListResponse from a JSON string."""
        if isinstance(json_str, bytes):
            json_str = json_str.decode('utf-8')
        data = json.loads(json_str)
        return cls.from_dict(data)


class VersionSetResponse(BaseModel):
    """Response from GET /2.0/projects/{projectId}/version_sets/{versionSetId} - Get single version set."""

    data: VersionSet
    links: Optional[List[Link]] = None

    class Config:
        populate_by_name = True
