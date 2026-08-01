"""Users API."""

from typing import Literal, overload

from ..api_client import ApiClient
from ..json_types import JSONValue, QueryParams
from ..models import ProjectUser, UserResponse, UsersListResponse
from ..response_converter import convert_to_list_response, convert_to_model
from ..utils.validation import resolve_project_id


class UsersApi:
    """Methods for users."""

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
        *,
        project_id: str | None = None,
    ) -> list[ProjectUser]: ...
    @overload
    def list_project_users(
        self,
        params: QueryParams | None = None,
        *,
        full_response: Literal[True],
        project_id: str | None = None,
    ) -> UsersListResponse | None: ...
    def list_project_users(
        self,
        params: QueryParams | None = None,
        full_response: bool = False,
        *,
        project_id: str | None = None,
    ) -> UsersListResponse | list[ProjectUser] | None:
        """GET /1.2/projects/{projectId}/users.

        Args:
            params: Optional query parameters.
            full_response: If True, return the full UsersListResponse
                (including metadata and links). If False (default), return
                just the list of ProjectUser items.
            project_id: Project ID. Falls back to the client's configured default.

        Returns:
            List of ProjectUser items, or the full UsersListResponse when
            full_response=True.
        """
        project_id = resolve_project_id(project_id, self._client.configuration.project_id)
        response = self._client.get(f"/1.2/projects/{project_id}/users", params=params)
        result = convert_to_list_response(response, UsersListResponse)
        if full_response:
            return result
        return result.items if result is not None else []

    def get_project_user(
        self, user_id: str, *, project_id: str | None = None
    ) -> JSONValue | None:
        """GET /1.1/projects/{projectId}/users/{userId}."""
        project_id = resolve_project_id(project_id, self._client.configuration.project_id)
        return self._client.get(f"/1.1/projects/{project_id}/users/{user_id}")
