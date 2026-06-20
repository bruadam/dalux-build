"""API response models for Tasks endpoint."""
from typing import TYPE_CHECKING, List, Optional

from pydantic import BaseModel

from .common import Link, Metadata

if TYPE_CHECKING:
    from typing import Any as ApiTaskGet


class TasksListResponse(BaseModel):
    """Response from GET /5.2/projects/{projectId}/tasks - List tasks."""

    items: List["ApiTaskGet"]
    metadata: Optional[Metadata] = None
    links: Optional[List[Link]] = None

    class Config:
        populate_by_name = True


class TaskResponse(BaseModel):
    """Response from GET /3.4/projects/{projectId}/tasks/{taskId} - Get single task."""

    data: "ApiTaskGet"
    links: Optional[List[Link]] = None

    class Config:
        populate_by_name = True
