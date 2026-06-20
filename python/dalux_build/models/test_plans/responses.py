"""API response models for Test Plans endpoint."""
import json
from typing import Any, Dict, List, Optional, Union

from pydantic import BaseModel, field_validator

from ..common import Link, Metadata


class TestPlansListResponse(BaseModel):
    """Response from GET /1.2/projects/{projectId}/testPlans - List test plans."""

    items: List[Any]
    metadata: Optional[Metadata] = None
    links: Optional[List[Link]] = None

    class Config:
        populate_by_name = True

    @field_validator("items", mode="before")
    @classmethod
    def unwrap_items(cls, v):
        """Automatically unwrap items that have 'data' wrapper."""
        if not isinstance(v, list):
            return []

        unwrapped = []
        for item in v:
            data = item.get("data") if isinstance(item, dict) and "data" in item else item
            unwrapped.append(data)
        return unwrapped

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "TestPlansListResponse":
        """Create TestPlansListResponse from a dictionary."""
        return cls.model_validate(data)

    @classmethod
    def from_json(cls, json_str: Union[str, bytes]) -> "TestPlansListResponse":
        """Create TestPlansListResponse from a JSON string."""
        if isinstance(json_str, bytes):
            json_str = json_str.decode('utf-8')
        data = json.loads(json_str)
        return cls.from_dict(data)
