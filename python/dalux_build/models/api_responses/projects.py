"""API response models for Projects endpoint."""
from typing import TYPE_CHECKING, List, Optional

from pydantic import BaseModel

from .common import Link, Metadata

if TYPE_CHECKING:
    from ..project import Project


class ProjectsListResponse(BaseModel):
    """Response from GET /5.1/projects - List all projects."""

    items: List["Project"]
    metadata: Optional[Metadata] = None
    links: Optional[List[Link]] = None

    class Config:
        populate_by_name = True


class ProjectResponse(BaseModel):
    """Response from GET /5.0/projects/{projectId} - Get single project."""

    data: "Project"
    links: Optional[List[Link]] = None

    class Config:
        populate_by_name = True
