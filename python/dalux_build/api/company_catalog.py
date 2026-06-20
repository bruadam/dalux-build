"""Company Catalog API."""
from typing import Any, Dict, Optional

from ..api_client import ApiClient


class CompanyCatalogApi:
    """Methods for managing the company catalog."""

    def __init__(self, api_client: ApiClient) -> None:
        self._client = api_client

    def get_companies(self, params: Optional[Dict[str, Any]] = None) -> Any:
        """GET /2.2/companyCatalog — Companies in the catalog."""
        response = self._client.get("/2.2/companyCatalog", params=params)

        if self._client.configuration.use_pydantic and isinstance(response, dict):
            try:
                from ..models import CompaniesListResponse
                return CompaniesListResponse(**response)
            except Exception:
                return response

        return response

    def get_company(self, catalog_company_id: str) -> Any:
        """GET /1.2/companyCatalog/{catalogCompanyId}."""
        response = self._client.get(f"/1.2/companyCatalog/{catalog_company_id}")

        if self._client.configuration.use_pydantic and isinstance(response, dict):
            try:
                from ..models import CompanyResponse
                return CompanyResponse(**response)
            except Exception:
                return response

        return response

    def create_company(self, body: Dict[str, Any]) -> Any:
        """POST /2.2/companyCatalog."""
        return self._client.post("/2.2/companyCatalog", json=body)

    def update_company(
        self, catalog_company_id: str, body: Dict[str, Any]
    ) -> Any:
        """PATCH /2.1/companyCatalog/{catalogCompanyId}."""
        return self._client.patch(
            f"/2.1/companyCatalog/{catalog_company_id}", json=body
        )

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
