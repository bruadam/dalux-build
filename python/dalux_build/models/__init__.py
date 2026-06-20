"""Pydantic models for Dalux Build API responses."""
# Base models
from .common import Link, Metadata

# Endpoint models - projects
from .projects import Project, ProjectCompany, ProjectMetadata, ProjectModule, ProjectTemplate
from .projects import ProjectResponse, ProjectsListResponse

# Endpoint models - file areas
from .file_areas import FileArea
from .file_areas import FileAreaResponse, FileAreasListResponse

# Endpoint models - folders
from .folders import Folder
from .folders import FolderResponse, FoldersListResponse

# Endpoint models - files
from .files import (
    File,
    FileDateProperty,
    FileIntegerProperty,
    FilePropertyField,
    FileReferenceProperty,
    FileTextProperty,
    Reference,
)
from .files import FileResponse, FilesListResponse

# Endpoint models - version sets
from .version_sets import VersionSet
from .version_sets import VersionSetResponse, VersionSetsListResponse

# Endpoint models - users
from .users import ProjectUser, User
from .users import UserResponse, UsersListResponse

# Endpoint models - companies
from .companies import CompaniesListResponse, CompanyResponse

# Endpoint models - company catalog
from .company_catalog import CompanyCatalogListResponse, CompanyCatalogResponse

# Endpoint models - inspection plans
from .inspection_plans import InspectionPlan
from .inspection_plans import InspectionPlansListResponse

# Endpoint models - test plans
from .test_plans import TestPlan
from .test_plans import TestPlansListResponse

# Endpoint models - forms
from .forms import Form
from .forms import FormResponse, FormsListResponse

# Endpoint models - tasks
from .tasks import ApiTaskGet
from .tasks import TaskResponse, TasksListResponse

# Endpoint models - file revisions
from .file_revisions import FileRevision

# Endpoint models - file upload
from .file_upload import FileUpload

# Endpoint models - work packages
from .work_packages import WorkPackage

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
    "FileIntegerProperty",
    "FileDateProperty",
    "FileTextProperty",
    "FileReferenceProperty",
    "FilePropertyField",
    "FilesListResponse",
    "FileResponse",
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
    "InspectionPlansListResponse",
    # Test Plans
    "TestPlan",
    "TestPlansListResponse",
    # Forms
    "Form",
    "FormsListResponse",
    "FormResponse",
    # Tasks
    "ApiTaskGet",
    "TasksListResponse",
    "TaskResponse",
    # Project Templates
    "ProjectTemplate",
    # File Revisions
    "FileRevision",
    # File Upload
    "FileUpload",
    # Work Packages
    "WorkPackage",
]
