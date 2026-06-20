"""API response models for Folders endpoint."""
from typing import TYPE_CHECKING, List, Optional

from pydantic import BaseModel

from .common import Link, Metadata

if TYPE_CHECKING:
    from ..folder import Folder


class FoldersListResponse(BaseModel):
    """Response from GET /5.1/projects/{projectId}/file_areas/{fileAreaId}/folders - List folders."""

    items: List["Folder"]
    metadata: Optional[Metadata] = None
    links: Optional[List[Link]] = None

    class Config:
        populate_by_name = True


class FolderResponse(BaseModel):
    """Response from GET /5.0/projects/{projectId}/file_areas/{fileAreaId}/folders/{folderId} - Get single folder."""

    data: "Folder"
    links: Optional[List[Link]] = None

    class Config:
        populate_by_name = True
