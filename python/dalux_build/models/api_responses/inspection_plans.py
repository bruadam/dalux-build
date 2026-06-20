"""API response models for Inspection Plans endpoint."""
from typing import TYPE_CHECKING, List, Optional

from pydantic import BaseModel

from .common import Link, Metadata

if TYPE_CHECKING:
    from typing import Any as InspectionPlan


class InspectionPlansListResponse(BaseModel):
    """Response from GET /1.2/projects/{projectId}/inspectionPlans - List inspection plans."""

    items: List["InspectionPlan"]
    metadata: Optional[Metadata] = None
    links: Optional[List[Link]] = None

    class Config:
        populate_by_name = True
