"""Common API response components - shared across all endpoints."""
from typing import Optional

from pydantic import BaseModel, Field


class Link(BaseModel):
    """API response link."""

    rel: str
    href: str
    method: Optional[str] = None

    class Config:
        populate_by_name = True


class Metadata(BaseModel):
    """Response metadata with pagination info."""

    total_items: Optional[int] = Field(None, alias="totalItems")
    total_remaining_items: Optional[int] = Field(None, alias="totalRemainingItems")

    class Config:
        populate_by_name = True
