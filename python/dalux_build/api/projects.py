"""Projects API."""
from typing import Any, Dict, Optional

from ..api_client import ApiClient
from ..models import ProjectsListResponse, ProjectResponse
from ..response_converter import convert_to_model
from ..utils.search import find_by_field
from ..utils.validation import validate_project_id


class ProjectsApi:
    """Methods for managing projects.

    Args:
        api_client: Configured :class:`~dalux_build.api_client.ApiClient`.
    """

    def __init__(self, api_client: ApiClient) -> None:
        self._client = api_client

    def list_projects(self, params: Optional[Dict[str, Any]] = None) -> Optional[ProjectsListResponse]:
        """GET /5.1/projects — List all available projects.

        Returns:
            ProjectsListResponse with type-safe access to projects.
        """
        response = self._client.get("/5.1/projects", params=params)
        return convert_to_model(response, ProjectsListResponse)

    def get_project(self, project_id: str) -> Optional[ProjectResponse]:
        """GET /5.0/projects/{projectId} — Get a specific project.

        Args:
            project_id: The project ID.

        Returns:
            ProjectResponse containing the project data.
        """
        validate_project_id(project_id)
        response = self._client.get(f"/5.0/projects/{project_id}")
        return convert_to_model(response, ProjectResponse)

    def create_project(self, body: Dict[str, Any]) -> Optional[ProjectResponse]:
        """POST /5.0/projects — Create a new project.

        Args:
            body: Project creation payload.

        Returns:
            ProjectResponse with the created project.
        """
        response = self._client.post("/5.0/projects", json=body)
        return convert_to_model(response, ProjectResponse)

    def update_project(self, project_id: str, body: Dict[str, Any]) -> Optional[ProjectResponse]:
        """PATCH /5.0/projects/{projectId} — Update a project.

        Args:
            project_id: The project ID.
            body: Project update payload.

        Returns:
            ProjectResponse with the updated project.
        """
        response = self._client.patch(f"/5.0/projects/{project_id}", json=body)
        return convert_to_model(response, ProjectResponse)

    def list_metadata_mappings_for_projects(self) -> Any:
        """GET /1.0/projects/metadata/1.0/mappings — Metadata for POST operations."""
        return self._client.get("/1.0/projects/metadata/1.0/mappings")

    def list_metadata_values_for_projects(self, key: str) -> Any:
        """GET /1.0/projects/metadata/1.0/mappings/{key}/values."""
        return self._client.get(f"/1.0/projects/metadata/1.0/mappings/{key}/values")

    def list_project_metadata(self, project_id: str) -> Any:
        """GET /1.0/projects/{projectId}/metadata."""
        return self._client.get(f"/1.0/projects/{project_id}/metadata")

    def list_project_metadata_mappings(self, project_id: str) -> Any:
        """GET /1.0/projects/{projectId}/metadata/1.0/mappings."""
        return self._client.get(
            f"/1.0/projects/{project_id}/metadata/1.0/mappings"
        )

    def list_project_metadata_values(self, project_id: str, key: str) -> Any:
        """GET /1.0/projects/{projectId}/metadata/1.0/mappings/{key}/values."""
        return self._client.get(
            f"/1.0/projects/{project_id}/metadata/1.0/mappings/{key}/values"
        )

    def get_project_by_name(self, project_name: str) -> Optional[str]:
        """Get project ID by name.

        Args:
            project_name: Name of the project to search for.

        Returns:
            The project ID if found, None otherwise.
        """
        response = self.list_projects()
        if not response or not response.items:
            return None

        # Use generic search utility - search by the Pydantic field name "project_name"
        project = find_by_field(response.items, "project_name", project_name)
        return project.project_id if project else None
