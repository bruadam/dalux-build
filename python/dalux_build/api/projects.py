"""Projects API."""
from typing import Any, Dict, Optional

from ..api_client import ApiClient
from ..models import Project


class ProjectsApi:
    """Methods for managing projects.

    Args:
        api_client: Configured :class:`~dalux_build.api_client.ApiClient`.
    """

    def __init__(self, api_client: ApiClient) -> None:
        self._client = api_client

    def list_projects(self, params: Optional[Dict[str, Any]] = None) -> Any:
        """GET /5.1/projects — List all available projects."""
        response = self._client.get("/5.1/projects", params=params)

        if self._client.configuration.use_pydantic and isinstance(response, dict):
            try:
                from ..models import ProjectsListResponse
                return ProjectsListResponse(**response)
            except Exception:
                # If conversion fails, return original dict
                return response

        return response

    def get_project(self, project_id: str) -> Any:
        """GET /5.0/projects/{projectId} — Get a specific project."""
        return self._client.get(f"/5.0/projects/{project_id}")

    def create_project(self, body: Dict[str, Any]) -> Any:
        """POST /5.0/projects — Create a new project."""
        return self._client.post("/5.0/projects", json=body)

    def update_project(self, project_id: str, body: Dict[str, Any]) -> Any:
        """PATCH /5.0/projects/{projectId} — Update a project."""
        return self._client.patch(f"/5.0/projects/{project_id}", json=body)

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

        # Handle both dict and ProjectsListResponse
        if isinstance(response, dict):
            items = response.get("items", [])
        else:
            # Assume it's a ProjectsListResponse or similar
            items = getattr(response, "items", [])

        for item in items:
            # Handle both Project models and dicts
            if isinstance(item, Project):
                if item.project_name == project_name:
                    return item.project_id
            elif isinstance(item, dict):
                name = item.get("projectName") or item.get("project_name")
                if name == project_name:
                    return item.get("projectId") or item.get("project_id")

        return None
