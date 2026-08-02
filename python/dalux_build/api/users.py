"""Users API."""

from typing import TYPE_CHECKING, Literal, overload

from ..api_client import ApiClient
from ..dashboards.api import DashboardApiMixin
from ..json_types import JSONValue, QueryParams
from ..models import ProjectUser, UserResponse, UsersListResponse
from ..response_converter import convert_to_list_response, convert_to_model, to_dataframe_or_empty
from ..utils.validation import resolve_project_id

if TYPE_CHECKING:
    import pandas as pd


class UsersApi(DashboardApiMixin):
    """Methods for users."""

    dashboard_resource = "users"

    def __init__(self, api_client: ApiClient) -> None:
        self._client = api_client

    def get_user(self, user_id: str) -> UserResponse | None:
        """GET /1.1/users/{userId}.

        Returns:
            UserResponse with user details.
        """
        response = self._client.get(f"/1.1/users/{user_id}")
        return convert_to_model(response, UserResponse)

    @overload
    def list_project_users(
        self,
        params: QueryParams | None = None,
        full_response: Literal[False] = False,
        to_dataframe: Literal[False] = False,
        *,
        project_id: str | None = None,
    ) -> list[ProjectUser]: ...
    @overload
    def list_project_users(
        self,
        params: QueryParams | None = None,
        *,
        full_response: Literal[True],
        to_dataframe: Literal[False] = False,
        project_id: str | None = None,
    ) -> UsersListResponse | None: ...
    @overload
    def list_project_users(
        self,
        params: QueryParams | None = None,
        full_response: bool = ...,
        *,
        to_dataframe: Literal[True],
        project_id: str | None = None,
    ) -> "pd.DataFrame": ...
    def list_project_users(
        self,
        params: QueryParams | None = None,
        full_response: bool = False,
        to_dataframe: bool = False,
        *,
        project_id: str | None = None,
    ) -> "UsersListResponse | list[ProjectUser] | pd.DataFrame | None":
        """GET /1.2/projects/{projectId}/users.

        Args:
            params: Optional query parameters.
            full_response: If True, return the full UsersListResponse
                (including metadata and links). If False (default), return
                just the list of ProjectUser items.
            to_dataframe: If True, return the items flattened into a pandas
                DataFrame (requires pandas). Takes precedence over full_response.
            project_id: Project ID. Falls back to the client's configured default.

        Returns:
            List of ProjectUser items, the full UsersListResponse when
            full_response=True, or a DataFrame when to_dataframe=True.
        """
        project_id = resolve_project_id(project_id, self._client.configuration.project_id)
        response = self._client.get(f"/1.2/projects/{project_id}/users", params=params)
        result = convert_to_list_response(response, UsersListResponse)
        if to_dataframe:
            return to_dataframe_or_empty(result)
        if full_response:
            return result
        return result.items if result is not None else []

    def get_project_user(self, user_id: str, *, project_id: str | None = None) -> JSONValue | None:
        """GET /1.1/projects/{projectId}/users/{userId}."""
        project_id = resolve_project_id(project_id, self._client.configuration.project_id)
        return self._client.get(f"/1.1/projects/{project_id}/users/{user_id}")
