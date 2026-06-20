"""Pydantic models for version set related responses."""
from typing import Optional

from pydantic import BaseModel, Field


class VersionSet(BaseModel):
    """Version set model."""

    version_set_id: str = Field(..., alias="versionSetId")
    name: str
    description: Optional[str] = None
    status: Optional[str] = None
    file_area_id: str = Field(..., alias="fileAreaId")

    class Config:
        populate_by_name = True
