"""Data models for Version Sets endpoint."""

from pydantic import BaseModel, ConfigDict, Field


class VersionSet(BaseModel):
    """Version set model."""

    version_set_id: str = Field(..., alias="versionSetId")
    name: str
    description: str | None = None
    status: str | None = None
    file_area_id: str = Field(..., alias="fileAreaId")

    model_config = ConfigDict(populate_by_name=True)
