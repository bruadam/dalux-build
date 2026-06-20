"""API Response models - one per endpoint, matching API documentation exactly."""
from typing import Any, List, Optional

from pydantic import BaseModel, Field


class Link(BaseModel):
    """API response link."""

    rel: str
    href: str
    method: Optional[str] = None

    class Config:
        populate_by_name = True


class Metadata(BaseModel):
    """Response metadata with pagination info."""

    total_items: Optional[int] = Field(None, alias="totalItems")
    total_remaining_items: Optional[int] = Field(None, alias="totalRemainingItems")

    class Config:
        populate_by_name = True


# ===========================
# Project Responses
# ===========================


class ProjectsListResponse(BaseModel):
    """Response from GET /5.1/projects - List all projects."""

    items: List["Project"]
    metadata: Optional[Metadata] = None
    links: Optional[List[Link]] = None

    class Config:
        populate_by_name = True


class ProjectResponse(BaseModel):
    """Response from GET /5.0/projects/{projectId} - Get single project."""

    data: "Project"
    links: Optional[List[Link]] = None

    class Config:
        populate_by_name = True


# ===========================
# File Area Responses
# ===========================


class FileAreasListResponse(BaseModel):
    """Response from GET /5.1/projects/{projectId}/file_areas - List file areas."""

    items: List["FileArea"]
    metadata: Optional[Metadata] = None
    links: Optional[List[Link]] = None

    class Config:
        populate_by_name = True


class FileAreaResponse(BaseModel):
    """Response from GET /1.0/projects/{projectId}/file_areas/{fileAreaId} - Get single file area."""

    data: "FileArea"
    links: Optional[List[Link]] = None

    class Config:
        populate_by_name = True


# ===========================
# Folder Responses
# ===========================


class FoldersListResponse(BaseModel):
    """Response from GET /5.1/projects/{projectId}/file_areas/{fileAreaId}/folders - List folders."""

    items: List["Folder"]
    metadata: Optional[Metadata] = None
    links: Optional[List[Link]] = None

    class Config:
        populate_by_name = True


class FolderResponse(BaseModel):
    """Response from GET /5.0/projects/{projectId}/file_areas/{fileAreaId}/folders/{folderId} - Get single folder."""

    data: "Folder"
    links: Optional[List[Link]] = None

    class Config:
        populate_by_name = True


# ===========================
# File Responses
# ===========================


class FilesListResponse(BaseModel):
    """Response from GET /6.1/projects/{projectId}/file_areas/{fileAreaId}/files - List files."""

    items: List["File"]
    metadata: Optional[Metadata] = None
    links: Optional[List[Link]] = None

    class Config:
        populate_by_name = True


class FileResponse(BaseModel):
    """Response from GET /5.0/projects/{projectId}/file_areas/{fileAreaId}/files/{fileId} - Get single file."""

    data: "File"
    links: Optional[List[Link]] = None

    class Config:
        populate_by_name = True


# ===========================
# Version Set Responses
# ===========================


class VersionSetsListResponse(BaseModel):
    """Response from GET /2.1/projects/{projectId}/version_sets - List version sets."""

    items: List["VersionSet"]
    metadata: Optional[Metadata] = None
    links: Optional[List[Link]] = None

    class Config:
        populate_by_name = True


class VersionSetResponse(BaseModel):
    """Response from GET /2.0/projects/{projectId}/version_sets/{versionSetId} - Get single version set."""

    data: "VersionSet"
    links: Optional[List[Link]] = None

    class Config:
        populate_by_name = True


# ===========================
# User Responses
# ===========================


class UsersListResponse(BaseModel):
    """Response from GET /1.2/projects/{projectId}/users - List project users."""

    items: List["ProjectUser"]
    metadata: Optional[Metadata] = None
    links: Optional[List[Link]] = None

    class Config:
        populate_by_name = True


class UserResponse(BaseModel):
    """Response from GET /1.1/users/{userId} - Get single user."""

    data: "User"
    links: Optional[List[Link]] = None

    class Config:
        populate_by_name = True


# ===========================
# Company Responses
# ===========================


