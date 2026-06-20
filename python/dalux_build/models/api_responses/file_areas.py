"""API response models for File Areas endpoint."""
from typing import TYPE_CHECKING, List, Optional

from pydantic import BaseModel

from .common import Link, Metadata

if TYPE_CHECKING:
    from ..file_area import FileArea


class FileAreasListResponse(BaseModel):
    """Response from GET /5.1/projects/{projectId}/file_areas - List file areas."""

    items: List["FileArea"]
    metadata: Optional[Metadata] = None
    links: Optional[List[Link]] = None

    class Config:
        populate_by_name = True


class FileAreaResponse(BaseModel):
    """Response from GET /1.0/projects/{projectId}/file_areas/{fileAreaId} - Get single file area."""

    data: "FileArea"
    links: Optional[List[Link]] = None

    class Config:
        populate_by_name = True
