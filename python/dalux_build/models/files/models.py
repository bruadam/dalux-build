"""Data models for Files endpoint."""
from datetime import date
from typing import Any, List, Optional

from pydantic import BaseModel, Field


class Reference(BaseModel):
    """Reference model."""

    key: str
    value: str

    class Config:
        populate_by_name = True


class FileIntegerProperty(BaseModel):
    """File integer property model."""

    integer: Optional[float] = None

    class Config:
        populate_by_name = True


class FileDateProperty(BaseModel):
    """File date property model."""

    date: Optional[date] = None

    class Config:
        populate_by_name = True


class FileTextProperty(BaseModel):
    """File text property model."""

    text: Optional[str] = None

    class Config:
        populate_by_name = True


class FileReferenceProperty(BaseModel):
    """File reference property model."""

    reference: Optional[Reference] = None

    class Config:
        populate_by_name = True


class FilePropertyField(BaseModel):
    """File property field model."""

    key: str
    name: str
    values: Optional[List[Any]] = None

    class Config:
        populate_by_name = True


class File(BaseModel):
    """File model."""

    file_id: str = Field(..., alias="fileId")
    file_revision_id: Optional[str] = Field(None, alias="fileRevisionId")
    file_name: str = Field(..., alias="fileName")
    file_area_id: str = Field(..., alias="fileAreaId")
    folder_id: Optional[str] = Field(None, alias="folderId")
    uploaded_by_user_id: Optional[str] = Field(None, alias="uploadedByUserId")
    uploaded: Optional[date] = None
    last_modified_by_user_id: Optional[str] = Field(None, alias="lastModifiedByUserId")
    last_modified: Optional[date] = Field(None, alias="lastModified")
    version: Optional[str] = None
    deleted: Optional[bool] = False
    file_type: Optional[str] = Field(None, alias="fileType")
    file_size: Optional[int] = Field(None, alias="fileSize")
    content_hash: Optional[str] = Field(None, alias="contentHash")
    download_link: Optional[str] = Field(None, alias="downloadLink")
    properties: Optional[List[FilePropertyField]] = None
    saved_file_path: Optional[str] = None
    saved_metadata_path: Optional[str] = None

    class Config:
        populate_by_name = True
