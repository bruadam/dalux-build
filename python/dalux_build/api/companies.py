"""Companies API (project companies)."""

from typing import TYPE_CHECKING, Literal, overload

from ..api_client import ApiClient
from ..json_types import JSONDict, QueryParams
from ..models import CompaniesListResponse, CompanyResponse, ProjectCompany
from ..response_converter import convert_to_list_response, convert_to_model, to_dataframe_or_empty
from ..utils.validation import resolve_project_id

if TYPE_CHECKING:
    import pandas as pd


class CompaniesApi:
    """Methods for managing companies on a project."""

    def __init__(self, api_client: ApiClient) -> None:
        self._client = api_client

    @overload
    def list_project_companies(
        self,
        params: QueryParams | None = None,
        full_response: Literal[False] = False,
        to_dataframe: Literal[False] = False,
        *,
        project_id: str | None = None,
    ) -> list[ProjectCompany]: ...
    @overload
    def list_project_companies(
        self,
        params: QueryParams | None = None,
        *,
        full_response: Literal[True],
        to_dataframe: Literal[False] = False,
        project_id: str | None = None,
    ) -> CompaniesListResponse | None: ...
    @overload
    def list_project_companies(
        self,
        params: QueryParams | None = None,
        full_response: bool = ...,
        *,
        to_dataframe: Literal[True],
        project_id: str | None = None,
    ) -> "pd.DataFrame": ...
    def list_project_companies(
        self,
        params: QueryParams | None = None,
        full_response: bool = False,
        to_dataframe: bool = False,
        *,
        project_id: str | None = None,
    ) -> "CompaniesListResponse | list[ProjectCompany] | pd.DataFrame | None":
        """GET /3.1/projects/{projectId}/companies.

        Args:
            params: Optional query parameters.
            full_response: If True, return the full CompaniesListResponse
                (including metadata and links). If False (default), return
                just the list of ProjectCompany items.
            to_dataframe: If True, return the items flattened into a pandas
                DataFrame (requires pandas). Takes precedence over full_response.
            project_id: Project ID. Falls back to the client's configured default.

        Returns:
            List of ProjectCompany items, the full CompaniesListResponse
            when full_response=True, or a DataFrame when to_dataframe=True.
        """
        project_id = resolve_project_id(project_id, self._client.configuration.project_id)
        response = self._client.get(f"/3.1/projects/{project_id}/companies", params=params)
        result = convert_to_list_response(response, CompaniesListResponse)
        if to_dataframe:
            return to_dataframe_or_empty(result)
        if full_response:
            return result
        return result.items if result is not None else []

    def get_project_company(
        self, company_id: str, *, project_id: str | None = None
    ) -> CompanyResponse | None:
        """GET /3.0/projects/{projectId}/companies/{companyId}.

        Returns:
            CompanyResponse with company details.
        """
        project_id = resolve_project_id(project_id, self._client.configuration.project_id)
        response = self._client.get(f"/3.0/projects/{project_id}/companies/{company_id}")
        return convert_to_model(response, CompanyResponse)

    def create_project_company(
        self, body: JSONDict, *, project_id: str | None = None
    ) -> CompanyResponse | None:
        """POST /3.1/projects/{projectId}/companies.

        Returns:
            CompanyResponse with the created company.
        """
        project_id = resolve_project_id(project_id, self._client.configuration.project_id)
        response = self._client.post(f"/3.1/projects/{project_id}/companies", json=body)
        return convert_to_model(response, CompanyResponse)

    def update_project_company(
        self, company_id: str, body: JSONDict, *, project_id: str | None = None
    ) -> CompanyResponse | None:
        """PATCH /3.0/projects/{projectId}/companies/{companyId}.

        Returns:
            CompanyResponse with the updated company.
        """
        project_id = resolve_project_id(project_id, self._client.configuration.project_id)
        response = self._client.patch(
            f"/3.0/projects/{project_id}/companies/{company_id}", json=body
        )
        return convert_to_model(response, CompanyResponse)
