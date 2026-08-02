"""Company Catalog API."""

from typing import TYPE_CHECKING, Literal, overload

from ..api_client import ApiClient
from ..dashboards.api import DashboardApiMixin
from ..json_types import JSONDict, JSONValue, QueryParams
from ..models import CompaniesListResponse, CompanyResponse, ProjectCompany
from ..response_converter import convert_to_list_response, convert_to_model, to_dataframe_or_empty
from ..utils.search import find_by_field

if TYPE_CHECKING:
    import pandas as pd


class CompanyCatalogApi(DashboardApiMixin):
    """Methods for managing the company catalog."""

    dashboard_resource = "company_catalog"

    def __init__(self, api_client: ApiClient) -> None:
        self._client = api_client

    @overload
    def get_companies(
        self,
        params: QueryParams | None = None,
        full_response: Literal[False] = False,
        to_dataframe: Literal[False] = False,
    ) -> list[ProjectCompany]: ...
    @overload
    def get_companies(
        self,
        params: QueryParams | None = None,
        *,
        full_response: Literal[True],
        to_dataframe: Literal[False] = False,
    ) -> CompaniesListResponse | None: ...
    @overload
    def get_companies(
        self,
        params: QueryParams | None = None,
        full_response: bool = ...,
        *,
        to_dataframe: Literal[True],
    ) -> "pd.DataFrame": ...
    def get_companies(
        self,
        params: QueryParams | None = None,
        full_response: bool = False,
        to_dataframe: bool = False,
    ) -> "CompaniesListResponse | list[ProjectCompany] | pd.DataFrame | None":
        """GET /2.2/companyCatalog — Companies in the catalog.

        Args:
            params: Optional query parameters.
            full_response: If True, return the full CompaniesListResponse
                (including metadata and links). If False (default), return
                just the list of ProjectCompany items.
            to_dataframe: If True, return the items flattened into a pandas
                DataFrame (requires pandas). Takes precedence over full_response.

        Returns:
            List of ProjectCompany items, the full CompaniesListResponse
            when full_response=True, or a DataFrame when to_dataframe=True.
        """
        response = self._client.get("/2.2/companyCatalog", params=params)
        result = convert_to_list_response(response, CompaniesListResponse)
        if to_dataframe:
            return to_dataframe_or_empty(result)
        if full_response:
            return result
        return result.items if result is not None else []

    def get_company(self, catalog_company_id: str) -> CompanyResponse | None:
        """GET /1.2/companyCatalog/{catalogCompanyId}.

        Returns:
            CompanyResponse with company details.
        """
        response = self._client.get(f"/1.2/companyCatalog/{catalog_company_id}")
        return convert_to_model(response, CompanyResponse)

    def create_company(self, body: JSONDict) -> CompanyResponse | None:
        """POST /2.2/companyCatalog.

        Returns:
            CompanyResponse with the created company.
        """
        response = self._client.post("/2.2/companyCatalog", json=body)
        return convert_to_model(response, CompanyResponse)

    def update_company(self, catalog_company_id: str, body: JSONDict) -> CompanyResponse | None:
        """PATCH /2.1/companyCatalog/{catalogCompanyId}.

        Returns:
            CompanyResponse with the updated company.
        """
        response = self._client.patch(f"/2.1/companyCatalog/{catalog_company_id}", json=body)
        return convert_to_model(response, CompanyResponse)

    def list_company_metadata(self, catalog_company_id: str) -> JSONValue | None:
        """GET /1.0/companyCatalog/{catalogCompanyId}/metadata."""
        return self._client.get(f"/1.0/companyCatalog/{catalog_company_id}/metadata")

    def list_company_metadata_mappings(self, catalog_company_id: str) -> JSONValue | None:
        """GET /1.0/companyCatalog/{catalogCompanyId}/metadata/1.0/mappings."""
        return self._client.get(f"/1.0/companyCatalog/{catalog_company_id}/metadata/1.0/mappings")

    def list_company_metadata_values(self, catalog_company_id: str, key: str) -> JSONValue | None:
        """GET /1.0/companyCatalog/{catalogCompanyId}/metadata/1.0/mappings/{key}/values."""
        return self._client.get(
            f"/1.0/companyCatalog/{catalog_company_id}/metadata/1.0/mappings/{key}/values"
        )

    def list_metadata_mappings_for_companies(self) -> JSONValue | None:
        """GET /1.0/companyCatalog/metadata/1.0/mappings."""
        return self._client.get("/1.0/companyCatalog/metadata/1.0/mappings")

    def list_metadata_values_for_companies(self, key: str) -> JSONValue | None:
        """GET /1.0/companyCatalog/metadata/1.0/mappings/{key}/values."""
        return self._client.get(f"/1.0/companyCatalog/metadata/1.0/mappings/{key}/values")

    def get_company_by_name(self, company_name: str) -> str | None:
        """Get company ID by name.

        Args:
            company_name: Name of the company to search for.

        Returns:
            The company ID if found, None otherwise.
        """
        items = self.get_companies()
        if not items:
            return None

        # Use generic search utility
        company = find_by_field(items, "company_name", company_name)
        return company.catalog_company_id if company else None
