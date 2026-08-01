"""Data models for File Upload endpoint."""

from pydantic import BaseModel, ConfigDict


class FileUpload(BaseModel):
    """File upload model."""

    model_config = ConfigDict(populate_by_name=True)
