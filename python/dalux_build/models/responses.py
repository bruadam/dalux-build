"""Pydantic models for API responses."""
from typing import Any, Dict, List, Optional

from pydantic import BaseModel, Field


class Link(BaseModel):
    """API response link."""

    rel: str
    href: str
    method: Optional[str] = None

    class Config:
        populate_by_name = True


class Metadata(BaseModel):
    """Response metadata."""

    total_items: Optional[int] = Field(None, alias="totalItems")
    total_remaining_items: Optional[int] = Field(None, alias="totalRemainingItems")

    class Config:
        populate_by_name = True


class ListResponse(BaseModel):
    """List response wrapper - items can be any type."""

    items: List[Any] = []
    metadata: Optional[Metadata] = None
    links: Optional[List[Link]] = None

    class Config:
        populate_by_name = True


class ObjectResponse(BaseModel):
    """Object response wrapper - data can be any type."""

    data: Any
    links: Optional[List[Link]] = None

    class Config:
        populate_by_name = True
