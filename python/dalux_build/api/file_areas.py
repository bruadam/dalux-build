"""File Areas API."""
from typing import Any, Dict, Optional

from ..api_client import ApiClient
from ..models import FileArea


class FileAreasApi:
    """Methods for file areas on a project."""

    def __init__(self, api_client: ApiClient) -> None:
        self._client = api_client

    def get_file_areas(
        self, project_id: str, params: Optional[Dict[str, Any]] = None
    ) -> Any:
        """GET /5.1/projects/{projectId}/file_areas."""
        response = self._client.get(
            f"/5.1/projects/{project_id}/file_areas", params=params
        )

        if self._client.configuration.use_pydantic and isinstance(response, dict):
            try:
                from ..models import FileAreasListResponse
                return FileAreasListResponse(**response)
            except Exception:
                # If conversion fails, return original dict
                return response

        return response

    def get_file_area(self, project_id: str, file_area_id: str) -> Any:
        """GET /1.0/projects/{projectId}/file_areas/{fileAreaId}."""
        return self._client.get(
            f"/1.0/projects/{project_id}/file_areas/{file_area_id}"
        )

    def get_file_area_by_name(
        self, project_id: str, file_area_name: str
    ) -> Optional[str]:
        """Get file area ID by name.

        Args:
            project_id: Project ID.
            file_area_name: Name of the file area to search for.

        Returns:
            The file area ID if found, None otherwise.
        """
        response = self.get_file_areas(project_id)

        # Handle both dict and FileAreasListResponse
        if isinstance(response, dict):
            items = response.get("items", [])
        else:
            # Assume it's a FileAreasListResponse or similar
            items = getattr(response, "items", [])

        for item in items:
            # Handle both FileArea models and dicts
            if isinstance(item, FileArea):
                if item.file_area_name == file_area_name:
                    return item.file_area_id
            elif isinstance(item, dict):
                name = item.get("fileAreaName") or item.get("file_area_name")
                if name == file_area_name:
                    return item.get("fileAreaId") or item.get("file_area_id")

        return None
