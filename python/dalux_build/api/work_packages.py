"""Work Packages API."""

from typing import TYPE_CHECKING, Literal, overload

from ..api_client import ApiClient
from ..json_types import QueryParams
from ..models import WorkPackage, WorkPackagesListResponse
from ..response_converter import convert_to_list_response, to_dataframe_or_empty
from ..utils.validation import resolve_project_id

if TYPE_CHECKING:
    import pandas as pd


class WorkPackagesApi:
    """Methods for work packages on a project."""

    def __init__(self, api_client: ApiClient) -> None:
        self._client = api_client

    @overload
    def list_work_packages(
        self,
        params: QueryParams | None = None,
        full_response: Literal[False] = False,
        to_dataframe: Literal[False] = False,
        *,
        project_id: str | None = None,
    ) -> list[WorkPackage]: ...
    @overload
    def list_work_packages(
        self,
        params: QueryParams | None = None,
        *,
        full_response: Literal[True],
        to_dataframe: Literal[False] = False,
        project_id: str | None = None,
    ) -> WorkPackagesListResponse | None: ...
    @overload
    def list_work_packages(
        self,
        params: QueryParams | None = None,
        full_response: bool = ...,
        *,
        to_dataframe: Literal[True],
        project_id: str | None = None,
    ) -> "pd.DataFrame": ...
    def list_work_packages(
        self,
        params: QueryParams | None = None,
        full_response: bool = False,
        to_dataframe: bool = False,
        *,
        project_id: str | None = None,
    ) -> "WorkPackagesListResponse | list[WorkPackage] | pd.DataFrame | None":
        """GET /1.0/projects/{projectId}/workpackages.

        Args:
            params: Optional query parameters.
            full_response: If True, return the full WorkPackagesListResponse
                (including metadata and links). If False (default), return
                just the list of WorkPackage items.
            to_dataframe: If True, return the items flattened into a pandas
                DataFrame (requires pandas). Takes precedence over full_response.
            project_id: Project ID. Falls back to the client's configured default.
        """
        project_id = resolve_project_id(project_id, self._client.configuration.project_id)
        response = self._client.get(f"/1.0/projects/{project_id}/workpackages", params=params)
        result = convert_to_list_response(response, WorkPackagesListResponse)
        if to_dataframe:
            return to_dataframe_or_empty(result)
        if full_response:
            return result
        return result.items if result is not None else []
