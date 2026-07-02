"""Data models for Work Packages endpoint."""
from typing import Optional

from pydantic import BaseModel, ConfigDict, Field


class WorkPackage(BaseModel):
    """Work package model."""

    workpackage_id: Optional[str] = Field(None, alias="workpackageId")
    company_id: Optional[str] = Field(None, alias="companyId")
    name: Optional[str] = None

    model_config = ConfigDict(populate_by_name=True, extra="allow")
