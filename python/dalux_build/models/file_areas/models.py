"""Data models for File Areas endpoint."""

from pydantic import BaseModel, ConfigDict, Field


class FileArea(BaseModel):
    """File area model."""

    file_area_id: str = Field(..., alias="fileAreaId")
    file_area_name: str = Field(..., alias="fileAreaName")
    file_area_type: str = Field(..., alias="fileAreaType")

    model_config = ConfigDict(populate_by_name=True)
