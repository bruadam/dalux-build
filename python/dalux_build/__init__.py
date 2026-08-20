"""Dalux Build API – Python client.

Quickstart::

    from dalux_build import create_client

    dalux = create_client()

    projects = dalux.projects.list_projects()

    # AI Analysis (requires: pip install dalux-build[ai])
    dalux.ai.files.health()
    dalux.ai.tasks.ask("What tasks are overdue?")
"""

from dataclasses import dataclass
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from .ai.namespace import AINamespace

from .ai import (
    AiAnalysisResult,
    AiMixin,
    AIProviderManager,
    HealthReport,
    ProviderConfig,
    ProviderType,
)
from .api import (
    CompaniesApi,
    CompanyCatalogApi,
    FileAreasApi,
    FileRevisionsApi,
    FilesApi,
    FileUploadApi,
    FoldersApi,
    FormsApi,
    InspectionPlansApi,
    ProjectsApi,
    ProjectTemplatesApi,
    TasksApi,
    TestPlansApi,
    UsersApi,
    VersionSetsApi,
    WorkPackagesApi,
)
from .api_client import ApiClient
from .configuration import Configuration
from .dashboards import (
    DashboardError,
    DashboardHandle,
    DashboardStartupError,
    DashboardTemplateNotFoundError,
    MissingDashboardDependencies,
)
from .utils import (
    ApiError,
    DaluxError,
    NotFoundError,
    ValidationError,
    find_all_by_field,
    find_by_field,
    paginate,
)
from .webhook_server import WebhookServerApi


@dataclass
class DaluxClient:
    """Container for all Dalux Build API namespaces."""

    configuration: Configuration
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
    webhook_server: WebhookServerApi
    _ai: "AINamespace | None" = None

    def set_default_project(self, project_id: str) -> None:
        """Set the default ``project_id`` used by API methods that accept one optionally."""
        self.configuration.project_id = project_id

    def set_default_file_area(self, file_area_id: str) -> None:
        """Set the default ``file_area_id`` used by API methods that accept one optionally."""
        self.configuration.file_area_id = file_area_id

    @property
    def ai(self) -> "AINamespace":
        """Access AI analysis methods through this namespace.

        Requires: pip install dalux-build[ai]

        Usage:
            dalux.ai.files.health()
            dalux.ai.tasks.ask("What tasks are overdue?")
        """
        if self._ai is None:
            try:
                from .ai.namespace import AINamespace
            except ImportError as e:
                raise ImportError(
                    "AI functionality requires additional dependencies. "
                    "Please run: uv sync --extra ai"
                ) from e
            self._ai = AINamespace(self)
        return self._ai


def create_client(
    base_url: str | None = None,
    api_key: str | None = None,
    project_id: str | None = None,
    file_area_id: str | None = None,
) -> DaluxClient:
    """Create a fully configured Dalux Build API client.

    Args:
        base_url: The API base URL. If not provided, loads from DALUX_BASE_URL env var.
        api_key: Your ``X-API-KEY``. If not provided, loads from DALUX_API_KEY env var.
        project_id: Default project ID. When set, API methods that accept an
            optional ``project_id`` keyword argument fall back to this value.
            If not provided, loads from the DALUX_PROJECT_ID env var.
        file_area_id: Default file area ID. When set, API methods that accept
            an optional ``file_area_id`` keyword argument fall back to this
            value. If not provided, loads from the DALUX_FILE_AREA_ID env var.

    Returns:
        A :class:`DaluxClient` with one attribute per API resource group.

    Example::

        # Using environment variables
        dalux = create_client()

        # Or with explicit parameters
        dalux = create_client(
            base_url="https://<company>.dalux.com/api",
            api_key="YOUR_API_KEY",
            project_id="S123",
        )
        # project_id is now optional on every endpoint that accepts it
        projects = dalux.projects.list_projects()
        file_areas = dalux.file_areas.get_file_areas()
    """
    configuration = Configuration(
        base_url=base_url, api_key=api_key, project_id=project_id, file_area_id=file_area_id
    )
    api_client = ApiClient(configuration)

    return DaluxClient(
        configuration=configuration,
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
        webhook_server=WebhookServerApi(api_client),
    )


# Version information
__version__ = "2.1.4"

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
    "WebhookServerApi",
    "DashboardError",
    "DashboardHandle",
    "DashboardStartupError",
    "DashboardTemplateNotFoundError",
    "MissingDashboardDependencies",
    # AI Analysis
    "AiMixin",
    "HealthReport",
    "AiAnalysisResult",
    "AIProviderManager",
    "ProviderType",
    "ProviderConfig",
    # Utilities
    "DaluxError",
    "NotFoundError",
    "ApiError",
    "ValidationError",
    "paginate",
    "find_by_field",
    "find_all_by_field",
]
