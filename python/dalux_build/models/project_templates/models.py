"""Data models for Project Templates endpoint."""
from pydantic import BaseModel, Field
from typing import Optional


class ProjectTemplate(BaseModel):
    """Project template model."""

    project_template_id: str = Field(..., alias="projectTemplateId")
    name: str

    class Config:
        populate_by_name = True
