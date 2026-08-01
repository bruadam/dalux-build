"""Version Sets API."""

from typing import TYPE_CHECKING, Literal, overload

from ..api_client import ApiClient
from ..json_types import QueryParams
from ..models import (
    File,
    FilesListResponse,
    VersionSet,
    VersionSetResponse,
    VersionSetsListResponse,
)
from ..response_converter import convert_to_list_response, convert_to_model, to_dataframe_or_empty
from ..utils.validation import resolve_file_area_id, resolve_project_id

if TYPE_CHECKING:
    import pandas as pd


class VersionSetsApi:
    """Methods for version sets."""

    def __init__(self, api_client: ApiClient) -> None:
        self._client = api_client

    @overload
    def get_version_sets(
        self,
        params: QueryParams | None = None,
        full_response: Literal[False] = False,
        to_dataframe: Literal[False] = False,
        *,
        project_id: str | None = None,
    ) -> list[VersionSet]: ...
    @overload
    def get_version_sets(
        self,
        params: QueryParams | None = None,
        *,
        full_response: Literal[True],
        to_dataframe: Literal[False] = False,
        project_id: str | None = None,
    ) -> VersionSetsListResponse | None: ...
    @overload
    def get_version_sets(
        self,
        params: QueryParams | None = None,
        full_response: bool = ...,
        *,
        to_dataframe: Literal[True],
        project_id: str | None = None,
    ) -> "pd.DataFrame": ...
    def get_version_sets(
        self,
        params: QueryParams | None = None,
        full_response: bool = False,
        to_dataframe: bool = False,
        *,
        project_id: str | None = None,
    ) -> "VersionSetsListResponse | list[VersionSet] | pd.DataFrame | None":
        """GET /2.1/projects/{projectId}/version_sets.

        Args:
            params: Optional query parameters.
            full_response: If True, return the full VersionSetsListResponse
                (including metadata and links). If False (default), return
                just the list of VersionSet items.
            to_dataframe: If True, return the items flattened into a pandas
                DataFrame (requires pandas). Takes precedence over full_response.
            project_id: Project ID. Falls back to the client's configured default.

        Returns:
            List of VersionSet items, the full VersionSetsListResponse
            when full_response=True, or a DataFrame when to_dataframe=True.
        """
        project_id = resolve_project_id(project_id, self._client.configuration.project_id)
        response = self._client.get(f"/2.1/projects/{project_id}/version_sets", params=params)
        result = convert_to_list_response(response, VersionSetsListResponse)
        if to_dataframe:
            return to_dataframe_or_empty(result)
        if full_response:
            return result
        return result.items if result is not None else []

    def get_version_set(
        self, version_set_id: str, *, project_id: str | None = None
    ) -> VersionSetResponse | None:
        """GET /2.0/projects/{projectId}/version_sets/{versionSetId}.

        Returns:
            VersionSetResponse with version set details.
        """
        project_id = resolve_project_id(project_id, self._client.configuration.project_id)
        response = self._client.get(f"/2.0/projects/{project_id}/version_sets/{version_set_id}")
        return convert_to_model(response, VersionSetResponse)

    @overload
    def list_file_area_version_sets(
        self,
        params: QueryParams | None = None,
        full_response: Literal[False] = False,
        to_dataframe: Literal[False] = False,
        *,
        project_id: str | None = None,
        file_area_id: str | None = None,
    ) -> list[VersionSet]: ...
    @overload
    def list_file_area_version_sets(
        self,
        params: QueryParams | None = None,
        *,
        full_response: Literal[True],
        to_dataframe: Literal[False] = False,
        project_id: str | None = None,
        file_area_id: str | None = None,
    ) -> VersionSetsListResponse | None: ...
    @overload
    def list_file_area_version_sets(
        self,
        params: QueryParams | None = None,
        full_response: bool = ...,
        *,
        to_dataframe: Literal[True],
        project_id: str | None = None,
        file_area_id: str | None = None,
    ) -> "pd.DataFrame": ...
    def list_file_area_version_sets(
        self,
        params: QueryParams | None = None,
        full_response: bool = False,
        to_dataframe: bool = False,
        *,
        project_id: str | None = None,
        file_area_id: str | None = None,
    ) -> "VersionSetsListResponse | list[VersionSet] | pd.DataFrame | None":
        """GET /2.1/projects/{projectId}/file_areas/{fileAreaId}/version_sets.

        Args:
            params: Optional query parameters.
            full_response: If True, return the full VersionSetsListResponse
                (including metadata and links). If False (default), return
                just the list of VersionSet items.
            to_dataframe: If True, return the items flattened into a pandas
                DataFrame (requires pandas). Takes precedence over full_response.
            project_id: Project ID. Falls back to the client's configured default.
            file_area_id: File area ID. Falls back to the client's configured default.

        Returns:
            List of VersionSet items, the full VersionSetsListResponse
            when full_response=True, or a DataFrame when to_dataframe=True.
        """
        project_id = resolve_project_id(project_id, self._client.configuration.project_id)
        file_area_id = resolve_file_area_id(file_area_id, self._client.configuration.file_area_id)
        response = self._client.get(
            f"/2.1/projects/{project_id}/file_areas/{file_area_id}/version_sets",
            params=params,
        )
        result = convert_to_list_response(response, VersionSetsListResponse)
        if to_dataframe:
            return to_dataframe_or_empty(result)
        if full_response:
            return result
        return result.items if result is not None else []

    @overload
    def list_version_set_files(
        self,
        version_set_id: str,
        params: QueryParams | None = None,
        full_response: Literal[False] = False,
        to_dataframe: Literal[False] = False,
        *,
        project_id: str | None = None,
    ) -> list[File]: ...
    @overload
    def list_version_set_files(
        self,
        version_set_id: str,
        params: QueryParams | None = None,
        *,
        full_response: Literal[True],
        to_dataframe: Literal[False] = False,
        project_id: str | None = None,
    ) -> FilesListResponse | None: ...
    @overload
    def list_version_set_files(
        self,
        version_set_id: str,
        params: QueryParams | None = None,
        full_response: bool = ...,
        *,
        to_dataframe: Literal[True],
        project_id: str | None = None,
    ) -> "pd.DataFrame": ...
    def list_version_set_files(
        self,
        version_set_id: str,
        params: QueryParams | None = None,
        full_response: bool = False,
        to_dataframe: bool = False,
        *,
        project_id: str | None = None,
    ) -> "FilesListResponse | list[File] | pd.DataFrame | None":
        """GET /3.0/projects/{projectId}/version_sets/{versionSetId}/files.

        Args:
            version_set_id: Version set ID.
            params: Optional query parameters.
            full_response: If True, return the full FilesListResponse
                (including metadata and links). If False (default), return
                just the list of File items.
            to_dataframe: If True, return the items flattened into a pandas
                DataFrame (requires pandas). Takes precedence over full_response.
            project_id: Project ID. Falls back to the client's configured default.

        Returns:
            List of File items, the full FilesListResponse when
            full_response=True, or a DataFrame when to_dataframe=True.
        """
        project_id = resolve_project_id(project_id, self._client.configuration.project_id)
        response = self._client.get(
            f"/3.0/projects/{project_id}/version_sets/{version_set_id}/files",
            params=params,
        )
        result = convert_to_list_response(response, FilesListResponse)
        if to_dataframe:
            return to_dataframe_or_empty(result)
        if full_response:
            return result
        return result.items if result is not None else []
