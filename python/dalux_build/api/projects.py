"""Projects API."""

import warnings
from typing import TYPE_CHECKING, Any, Literal, overload

from ..ai import AiMixin
from ..api_client import ApiClient
from ..dashboards.api import DashboardApiMixin
from ..json_types import JSONDict, JSONValue, QueryParams
from ..models import Project, ProjectResponse, ProjectsListResponse
from ..response_converter import convert_to_list_response, convert_to_model, to_dataframe_or_empty
from ..utils.pagination import paginate
from ..utils.search import find_by_field
from ..utils.validation import resolve_project_id

if TYPE_CHECKING:
    import pandas as pd


class ProjectsApi(AiMixin, DashboardApiMixin):
    """Methods for managing projects.

    Args:
        api_client: Configured :class:`~dalux_build.api_client.ApiClient`.
    """

    dashboard_resource = "projects"
    _resource_name = "project"
    __all__ = [
        "get_projects",
        "get_project",
        "create_project",
        "update_project",
        "health",
        "ask",
    ]

    def __init__(self, api_client: ApiClient) -> None:
        self._client = api_client

    @overload
    def get_projects(
        self,
        params: QueryParams | None = None,
        verbose: bool = False,
        to_dataframe: Literal[False] = False,
    ) -> list[Project]: ...

    @overload
    def get_projects(
        self,
        params: QueryParams | None = None,
        verbose: bool = False,
        *,
        to_dataframe: Literal[True],
    ) -> "pd.DataFrame": ...

    def get_projects(
        self,
        params: QueryParams | None = None,
        verbose: bool = False,
        to_dataframe: bool = False,
    ) -> "list[Project] | pd.DataFrame":
        """Retrieve all projects by following pagination automatically.

        Args:
            params: Optional query parameters.
            verbose: If True, show progress with tqdm.
            to_dataframe: If True, return items flattened into a pandas
                DataFrame (requires pandas) instead of a list.

        Returns:
            List of all Project items, or a DataFrame when to_dataframe=True.
        """
        from ..response_converter import flatten_items_to_dataframe

        raw_items = paginate(
            endpoint="/5.1/projects",
            client=self._client,
            params=params,
            verbose=verbose,
            item_accessor="items",
        )
        typed_items: list[Project] = []
        for item in raw_items:
            if isinstance(item, dict):
                project_data = item.get("data", item)
                if isinstance(project_data, dict):
                    typed_items.append(Project.model_validate(project_data))
        if to_dataframe:
            return flatten_items_to_dataframe(list(typed_items))
        return typed_items

    def get_all_projects(
        self,
        params: QueryParams | None = None,
        verbose: bool = False,
        to_dataframe: bool = False,
    ) -> "list[Project] | pd.DataFrame":
        """Retrieve all projects by following pagination automatically.

        .. deprecated::
            Use :meth:`get_projects` instead.

        Args:
            params: Optional query parameters.
            verbose: If True, show progress.
            to_dataframe: If True, return as DataFrame.
        """
        warnings.warn(
            "get_all_projects() is deprecated. Use get_projects() instead.",
            DeprecationWarning,
            stacklevel=2,
        )
        return self.get_projects(params=params, verbose=verbose, to_dataframe=to_dataframe)  # type: ignore[call-overload]

    @overload
    def list_projects(
        self,
        params: QueryParams | None = None,
        full_response: Literal[False] = False,
        to_dataframe: Literal[False] = False,
    ) -> list[Project]: ...
    @overload
    def list_projects(
        self,
        params: QueryParams | None = None,
        *,
        full_response: Literal[True],
        to_dataframe: Literal[False] = False,
    ) -> ProjectsListResponse | None: ...
    @overload
    def list_projects(
        self,
        params: QueryParams | None = None,
        full_response: bool = ...,
        *,
        to_dataframe: Literal[True],
    ) -> "pd.DataFrame": ...
    def list_projects(
        self,
        params: QueryParams | None = None,
        full_response: bool = False,
        to_dataframe: bool = False,
    ) -> "ProjectsListResponse | list[Project] | pd.DataFrame | None":
        """GET /5.1/projects — List all available projects.

        .. deprecated::
            Use :meth:`get_projects` instead. This method only fetches
            the first page of results.

        Args:
            params: Optional query parameters.
            full_response: If True, return the full ProjectsListResponse
                (including metadata and links). If False (default), return
                just the list of Project items.
            to_dataframe: If True, return the items flattened into a pandas
                DataFrame (requires pandas). Takes precedence over full_response.

        Returns:
            List of Project items, the full ProjectsListResponse when
            full_response=True, or a DataFrame when to_dataframe=True.
        """
        warnings.warn(
            "list_projects() is deprecated and only returns the first page of results. "
            "Use get_projects() instead to fetch all projects with pagination.",
            DeprecationWarning,
            stacklevel=2,
        )
        response = self._client.get("/5.1/projects", params=params)
        result = convert_to_list_response(response, ProjectsListResponse)
        if to_dataframe:
            return to_dataframe_or_empty(result)
        if full_response:
            return result
        return result.items if result is not None else []

    def get_project(self, *, project_id: str | None = None) -> ProjectResponse | None:
        """GET /5.0/projects/{projectId} — Get a specific project.

        Args:
            project_id: The project ID. Falls back to the client's configured default.

        Returns:
            ProjectResponse containing the project data.
        """
        project_id = resolve_project_id(project_id, self._client.configuration.project_id)
        response = self._client.get(f"/5.0/projects/{project_id}")
        return convert_to_model(response, ProjectResponse)

    def create_project(self, body: JSONDict) -> ProjectResponse | None:
        """POST /5.0/projects — Create a new project.

        Args:
            body: Project creation payload.

        Returns:
            ProjectResponse with the created project.
        """
        response = self._client.post("/5.0/projects", json=body)
        return convert_to_model(response, ProjectResponse)

    def update_project(
        self, body: JSONDict, *, project_id: str | None = None
    ) -> ProjectResponse | None:
        """PATCH /5.0/projects/{projectId} — Update a project.

        Args:
            body: Project update payload.
            project_id: The project ID. Falls back to the client's configured default.

        Returns:
            ProjectResponse with the updated project.
        """
        project_id = resolve_project_id(project_id, self._client.configuration.project_id)
        response = self._client.patch(f"/5.0/projects/{project_id}", json=body)
        return convert_to_model(response, ProjectResponse)

    def list_metadata_mappings_for_projects(self) -> JSONValue | None:
        """GET /1.0/projects/metadata/1.0/mappings — Metadata for POST operations."""
        return self._client.get("/1.0/projects/metadata/1.0/mappings")

    def list_metadata_values_for_projects(self, key: str) -> JSONValue | None:
        """GET /1.0/projects/metadata/1.0/mappings/{key}/values."""
        return self._client.get(f"/1.0/projects/metadata/1.0/mappings/{key}/values")

    def list_project_metadata(self, *, project_id: str | None = None) -> JSONValue | None:
        """GET /1.0/projects/{projectId}/metadata."""
        project_id = resolve_project_id(project_id, self._client.configuration.project_id)
        return self._client.get(f"/1.0/projects/{project_id}/metadata")

    def list_project_metadata_mappings(self, *, project_id: str | None = None) -> JSONValue | None:
        """GET /1.0/projects/{projectId}/metadata/1.0/mappings."""
        project_id = resolve_project_id(project_id, self._client.configuration.project_id)
        return self._client.get(f"/1.0/projects/{project_id}/metadata/1.0/mappings")

    def list_project_metadata_values(
        self, key: str, *, project_id: str | None = None
    ) -> JSONValue | None:
        """GET /1.0/projects/{projectId}/metadata/1.0/mappings/{key}/values."""
        project_id = resolve_project_id(project_id, self._client.configuration.project_id)
        return self._client.get(f"/1.0/projects/{project_id}/metadata/1.0/mappings/{key}/values")

    def get_project_by_name(self, project_name: str) -> Project | None:
        """Get a project by name.

        Args:
            project_name: Name of the project to search for.

        Returns:
            The matching Project if found, None otherwise.
        """
        items = self.list_projects()
        if not items:
            return None

        # Use generic search utility - search by the Pydantic field name "project_name"
        return find_by_field(items, "project_name", project_name)

    def _fetch_all_data(self, **kwargs: Any) -> list[Project]:  # noqa: ANN401
        """Fetch all projects using get_projects."""
        return self.get_projects(verbose=False)

    def _format_data_for_analysis(self, data: list[Any]) -> str:
        """Format projects for Claude analysis."""
        import pprint

        formatted_projects = []
        for p in data[:100]:
            if isinstance(p, Project):
                formatted_projects.append(
                    {
                        "id": p.project_id,
                        "name": p.project_name,
                    }
                )
            elif isinstance(p, dict):
                project_data = p.get("data", p)
                formatted_projects.append(
                    {
                        "id": project_data.get("projectId", project_data.get("id")),
                        "name": project_data.get("projectName"),
                        "status": project_data.get("status"),
                    }
                )

        return pprint.pformat(formatted_projects)[:8000]
