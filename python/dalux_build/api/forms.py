"""Forms API."""

from typing import TYPE_CHECKING, Literal, overload

from ..api_client import ApiClient
from ..dashboards.api import DashboardApiMixin
from ..json_types import JSONValue, QueryParams
from ..models import FormResponse, FormsListResponse
from ..response_converter import convert_to_list_response, convert_to_model, to_dataframe_or_empty
from ..utils.validation import resolve_project_id

if TYPE_CHECKING:
    import pandas as pd


class FormsApi(DashboardApiMixin):
    """Methods for forms on a project."""

    dashboard_resource = "forms"

    def __init__(self, api_client: ApiClient) -> None:
        self._client = api_client

    @overload
    def get_project_forms(
        self,
        params: QueryParams | None = None,
        full_response: Literal[False] = False,
        to_dataframe: Literal[False] = False,
        *,
        project_id: str | None = None,
    ) -> list[dict[str, JSONValue]]: ...
    @overload
    def get_project_forms(
        self,
        params: QueryParams | None = None,
        *,
        full_response: Literal[True],
        to_dataframe: Literal[False] = False,
        project_id: str | None = None,
    ) -> FormsListResponse | None: ...
    @overload
    def get_project_forms(
        self,
        params: QueryParams | None = None,
        full_response: bool = ...,
        *,
        to_dataframe: Literal[True],
        project_id: str | None = None,
    ) -> "pd.DataFrame": ...
    def get_project_forms(
        self,
        params: QueryParams | None = None,
        full_response: bool = False,
        to_dataframe: bool = False,
        *,
        project_id: str | None = None,
    ) -> "FormsListResponse | list[dict[str, JSONValue]] | pd.DataFrame | None":
        """GET /2.1/projects/{projectId}/forms.

        Args:
            params: Optional query parameters.
            full_response: If True, return the full FormsListResponse
                (including metadata and links). If False (default), return
                just the list of form item dicts.
            to_dataframe: If True, return the items flattened into a pandas
                DataFrame (requires pandas). Takes precedence over full_response.
            project_id: Project ID. Falls back to the client's configured default.

        Returns:
            List of form item dicts, the full FormsListResponse when
            full_response=True, or a DataFrame when to_dataframe=True.
        """
        project_id = resolve_project_id(project_id, self._client.configuration.project_id)
        response = self._client.get(f"/2.1/projects/{project_id}/forms", params=params)
        result = convert_to_list_response(response, FormsListResponse)
        if to_dataframe:
            return to_dataframe_or_empty(result)
        if full_response:
            return result
        return result.items if result is not None else []

    def get_form(self, form_id: str, *, project_id: str | None = None) -> FormResponse | None:
        """GET /1.2/projects/{projectId}/forms/{formId}.

        Returns:
            FormResponse with form details.
        """
        project_id = resolve_project_id(project_id, self._client.configuration.project_id)
        response = self._client.get(f"/1.2/projects/{project_id}/forms/{form_id}")
        return convert_to_model(response, FormResponse)

    def get_project_form_attachments(
        self, params: QueryParams | None = None, *, project_id: str | None = None
    ) -> JSONValue | None:
        """GET /2.1/projects/{projectId}/forms/attachments."""
        project_id = resolve_project_id(project_id, self._client.configuration.project_id)
        return self._client.get(f"/2.1/projects/{project_id}/forms/attachments", params=params)
