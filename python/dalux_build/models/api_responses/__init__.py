"""API response models - organized by endpoint for better maintainability."""
from .common import Link, Metadata
from .companies import CompaniesListResponse, CompanyResponse
from .file_areas import FileAreaResponse, FileAreasListResponse
from .files import FileResponse, FilesListResponse
from .folders import FolderResponse, FoldersListResponse
from .forms import FormResponse, FormsListResponse
from .inspection_plans import InspectionPlansListResponse
from .projects import ProjectResponse, ProjectsListResponse
from .tasks import TaskResponse, TasksListResponse
from .test_plans import TestPlansListResponse
from .users import UserResponse, UsersListResponse
from .version_sets import VersionSetResponse, VersionSetsListResponse

__all__ = [
    # Common
    "Link",
    "Metadata",
    # Projects
    "ProjectsListResponse",
    "ProjectResponse",
    # File Areas
    "FileAreasListResponse",
    "FileAreaResponse",
    # Folders
    "FoldersListResponse",
    "FolderResponse",
    # Files
    "FilesListResponse",
    "FileResponse",
    # Version Sets
    "VersionSetsListResponse",
    "VersionSetResponse",
    # Users
    "UsersListResponse",
    "UserResponse",
    # Companies
    "CompaniesListResponse",
    "CompanyResponse",
    # Inspection Plans
    "InspectionPlansListResponse",
    # Test Plans
    "TestPlansListResponse",
    # Forms
    "FormsListResponse",
    "FormResponse",
    # Tasks
    "TasksListResponse",
    "TaskResponse",
]
