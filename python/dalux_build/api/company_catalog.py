"""Company Catalog API."""
from typing import Any, Dict, Optional

from ..api_client import ApiClient
from ..models import CompaniesListResponse, CompanyResponse
from ..response_converter import convert_to_model


class CompanyCatalogApi:
    """Methods for managing the company catalog."""

    def __init__(self, api_client: ApiClient) -> None:
        self._client = api_client

    def get_companies(self, params: Optional[Dict[str, Any]] = None) -> Optional[CompaniesListResponse]:
        """GET /2.2/companyCatalog — Companies in the catalog.

        Returns:
            CompaniesListResponse with type-safe access to companies.
        """
        response = self._client.get("/2.2/companyCatalog", params=params)
        return convert_to_model(response, CompaniesListResponse)

    def get_company(self, catalog_company_id: str) -> Optional[CompanyResponse]:
        """GET /1.2/companyCatalog/{catalogCompanyId}.

        Returns:
            CompanyResponse with company details.
        """
        response = self._client.get(f"/1.2/companyCatalog/{catalog_company_id}")
        return convert_to_model(response, CompanyResponse)

    def create_company(self, body: Dict[str, Any]) -> Optional[CompanyResponse]:
        """POST /2.2/companyCatalog.

        Returns:
            CompanyResponse with the created company.
        """
        response = self._client.post("/2.2/companyCatalog", json=body)
        return convert_to_model(response, CompanyResponse)

    def update_company(
        self, catalog_company_id: str, body: Dict[str, Any]
    ) -> Optional[CompanyResponse]:
        """PATCH /2.1/companyCatalog/{catalogCompanyId}.

        Returns:
            CompanyResponse with the updated company.
        """
        response = self._client.patch(
            f"/2.1/companyCatalog/{catalog_company_id}", json=body
        )
        return convert_to_model(response, CompanyResponse)

    def list_company_metadata(self, catalog_company_id: str) -> Any:
        """GET /1.0/companyCatalog/{catalogCompanyId}/metadata."""
        return self._client.get(
            f"/1.0/companyCatalog/{catalog_company_id}/metadata"
        )

    def list_company_metadata_mappings(self, catalog_company_id: str) -> Any:
        """GET /1.0/companyCatalog/{catalogCompanyId}/metadata/1.0/mappings."""
        return self._client.get(
            f"/1.0/companyCatalog/{catalog_company_id}/metadata/1.0/mappings"
        )

    def list_company_metadata_values(
        self, catalog_company_id: str, key: str
    ) -> Any:
        """GET /1.0/companyCatalog/{catalogCompanyId}/metadata/1.0/mappings/{key}/values."""
        return self._client.get(
            f"/1.0/companyCatalog/{catalog_company_id}/metadata/1.0/mappings/{key}/values"
        )

    def list_metadata_mappings_for_companies(self) -> Any:
        """GET /1.0/companyCatalog/metadata/1.0/mappings."""
        return self._client.get("/1.0/companyCatalog/metadata/1.0/mappings")

    def list_metadata_values_for_companies(self, key: str) -> Any:
        """GET /1.0/companyCatalog/metadata/1.0/mappings/{key}/values."""
        return self._client.get(
            f"/1.0/companyCatalog/metadata/1.0/mappings/{key}/values"
        )
