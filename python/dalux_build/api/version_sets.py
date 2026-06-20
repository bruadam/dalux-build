"""Version Sets API."""
from typing import Any, Dict, Optional

from ..api_client import ApiClient


class VersionSetsApi:
    """Methods for version sets."""

    def __init__(self, api_client: ApiClient) -> None:
        self._client = api_client

    def get_version_sets(
        self, project_id: str, params: Optional[Dict[str, Any]] = None
    ) -> Any:
        """GET /2.1/projects/{projectId}/version_sets."""
        response = self._client.get(
            f"/2.1/projects/{project_id}/version_sets", params=params
        )

        if self._client.configuration.use_pydantic and isinstance(response, dict):
            try:
                from ..models import VersionSetsListResponse
                return VersionSetsListResponse(**response)
            except Exception:
                return response

        return response

    def get_version_set(self, project_id: str, version_set_id: str) -> Any:
        """GET /2.0/projects/{projectId}/version_sets/{versionSetId}."""
        response = self._client.get(
            f"/2.0/projects/{project_id}/version_sets/{version_set_id}"
        )

        if self._client.configuration.use_pydantic and isinstance(response, dict):
            try:
                from ..models import VersionSetResponse
                return VersionSetResponse(**response)
            except Exception:
                return response

        return response

    def list_file_area_version_sets(
        self,
        project_id: str,
        file_area_id: str,
        params: Optional[Dict[str, Any]] = None,
    ) -> Any:
        """GET /2.1/projects/{projectId}/file_areas/{fileAreaId}/version_sets."""
        response = self._client.get(
            f"/2.1/projects/{project_id}/file_areas/{file_area_id}/version_sets",
            params=params,
        )

        if self._client.configuration.use_pydantic and isinstance(response, dict):
            try:
                from ..models import VersionSetsListResponse
                return VersionSetsListResponse(**response)
            except Exception:
                return response

        return response

    def list_version_set_files(
        self,
        project_id: str,
        version_set_id: str,
        params: Optional[Dict[str, Any]] = None,
    ) -> Any:
        """GET /3.0/projects/{projectId}/version_sets/{versionSetId}/files."""
        response = self._client.get(
            f"/3.0/projects/{project_id}/version_sets/{version_set_id}/files",
            params=params,
        )

        if self._client.configuration.use_pydantic and isinstance(response, dict):
            try:
                from ..models import FilesListResponse
                return FilesListResponse(**response)
            except Exception:
                return response

        return response
