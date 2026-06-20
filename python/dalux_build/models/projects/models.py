"""Data models for Projects endpoint."""
from datetime import datetime
from typing import List, Optional

from pydantic import BaseModel, Field


class ProjectModule(BaseModel):
    """Project module model."""

    class Config:
        populate_by_name = True


class Project(BaseModel):
    """Project model."""

    project_id: str = Field(..., alias="projectId")
    project_name: str = Field(..., alias="projectName")
    project_type: str = Field(..., alias="type")
    project_template_id: Optional[str] = Field(None, alias="projectTemplateId")
    address: Optional[str] = None
    number: Optional[str] = None
    created: Optional[datetime] = None
    closing: Optional[datetime] = None
    modules: Optional[List[ProjectModule]] = None

    class Config:
        populate_by_name = True


class ProjectMetadata(BaseModel):
    """Project metadata model."""

    key: str
    value: Optional[str] = None

    class Config:
        populate_by_name = True


class ProjectTemplate(BaseModel):
    """Project template model."""

    project_template_id: str = Field(..., alias="projectTemplateId")
    name: str

    class Config:
        populate_by_name = True


class ProjectCompany(BaseModel):
    """Project company model."""

    company_id: Optional[str] = Field(None, alias="companyId")
    name: Optional[str] = None
    vat_number: Optional[str] = Field(None, alias="vatNumber")
    address: Optional[str] = None
    city: Optional[str] = None
    postal_code: Optional[str] = Field(None, alias="postalCode")
    country: Optional[str] = None
    catalog_company_id: Optional[str] = Field(None, alias="catalogCompanyId")

    class Config:
        populate_by_name = True