class CompaniesListResponse(BaseModel):
    """Response from GET /3.1/projects/{projectId}/companies - List companies."""

    items: List["ProjectCompany"]
    metadata: Optional[Metadata] = None
    links: Optional[List[Link]] = None

    class Config:
        populate_by_name = True


class CompanyResponse(BaseModel):
    """Response from GET /3.0/projects/{projectId}/companies/{companyId} - Get single company."""

    data: "ProjectCompany"
    links: Optional[List[Link]] = None

    class Config:
        populate_by_name = True


# ===========================
# Inspection Plan Responses
# ===========================


class InspectionPlansListResponse(BaseModel):
    """Response from GET /1.2/projects/{projectId}/inspectionPlans - List inspection plans."""

    items: List["InspectionPlan"]
    metadata: Optional[Metadata] = None
    links: Optional[List[Link]] = None

    class Config:
        populate_by_name = True


# ===========================
# Test Plan Responses
# ===========================


class TestPlansListResponse(BaseModel):
    """Response from GET /1.2/projects/{projectId}/testPlans - List test plans."""

    items: List["TestPlan"]
    metadata: Optional[Metadata] = None
    links: Optional[List[Link]] = None

    class Config:
        populate_by_name = True


# ===========================
# Form Responses
# ===========================


class FormsListResponse(BaseModel):
    """Response from GET /2.2/projects/{projectId}/forms - List forms."""

    items: List["Form"]
    metadata: Optional[Metadata] = None
    links: Optional[List[Link]] = None

    class Config:
        populate_by_name = True


class FormResponse(BaseModel):
    """Response from GET /1.3/projects/{projectId}/forms/{formId} - Get single form."""

    data: "Form"
    links: Optional[List[Link]] = None

    class Config:
        populate_by_name = True


# ===========================
# Task Responses
# ===========================


class TasksListResponse(BaseModel):
    """Response from GET /5.2/projects/{projectId}/tasks - List tasks."""

    items: List["ApiTaskGet"]
    metadata: Optional[Metadata] = None
    links: Optional[List[Link]] = None

    class Config:
        populate_by_name = True


class TaskResponse(BaseModel):
    """Response from GET /3.4/projects/{projectId}/tasks/{taskId} - Get single task."""

    data: "ApiTaskGet"
    links: Optional[List[Link]] = None

    class Config:
        populate_by_name = True


# ===========================
# Forward references - import at the end to avoid circular imports
# ===========================

from .file import File, FilePropertyField  # noqa: E402
from .file_area import FileArea  # noqa: E402
from .folder import Folder  # noqa: E402
from .project import Project, ProjectCompany, ProjectUser  # noqa: E402
from .user import User  # noqa: E402
from .version_set import VersionSet  # noqa: E402

# Placeholder imports - these will be added as we create the models
try:
    from .inspection_plan import InspectionPlan  # noqa: E402
except ImportError:
    InspectionPlan = Any  # type: ignore

try:
    from .test_plan import TestPlan  # noqa: E402
except ImportError:
    TestPlan = Any  # type: ignore

try:
    from .form import Form  # noqa: E402
except ImportError:
    Form = Any  # type: ignore

try:
    from .task import ApiTaskGet  # noqa: E402
except ImportError:
    ApiTaskGet = Any  # type: ignore


# Update forward references
ProjectsListResponse.model_rebuild()
ProjectResponse.model_rebuild()
FileAreasListResponse.model_rebuild()
FileAreaResponse.model_rebuild()
FoldersListResponse.model_rebuild()
FolderResponse.model_rebuild()
FilesListResponse.model_rebuild()
FileResponse.model_rebuild()
VersionSetsListResponse.model_rebuild()
VersionSetResponse.model_rebuild()
UsersListResponse.model_rebuild()
UserResponse.model_rebuild()
CompaniesListResponse.model_rebuild()
CompanyResponse.model_rebuild()
InspectionPlansListResponse.model_rebuild()
TestPlansListResponse.model_rebuild()
FormsListResponse.model_rebuild()
FormResponse.model_rebuild()
TasksListResponse.model_rebuild()
TaskResponse.model_rebuild()
