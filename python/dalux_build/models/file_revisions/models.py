"""Data models for File Revisions endpoint."""
from pydantic import BaseModel


class FileRevision(BaseModel):
    """File revision model."""

    class Config:
        populate_by_name = True
