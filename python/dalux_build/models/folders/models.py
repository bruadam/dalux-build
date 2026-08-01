"""Data models for Folders endpoint."""

from pydantic import BaseModel, ConfigDict, Field


class Folder(BaseModel):
    """Folder model."""

    folder_id: str = Field(..., alias="folderId")
    folder_name: str = Field(..., alias="folderName")
    parent_folder_id: str | None = Field(None, alias="parentFolderId")

    model_config = ConfigDict(populate_by_name=True)
