"""File Areas API."""

from typing import TYPE_CHECKING, Literal, overload

from ..api_client import ApiClient
from ..json_types import QueryParams
from ..models import FileArea, FileAreasListResponse
from ..response_converter import convert_to_list_response, convert_to_model, to_dataframe_or_empty
from ..utils.search import find_by_field
from ..utils.validation import resolve_file_area_id, resolve_project_id

if TYPE_CHECKING:
    import pandas as pd


class FileAreasApi:
    """Methods for file areas on a project."""

    def __init__(self, api_client: ApiClient) -> None:
        self._client = api_client

    @overload
    def get_file_areas(
        self,
        params: QueryParams | None = None,
        full_response: Literal[False] = False,
        to_dataframe: Literal[False] = False,
        *,
        project_id: str | None = None,
    ) -> list[FileArea]: ...
    @overload
    def get_file_areas(
        self,
        params: QueryParams | None = None,
        *,
        full_response: Literal[True],
        to_dataframe: Literal[False] = False,
        project_id: str | None = None,
    ) -> FileAreasListResponse | None: ...
    @overload
    def get_file_areas(
        self,
        params: QueryParams | None = None,
        full_response: bool = ...,
        *,
        to_dataframe: Literal[True],
        project_id: str | None = None,
    ) -> "pd.DataFrame": ...
    def get_file_areas(
        self,
        params: QueryParams | None = None,
        full_response: bool = False,
        to_dataframe: bool = False,
        *,
        project_id: str | None = None,
    ) -> "FileAreasListResponse | list[FileArea] | pd.DataFrame | None":
        """GET /5.1/projects/{projectId}/file_areas.

        Args:
            params: Optional query parameters.
            full_response: If True, return the full FileAreasListResponse
                (including metadata and links). If False (default), return
                just the list of FileArea items.
            to_dataframe: If True, return the items flattened into a pandas
                DataFrame (requires pandas). Takes precedence over full_response.
            project_id: Project ID. Falls back to the client's configured
                default project ID (``Configuration.project_id`` /
                ``DALUX_PROJECT_ID``) when omitted.

        Returns:
            List of FileArea items, the full FileAreasListResponse when
            full_response=True, or a DataFrame when to_dataframe=True.
        """
        project_id = resolve_project_id(project_id, self._client.configuration.project_id)
        response = self._client.get(f"/5.1/projects/{project_id}/file_areas", params=params)
        result = convert_to_list_response(response, FileAreasListResponse)
        if to_dataframe:
            return to_dataframe_or_empty(result)
        if full_response:
            return result
        return result.items if result is not None else []

    def get_file_area(
        self, *, project_id: str | None = None, file_area_id: str | None = None
    ) -> FileArea | None:
        """GET /1.0/projects/{projectId}/file_areas/{fileAreaId}.

        Args:
            project_id: Project ID. Falls back to the client's configured default.
            file_area_id: File area ID. Falls back to the client's configured default.
        """
        project_id = resolve_project_id(project_id, self._client.configuration.project_id)
        file_area_id = resolve_file_area_id(file_area_id, self._client.configuration.file_area_id)
        response = self._client.get(f"/1.0/projects/{project_id}/file_areas/{file_area_id}")
        return convert_to_model(response, FileArea)

    def get_file_area_by_name(
        self, file_area_name: str, *, project_id: str | None = None
    ) -> str | None:
        """Get file area ID by name.

        Args:
            file_area_name: Name of the file area to search for.
            project_id: Project ID. Falls back to the client's configured default.

        Returns:
            The file area if found, None otherwise.
        """
        project_id = resolve_project_id(project_id, self._client.configuration.project_id)

        items = self.get_file_areas(project_id=project_id)
        if not items:
            return None

        # Use generic search utility - search by the Pydantic field name "file_area_name"
        file_area = find_by_field(items, "file_area_name", file_area_name)
        return file_area.file_area_id if file_area else None
