"""Data models for File Revisions endpoint."""

from pydantic import BaseModel, ConfigDict


class FileRevision(BaseModel):
    """File revision model."""

    model_config = ConfigDict(populate_by_name=True)
