"""Data models for File Upload endpoint."""
from pydantic import BaseModel


class FileUpload(BaseModel):
    """File upload model."""

    class Config:
        populate_by_name = True
