"""Version Sets API."""
from typing import Any, Dict, Optional

from ..api_client import ApiClient
from ..models import VersionSetsListResponse, VersionSetResponse, FilesListResponse
from ..response_converter import convert_to_model


class VersionSetsApi:
    """Methods for version sets."""

    def __init__(self, api_client: ApiClient) -> None:
        self._client = api_client

    def get_version_sets(
        self, project_id: str, params: Optional[Dict[str, Any]] = None
    ) -> Optional[VersionSetsListResponse]:
        """GET /2.1/projects/{projectId}/version_sets.

        Returns:
            VersionSetsListResponse with type-safe access to version sets.
        """
        response = self._client.get(
            f"/2.1/projects/{project_id}/version_sets", params=params
        )
        return convert_to_model(response, VersionSetsListResponse)

    def get_version_set(self, project_id: str, version_set_id: str) -> Optional[VersionSetResponse]:
        """GET /2.0/projects/{projectId}/version_sets/{versionSetId}.

        Returns:
            VersionSetResponse with version set details.
        """
        response = self._client.get(
            f"/2.0/projects/{project_id}/version_sets/{version_set_id}"
        )
        return convert_to_model(response, VersionSetResponse)

    def list_file_area_version_sets(
        self,
        project_id: str,
        file_area_id: str,
        params: Optional[Dict[str, Any]] = None,
    ) -> Optional[VersionSetsListResponse]:
        """GET /2.1/projects/{projectId}/file_areas/{fileAreaId}/version_sets.

        Returns:
            VersionSetsListResponse with type-safe access to version sets.
        """
        response = self._client.get(
            f"/2.1/projects/{project_id}/file_areas/{file_area_id}/version_sets",
            params=params,
        )
        return convert_to_model(response, VersionSetsListResponse)

    def list_version_set_files(
        self,
        project_id: str,
        version_set_id: str,
        params: Optional[Dict[str, Any]] = None,
    ) -> Optional[FilesListResponse]:
        """GET /3.0/projects/{projectId}/version_sets/{versionSetId}/files.

        Returns:
            FilesListResponse with type-safe access to files.
        """
        response = self._client.get(
            f"/3.0/projects/{project_id}/version_sets/{version_set_id}/files",
            params=params,
        )
        return convert_to_model(response, FilesListResponse)
