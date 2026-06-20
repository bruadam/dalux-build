"""Forms API."""
from typing import Any, Dict, Optional

from ..api_client import ApiClient


class FormsApi:
    """Methods for forms on a project."""

    def __init__(self, api_client: ApiClient) -> None:
        self._client = api_client

    def get_project_forms(
        self, project_id: str, params: Optional[Dict[str, Any]] = None
    ) -> Any:
        """GET /2.1/projects/{projectId}/forms."""
        response = self._client.get(f"/2.1/projects/{project_id}/forms", params=params)

        if self._client.configuration.use_pydantic and isinstance(response, dict):
            try:
                from ..models import FormsListResponse
                return FormsListResponse(**response)
            except Exception:
                return response

        return response

    def get_form(self, project_id: str, form_id: str) -> Any:
        """GET /1.2/projects/{projectId}/forms/{formId}."""
        response = self._client.get(f"/1.2/projects/{project_id}/forms/{form_id}")

        if self._client.configuration.use_pydantic and isinstance(response, dict):
            try:
                from ..models import FormResponse
                return FormResponse(**response)
            except Exception:
                return response

        return response

    def get_project_form_attachments(
        self, project_id: str, params: Optional[Dict[str, Any]] = None
    ) -> Any:
        """GET /2.1/projects/{projectId}/forms/attachments."""
        return self._client.get(
            f"/2.1/projects/{project_id}/forms/attachments", params=params
        )
