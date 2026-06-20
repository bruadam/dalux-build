"""API response models for Files endpoint."""
from typing import TYPE_CHECKING, List, Optional

from pydantic import BaseModel

from .common import Link, Metadata

if TYPE_CHECKING:
    from ..file import File


class FilesListResponse(BaseModel):
    """Response from GET /6.1/projects/{projectId}/file_areas/{fileAreaId}/files - List files."""

    items: List["File"]
    metadata: Optional[Metadata] = None
    links: Optional[List[Link]] = None

    class Config:
        populate_by_name = True


class FileResponse(BaseModel):
    """Response from GET /5.0/projects/{projectId}/file_areas/{fileAreaId}/files/{fileId} - Get single file."""

    data: "File"
    links: Optional[List[Link]] = None

    class Config:
        populate_by_name = True
