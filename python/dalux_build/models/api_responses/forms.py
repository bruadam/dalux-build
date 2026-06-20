"""API response models for Forms endpoint."""
from typing import TYPE_CHECKING, List, Optional

from pydantic import BaseModel

from .common import Link, Metadata

if TYPE_CHECKING:
    from typing import Any as Form


class FormsListResponse(BaseModel):
    """Response from GET /2.2/projects/{projectId}/forms - List forms."""

    items: List["Form"]
    metadata: Optional[Metadata] = None
    links: Optional[List[Link]] = None

    class Config:
        populate_by_name = True


class FormResponse(BaseModel):
    """Response from GET /1.3/projects/{projectId}/forms/{formId} - Get single form."""

    data: "Form"
    links: Optional[List[Link]] = None

    class Config:
        populate_by_name = True
