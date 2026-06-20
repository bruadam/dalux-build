"""Pydantic models for file area related responses."""
from typing import Optional

from pydantic import BaseModel, Field


class FileArea(BaseModel):
    """File area model."""

    file_area_id: str = Field(..., alias="fileAreaId")
    file_area_name: str = Field(..., alias="fileAreaName")
    file_area_type: str = Field(..., alias="fileAreaType")

    class Config:
        populate_by_name = True
