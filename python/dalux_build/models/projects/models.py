"""Data models for Projects endpoint."""

from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field


class ProjectModule(BaseModel):
    """Project module model."""

    model_config = ConfigDict(populate_by_name=True)


class Project(BaseModel):
    """Project model."""

    project_id: str = Field(..., alias="projectId")
    project_name: str = Field(..., alias="projectName")
    project_type: str | None = Field(None, alias="type")
    project_template_id: str | None = Field(None, alias="projectTemplateId")
    address: str | None = None
    number: str | None = None
    created: datetime | None = None
    closing: datetime | None = None
    modules: list[ProjectModule] | None = None

    model_config = ConfigDict(populate_by_name=True)


class ProjectMetadata(BaseModel):
    """Project metadata model."""

    key: str
    value: str | None = None

    model_config = ConfigDict(populate_by_name=True)


class ProjectTemplate(BaseModel):
    """Project template model."""

    project_template_id: str = Field(..., alias="projectTemplateId")
    name: str

    model_config = ConfigDict(populate_by_name=True)


class ProjectCompany(BaseModel):
    """Project company model."""

    company_id: str | None = Field(None, alias="companyId")
    name: str | None = None
    vat_number: str | None = Field(None, alias="vatNumber")
    address: str | None = None
    city: str | None = None
    postal_code: str | None = Field(None, alias="postalCode")
    country: str | None = None
    catalog_company_id: str | None = Field(None, alias="catalogCompanyId")

    model_config = ConfigDict(populate_by_name=True)
