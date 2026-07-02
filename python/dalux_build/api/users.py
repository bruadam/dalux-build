"""Users API."""
from typing import Any, Dict, Optional

from ..api_client import ApiClient
from ..models import UserResponse, UsersListResponse
from ..response_converter import convert_to_model
from ..utils.search import find_by_field, find_all_by_field
from ..utils.validation import validate_project_id, validate_file_area_id
from ..utils.pagination import paginate


class UsersApi:
    """Methods for users."""

    def __init__(self, api_client: ApiClient) -> None:
        self._client = api_client

    def get_user(self, user_id: str) -> Optional[UserResponse]:
        """GET /1.1/users/{userId}.

        Returns:
            UserResponse with user details.
        """
        response = self._client.get(f"/1.1/users/{user_id}")
        return convert_to_model(response, UserResponse)

    def list_project_users(
        self, project_id: str, params: Optional[Dict[str, Any]] = None
    ) -> Optional[UsersListResponse]:
        """GET /1.2/projects/{projectId}/users.

        Returns:
            UsersListResponse with type-safe access to project users.
        """
        validate_project_id(project_id)
        response = self._client.get(
            f"/1.2/projects/{project_id}/users", params=params
        )
        return convert_to_model(response, UsersListResponse)

    def get_project_user(self, project_id: str, user_id: str) -> Any:
        """GET /1.1/projects/{projectId}/users/{userId}."""
        validate_project_id(project_id)
        return self._client.get(
            f"/1.1/projects/{project_id}/users/{user_id}"
        )
