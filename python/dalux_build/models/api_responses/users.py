"""API response models for Users endpoint."""
from typing import TYPE_CHECKING, List, Optional

from pydantic import BaseModel

from .common import Link, Metadata

if TYPE_CHECKING:
    from ..user import ProjectUser, User


class UsersListResponse(BaseModel):
    """Response from GET /1.2/projects/{projectId}/users - List project users."""

    items: List["ProjectUser"]
    metadata: Optional[Metadata] = None
    links: Optional[List[Link]] = None

    class Config:
        populate_by_name = True


class UserResponse(BaseModel):
    """Response from GET /1.1/users/{userId} - Get single user."""

    data: "User"
    links: Optional[List[Link]] = None

    class Config:
        populate_by_name = True
