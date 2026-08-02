"""Pydantic models for Dalux Build API responses."""

# Base models
from .common import Link, Metadata

# Endpoint models - companies
from .companies import CompaniesListResponse, CompanyResponse

# Endpoint models - company catalog
from .company_catalog import CompanyCatalogListResponse, CompanyCatalogResponse

# Endpoint models - file areas
from .file_areas import FileArea, FileAreaResponse, FileAreasListResponse

# Endpoint models - file revisions
from .file_revisions import FileRevision

# Endpoint models - file upload
from .file_upload import FileUpload

# Endpoint models - files
from .files import (
    DownloadResult,
    File,
    FileDateProperty,
    FileIntegerProperty,
    FileNameFilter,
    FilePropertyField,
    FileReferenceProperty,
    FileResponse,
    FilesListResponse,
    FileTextProperty,
    MissingFileReport,
    Reference,
)

# Endpoint models - folders
from .folders import Folder, FolderResponse, FoldersListResponse

# Endpoint models - forms
from .forms import Form, FormResponse, FormsListResponse

# Endpoint models - inspection plans
from .inspection_plans import (
    InspectionPlan,
    InspectionPlanItem,
    InspectionPlanItemsListResponse,
    InspectionPlanItemZone,
    InspectionPlanItemZonesListResponse,
    InspectionPlanRegistration,
    InspectionPlanRegistrationsListResponse,
    InspectionPlansListResponse,
)

# Endpoint models - projects
from .projects import (
    Project,
    ProjectCompany,
    ProjectMetadata,
    ProjectModule,
    ProjectResponse,
    ProjectsListResponse,
    ProjectTemplate,
)

# Endpoint models - tasks
from .tasks import (
    Task,
    TaskAttachment,
    TaskAttachmentsListResponse,
    TaskChange,
    TaskChangeActor,
    TaskChangeFields,
    TaskChangeLocation,
    TaskChangeResponse,
    TaskChanges,
    TaskListParams,
    TaskResponse,
    TasksListResponse,
)

# Endpoint models - test plans
from .test_plans import (
    TestPlan,
    TestPlanItem,
    TestPlanItemsListResponse,
    TestPlanItemZone,
    TestPlanItemZonesListResponse,
    TestPlanRegistration,
    TestPlanRegistrationsListResponse,
    TestPlansListResponse,
)

# Endpoint models - users
from .users import ProjectUser, User, UserResponse, UsersListResponse

# Endpoint models - version sets
from .version_sets import VersionSet, VersionSetResponse, VersionSetsListResponse

# Endpoint models - work packages
from .work_packages import WorkPackage, WorkPackagesListResponse

__all__ = [
    # Base models
    "Link",
    "Metadata",
    # Projects
    "Project",
    "ProjectModule",
    "ProjectMetadata",
    "ProjectTemplate",
    "ProjectCompany",
    "ProjectsListResponse",
    "ProjectResponse",
    # File Areas
    "FileArea",
    "FileAreasListResponse",
    "FileAreaResponse",
    # Folders
    "Folder",
    "FoldersListResponse",
    "FolderResponse",
    # Files
    "File",
    "Reference",
    "FileNameFilter",
    "FileIntegerProperty",
    "FileDateProperty",
    "FileTextProperty",
    "FileReferenceProperty",
    "FilePropertyField",
    "FilesListResponse",
    "FileResponse",
    "DownloadResult",
    "MissingFileReport",
    # Version Sets
    "VersionSet",
    "VersionSetsListResponse",
    "VersionSetResponse",
    # Users
    "User",
    "ProjectUser",
    "UsersListResponse",
    "UserResponse",
    # Companies
    "CompaniesListResponse",
    "CompanyResponse",
    # Company Catalog
    "CompanyCatalogListResponse",
    "CompanyCatalogResponse",
    # Inspection Plans
    "InspectionPlan",
    "InspectionPlanItem",
    "InspectionPlanItemZone",
    "InspectionPlanRegistration",
    "InspectionPlansListResponse",
    "InspectionPlanItemsListResponse",
    "InspectionPlanItemZonesListResponse",
    "InspectionPlanRegistrationsListResponse",
    # Test Plans
    "TestPlan",
    "TestPlanItem",
    "TestPlanItemZone",
    "TestPlanRegistration",
    "TestPlansListResponse",
    "TestPlanItemsListResponse",
    "TestPlanItemZonesListResponse",
    "TestPlanRegistrationsListResponse",
    # Forms
    "Form",
    "FormsListResponse",
    "FormResponse",
    # Tasks
    "Task",
    "TaskAttachment",
    "TaskChange",
    "TaskChangeActor",
    "TaskChangeFields",
    "TaskChangeLocation",
    "TaskListParams",
    "TasksListResponse",
    "TaskResponse",
    "TaskChangeResponse",
    "TaskChanges",
    "TaskAttachmentsListResponse",
    # Project Templates
    "ProjectTemplate",
    # File Revisions
    "FileRevision",
    # File Upload
    "FileUpload",
    # Work Packages
    "WorkPackage",
    "WorkPackagesListResponse",
]
