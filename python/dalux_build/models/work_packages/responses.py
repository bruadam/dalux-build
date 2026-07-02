"""API response models for Work Packages endpoint."""
import json
from typing import Any, Dict, List, Optional, Union

from pydantic import BaseModel, field_validator

from ..common import Link, Metadata
from .models import WorkPackage


class WorkPackagesListResponse(BaseModel):
    """Response from GET /1.0/projects/{projectId}/workpackages."""

    items: List[WorkPackage] = []
    metadata: Optional[Metadata] = None
    links: Optional[List[Link]] = None

    class Config:
        populate_by_name = True

    @field_validator("items", mode="before")
    @classmethod
    def unwrap_and_convert_items(cls, value):
        """Normalize both wrapped and unwrapped work package list items."""
        if not isinstance(value, list):
            return []

        result = []
        for item in value:
            data = item.get("data") if isinstance(item, dict) and "data" in item else item
            if isinstance(data, dict):
                result.append(data)
            elif isinstance(data, WorkPackage):
                result.append(data)
        return result

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "WorkPackagesListResponse":
        """Create WorkPackagesListResponse from a dictionary."""
        return cls.model_validate(data)

    @classmethod
    def from_json(cls, json_str: Union[str, bytes]) -> "WorkPackagesListResponse":
        """Create WorkPackagesListResponse from a JSON string."""
        if isinstance(json_str, bytes):
            json_str = json_str.decode("utf-8")
        data = json.loads(json_str)
        return cls.from_dict(data)