"""Pydantic models for folder related responses."""
from typing import Optional

from pydantic import BaseModel, Field


class Folder(BaseModel):
    """Folder model."""

    folder_id: str = Field(..., alias="folderId")
    folder_name: str = Field(..., alias="folderName")
    parent_folder_id: Optional[str] = Field(None, alias="parentFolderId")

    class Config:
        populate_by_name = True
