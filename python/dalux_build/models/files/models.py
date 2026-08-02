"""Data models for Files endpoint."""

import datetime
from datetime import date
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, JsonValue


class Reference(BaseModel):
    """Reference model."""

    key: str
    value: str

    model_config = ConfigDict(populate_by_name=True)


class FileIntegerProperty(BaseModel):
    """File integer property model."""

    integer: float | None = None

    model_config = ConfigDict(populate_by_name=True)


class FileDateProperty(BaseModel):
    """File date property model."""

    # Annotated with `datetime.date` (not the bare `date` import) because the
    # field is also named `date`: in a class body, the `= None` default is
    # stored under the name `date` *before* the annotation `date | None` is
    # evaluated, so a bare `date | None` here resolves to `None | None` and
    # raises TypeError at class-definition time.
    date: datetime.date | None = None

    model_config = ConfigDict(populate_by_name=True)


class FileTextProperty(BaseModel):
    """File text property model."""

    text: str | None = None

    model_config = ConfigDict(populate_by_name=True)


class FileReferenceProperty(BaseModel):
    """File reference property model."""

    reference: Reference | None = None

    model_config = ConfigDict(populate_by_name=True)


class FilePropertyField(BaseModel):
    """File property field model."""

    key: str
    name: str
    values: list[JsonValue] | None = None

    model_config = ConfigDict(populate_by_name=True)


class FileNameFilter(BaseModel):
    """Case-insensitive file name filter rules with regex and wildcard support."""

    contains: list[str] | None = None
    contains_match: Literal["any", "all"] = "any"
    not_contains: list[str] | None = None
    startswith: list[str] | None = None
    not_startswith: list[str] | None = None
    endswith: list[str] | None = None
    not_endswith: list[str] | None = None
    extensions: list[str] | None = None
    not_extensions: list[str] | None = None

    # Regex pattern support
    pattern: str | None = None
    patterns: list[str] | None = None

    # Wildcard (glob) pattern support
    wildcard: str | None = None
    wildcards: list[str] | None = None

    model_config = ConfigDict(populate_by_name=True)


class MissingFileReport(BaseModel):
    """Report of missing files for a version set."""

    version_set_id: str
    missing_files: list[str] = Field(default_factory=list)
    missing_download_links: list[str] = Field(default_factory=list)

    model_config = ConfigDict(populate_by_name=True)


class DownloadResult(BaseModel):
    """Result of a download operation across version sets."""

    downloaded_files: list["File"] = Field(default_factory=list)
    skipped_files: list["File"] = Field(default_factory=list)
    failed_files: list[tuple["File", str]] = Field(default_factory=list)
    missing_report: dict[str, MissingFileReport] = Field(default_factory=dict)

    model_config = ConfigDict(populate_by_name=True)


class File(BaseModel):
    """File model."""

    file_id: str = Field(..., alias="fileId")
    file_revision_id: str | None = Field(None, alias="fileRevisionId")
    file_name: str = Field(..., alias="fileName")
    file_area_id: str = Field(..., alias="fileAreaId")
    folder_id: str | None = Field(None, alias="folderId")
    uploaded_by_user_id: str | None = Field(None, alias="uploadedByUserId")
    uploaded: date | None = None
    last_modified_by_user_id: str | None = Field(None, alias="lastModifiedByUserId")
    last_modified: date | None = Field(None, alias="lastModified")
    version: str | None = None
    deleted: bool | None = False
    file_type: str | None = Field(None, alias="fileType")
    file_size: int | None = Field(None, alias="fileSize")
    content_hash: str | None = Field(None, alias="contentHash")
    download_link: str | None = Field(None, alias="downloadLink")
    properties: list[FilePropertyField] | None = None
    saved_file_path: str | None = None
    saved_metadata_path: str | None = None

    model_config = ConfigDict(populate_by_name=True)
