"""File Areas API."""
from typing import Any, Dict, Optional

from ..api_client import ApiClient
from ..models import FileArea, FileAreasListResponse
from ..response_converter import convert_to_model
from ..utils.search import find_by_field
from ..utils.validation import validate_project_id


class FileAreasApi:
    """Methods for file areas on a project."""

    def __init__(self, api_client: ApiClient) -> None:
        self._client = api_client

    def get_file_areas(
        self, project_id: str, params: Optional[Dict[str, Any]] = None
    ) -> Optional[FileAreasListResponse]:
        """GET /5.1/projects/{projectId}/file_areas.

        Returns:
            FileAreasListResponse with type-safe access to file areas.
        """
        response = self._client.get(
            f"/5.1/projects/{project_id}/file_areas", params=params
        )
        return convert_to_model(response, FileAreasListResponse)

    def get_file_area(self, project_id: str, file_area_id: str) -> Optional[FileArea]:
        """GET /1.0/projects/{projectId}/file_areas/{fileAreaId}."""
        response = self._client.get(
            f"/1.0/projects/{project_id}/file_areas/{file_area_id}"
        )
        return convert_to_model(response, FileArea)

    def get_file_area_by_name(
        self, project_id: str, file_area_name: str
    ) -> Optional[str]:
        """Get file area ID by name.

        Args:
            project_id: Project ID.
            file_area_name: Name of the file area to search for.

        Returns:
            The file area if found, None otherwise.
        """
        validate_project_id(project_id)
        
        response = self.get_file_areas(project_id)
        if not response or not response.items:
            return None

        # Use generic search utility - search by the Pydantic field name "file_area_name"
        file_area = find_by_field(response.items, "file_area_name", file_area_name)
        return file_area.file_area_id if file_area else None
