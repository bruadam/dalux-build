"""Data models for Project Templates endpoint."""

from pydantic import BaseModel, ConfigDict, Field


class ProjectTemplate(BaseModel):
    """Project template model."""

    project_template_id: str = Field(..., alias="projectTemplateId")
    name: str

    model_config = ConfigDict(populate_by_name=True)
