"""Dalux Build API – Python client.

Quickstart::

    from dalux_build import create_client

    dalux = create_client()

    projects = dalux.projects.list_projects()
"""

from dataclasses import dataclass
from typing import Any

from .api_client import ApiClient
from .configuration import Configuration

from .api import (
    CompaniesApi,
    CompanyCatalogApi,
    FileAreasApi,
    FileRevisionsApi,
    FileUploadApi,
    FilesApi,
    FoldersApi,
    FormsApi,
    InspectionPlansApi,
    ProjectTemplatesApi,
    ProjectsApi,
    TasksApi,
    TestPlansApi,
    UsersApi,
    VersionSetsApi,
    WorkPackagesApi,
)


@dataclass
class DaluxClient:
    """Container for all Dalux Build API namespaces."""

    projects: ProjectsApi
    companies: CompaniesApi
    company_catalog: CompanyCatalogApi
    file_areas: FileAreasApi
    file_revisions: FileRevisionsApi
    file_upload: FileUploadApi
    files: FilesApi
    folders: FoldersApi
    forms: FormsApi
    inspection_plans: InspectionPlansApi
    project_templates: ProjectTemplatesApi
    tasks: TasksApi
    test_plans: TestPlansApi
    users: UsersApi
    version_sets: VersionSetsApi
    work_packages: WorkPackagesApi


def create_client(base_url: str = None, api_key: str = None) -> DaluxClient:
    """Create a fully configured Dalux Build API client.

    Args:
        base_url: The API base URL. If not provided, loads from DALUX_API_BASE_URL env var.
        api_key: Your ``X-API-KEY``. If not provided, loads from DALUX_API_KEY env var.

    Returns:
        A :class:`DaluxClient` with one attribute per API resource group.

    Example::

        # Using environment variables
        dalux = create_client()

        # Or with explicit parameters
        dalux = create_client(
            base_url="https://<company>.dalux.com/api",
            api_key="YOUR_API_KEY",
        )
        projects = dalux.projects.list_projects()
    """
    configuration = Configuration(base_url=base_url, api_key=api_key)
    api_client = ApiClient(configuration)

    return DaluxClient(
        projects=ProjectsApi(api_client),
        companies=CompaniesApi(api_client),
        company_catalog=CompanyCatalogApi(api_client),
        file_areas=FileAreasApi(api_client),
        file_revisions=FileRevisionsApi(api_client),
        file_upload=FileUploadApi(api_client),
        files=FilesApi(api_client),
        folders=FoldersApi(api_client),
        forms=FormsApi(api_client),
        inspection_plans=InspectionPlansApi(api_client),
        project_templates=ProjectTemplatesApi(api_client),
        tasks=TasksApi(api_client),
        test_plans=TestPlansApi(api_client),
        users=UsersApi(api_client),
        version_sets=VersionSetsApi(api_client),
        work_packages=WorkPackagesApi(api_client),
    )


__all__ = [
    "create_client",
    "DaluxClient",
    "Configuration",
    "ApiClient",
    "CompaniesApi",
    "CompanyCatalogApi",
    "FileAreasApi",
    "FileRevisionsApi",
    "FileUploadApi",
    "FilesApi",
    "FoldersApi",
    "FormsApi",
    "InspectionPlansApi",
    "ProjectTemplatesApi",
    "ProjectsApi",
    "TasksApi",
    "TestPlansApi",
    "UsersApi",
    "VersionSetsApi",
    "WorkPackagesApi",
]
