"""API response models for Version Sets endpoint."""
from typing import TYPE_CHECKING, List, Optional

from pydantic import BaseModel

from .common import Link, Metadata

if TYPE_CHECKING:
    from ..version_set import VersionSet


class VersionSetsListResponse(BaseModel):
    """Response from GET /2.1/projects/{projectId}/version_sets - List version sets."""

    items: List["VersionSet"]
    metadata: Optional[Metadata] = None
    links: Optional[List[Link]] = None

    class Config:
        populate_by_name = True


class VersionSetResponse(BaseModel):
    """Response from GET /2.0/projects/{projectId}/version_sets/{versionSetId} - Get single version set."""

    data: "VersionSet"
    links: Optional[List[Link]] = None

    class Config:
        populate_by_name = True
