"""API response models for Company Catalog endpoint."""
import json
from typing import Any, Dict, List, Optional, Union

from pydantic import BaseModel, field_validator

from ..common import Link, Metadata


class CompanyCatalogListResponse(BaseModel):
    """Response from GET /1.0/companyCatalog - List company catalog."""

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
    def from_dict(cls, data: Dict[str, Any]) -> "CompanyCatalogListResponse":
        """Create CompanyCatalogListResponse from a dictionary."""
        return cls.model_validate(data)

    @classmethod
    def from_json(cls, json_str: Union[str, bytes]) -> "CompanyCatalogListResponse":
        """Create CompanyCatalogListResponse from a JSON string."""
        if isinstance(json_str, bytes):
            json_str = json_str.decode('utf-8')
        data = json.loads(json_str)
        return cls.from_dict(data)


class CompanyCatalogResponse(BaseModel):
    """Response from company catalog detail endpoint."""

    data: Any
    links: Optional[List[Link]] = None

    class Config:
        populate_by_name = True
