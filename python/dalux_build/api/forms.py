"""Forms API."""
from typing import Any, Dict, Optional

from ..api_client import ApiClient
from ..models import FormsListResponse, FormResponse
from ..response_converter import convert_to_model


class FormsApi:
    """Methods for forms on a project."""

    def __init__(self, api_client: ApiClient) -> None:
        self._client = api_client

    def get_project_forms(
        self, project_id: str, params: Optional[Dict[str, Any]] = None
    ) -> Optional[FormsListResponse]:
        """GET /2.1/projects/{projectId}/forms.

        Returns:
            FormsListResponse with type-safe access to forms.
        """
        response = self._client.get(f"/2.1/projects/{project_id}/forms", params=params)
        return convert_to_model(response, FormsListResponse)

    def get_form(self, project_id: str, form_id: str) -> Optional[FormResponse]:
        """GET /1.2/projects/{projectId}/forms/{formId}.

        Returns:
            FormResponse with form details.
        """
        response = self._client.get(f"/1.2/projects/{project_id}/forms/{form_id}")
        return convert_to_model(response, FormResponse)

    def get_project_form_attachments(
        self, project_id: str, params: Optional[Dict[str, Any]] = None
    ) -> Any:
        """GET /2.1/projects/{projectId}/forms/attachments."""
        return self._client.get(
            f"/2.1/projects/{project_id}/forms/attachments", params=params
        )
