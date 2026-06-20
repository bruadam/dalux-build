"""API response models for Companies endpoint."""
from typing import TYPE_CHECKING, List, Optional

from pydantic import BaseModel

from .common import Link, Metadata

if TYPE_CHECKING:
    from ..project import ProjectCompany


class CompaniesListResponse(BaseModel):
    """Response from GET /3.1/projects/{projectId}/companies - List companies."""

    items: List["ProjectCompany"]
    metadata: Optional[Metadata] = None
    links: Optional[List[Link]] = None

    class Config:
        populate_by_name = True


class CompanyResponse(BaseModel):
    """Response from GET /3.0/projects/{projectId}/companies/{companyId} - Get single company."""

    data: "ProjectCompany"
    links: Optional[List[Link]] = None

    class Config:
        populate_by_name = True
