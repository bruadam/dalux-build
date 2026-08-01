"""Work Packages API."""

from typing import Literal, overload

from ..api_client import ApiClient
from ..json_types import QueryParams
from ..models import WorkPackage, WorkPackagesListResponse
from ..response_converter import convert_to_list_response
from ..utils.validation import resolve_project_id


class WorkPackagesApi:
    """Methods for work packages on a project."""

    def __init__(self, api_client: ApiClient) -> None:
        self._client = api_client

    @overload
    def list_work_packages(
        self,
        params: QueryParams | None = None,
        full_response: Literal[False] = False,
        *,
        project_id: str | None = None,
    ) -> list[WorkPackage]: ...
    @overload
    def list_work_packages(
        self,
        params: QueryParams | None = None,
        *,
        full_response: Literal[True],
        project_id: str | None = None,
    ) -> WorkPackagesListResponse | None: ...
    def list_work_packages(
        self,
        params: QueryParams | None = None,
        full_response: bool = False,
        *,
        project_id: str | None = None,
    ) -> WorkPackagesListResponse | list[WorkPackage] | None:
        """GET /1.0/projects/{projectId}/workpackages.

        Args:
            params: Optional query parameters.
            full_response: If True, return the full WorkPackagesListResponse
                (including metadata and links). If False (default), return
                just the list of WorkPackage items.
            project_id: Project ID. Falls back to the client's configured default.
        """
        project_id = resolve_project_id(project_id, self._client.configuration.project_id)
        response = self._client.get(f"/1.0/projects/{project_id}/workpackages", params=params)
        result = convert_to_list_response(response, WorkPackagesListResponse)
        if full_response:
            return result
        return result.items if result is not None else []
