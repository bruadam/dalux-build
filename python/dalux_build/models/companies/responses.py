"""API response models for Companies endpoint."""
import json
from typing import Any, Dict, List, Optional, Union

from pydantic import BaseModel, field_validator

from ..common import Link, Metadata
from ..projects.models import ProjectCompany


class CompaniesListResponse(BaseModel):
    """Response from GET /3.1/projects/{projectId}/companies - List companies."""

    items: List[ProjectCompany] = []
    metadata: Optional[Metadata] = None
    links: Optional[List[Link]] = None

    class Config:
        populate_by_name = True

    @field_validator("items", mode="before")
    @classmethod
    def unwrap_and_convert_items(cls, v):
        """Automatically unwrap items that have 'data' wrapper and convert to ProjectCompany models."""
        if not isinstance(v, list):
            return []

        result = []
        for item in v:
            data = item.get("data") if isinstance(item, dict) and "data" in item else item

            if isinstance(data, dict):
                result.append(data)  # Let Pydantic handle the conversion
            elif isinstance(data, ProjectCompany):
                result.append(data)

        return result

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "CompaniesListResponse":
        """Create CompaniesListResponse from a dictionary."""
        return cls.model_validate(data)

    @classmethod
    def from_json(cls, json_str: Union[str, bytes]) -> "CompaniesListResponse":
        """Create CompaniesListResponse from a JSON string."""
        if isinstance(json_str, bytes):
            json_str = json_str.decode('utf-8')
        data = json.loads(json_str)
        return cls.from_dict(data)


class CompanyResponse(BaseModel):
    """Response from GET /3.0/projects/{projectId}/companies/{companyId} - Get single company."""

    data: ProjectCompany
    links: Optional[List[Link]] = None

    class Config:
        populate_by_name = True
