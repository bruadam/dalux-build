"""API response models for Test Plans endpoint."""
from typing import TYPE_CHECKING, List, Optional

from pydantic import BaseModel

from .common import Link, Metadata

if TYPE_CHECKING:
    from typing import Any as TestPlan


class TestPlansListResponse(BaseModel):
    """Response from GET /1.2/projects/{projectId}/testPlans - List test plans."""

    items: List["TestPlan"]
    metadata: Optional[Metadata] = None
    links: Optional[List[Link]] = None

    class Config:
        populate_by_name = True
