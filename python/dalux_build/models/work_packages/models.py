"""Data models for Work Packages endpoint."""

from pydantic import BaseModel, ConfigDict, Field


class WorkPackage(BaseModel):
    """Work package model."""

    workpackage_id: str | None = Field(None, alias="workpackageId")
    company_id: str | None = Field(None, alias="companyId")
    name: str | None = None

    model_config = ConfigDict(populate_by_name=True, extra="allow")
