"""Projects API."""

from typing import TYPE_CHECKING, Literal, overload

from ..api_client import ApiClient
from ..json_types import JSONDict, JSONValue, QueryParams
from ..models import Project, ProjectResponse, ProjectsListResponse
from ..response_converter import convert_to_list_response, convert_to_model, to_dataframe_or_empty
from ..utils.search import find_by_field
from ..utils.validation import resolve_project_id

if TYPE_CHECKING:
    import pandas as pd


class ProjectsApi:
    """Methods for managing projects.

    Args:
        api_client: Configured :class:`~dalux_build.api_client.ApiClient`.
    """

    def __init__(self, api_client: ApiClient) -> None:
        self._client = api_client

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

    def list_project_metadata_mappings(
        self, *, project_id: str | None = None
    ) -> JSONValue | None:
        """GET /1.0/projects/{projectId}/metadata/1.0/mappings."""
        project_id = resolve_project_id(project_id, self._client.configuration.project_id)
        return self._client.get(f"/1.0/projects/{project_id}/metadata/1.0/mappings")

    def list_project_metadata_values(
        self, key: str, *, project_id: str | None = None
    ) -> JSONValue | None:
        """GET /1.0/projects/{projectId}/metadata/1.0/mappings/{key}/values."""
        project_id = resolve_project_id(project_id, self._client.configuration.project_id)
        return self._client.get(f"/1.0/projects/{project_id}/metadata/1.0/mappings/{key}/values")

    def get_project_by_name(self, project_name: str) -> str | None:
        """Get project ID by name.

        Args:
            project_name: Name of the project to search for.

        Returns:
            The project ID if found, None otherwise.
        """
        items = self.list_projects()
        if not items:
            return None

        # Use generic search utility - search by the Pydantic field name "project_name"
        project = find_by_field(items, "project_name", project_name)
        return project.project_id if project else None
