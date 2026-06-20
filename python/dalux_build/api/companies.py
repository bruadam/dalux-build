"""Companies API (project companies)."""
from typing import Any, Dict, Optional

from ..api_client import ApiClient
from ..models import CompaniesListResponse, CompanyResponse
from ..response_converter import convert_to_model


class CompaniesApi:
    """Methods for managing companies on a project."""

    def __init__(self, api_client: ApiClient) -> None:
        self._client = api_client

    def list_project_companies(
        self, project_id: str, params: Optional[Dict[str, Any]] = None
    ) -> Optional[CompaniesListResponse]:
        """GET /3.1/projects/{projectId}/companies.

        Returns:
            CompaniesListResponse with type-safe access to companies.
        """
        response = self._client.get(f"/3.1/projects/{project_id}/companies", params=params)
        return convert_to_model(response, CompaniesListResponse)

    def get_project_company(self, project_id: str, company_id: str) -> Optional[CompanyResponse]:
        """GET /3.0/projects/{projectId}/companies/{companyId}.

        Returns:
            CompanyResponse with company details.
        """
        response = self._client.get(
            f"/3.0/projects/{project_id}/companies/{company_id}"
        )
        return convert_to_model(response, CompanyResponse)

    def create_project_company(
        self, project_id: str, body: Dict[str, Any]
    ) -> Optional[CompanyResponse]:
        """POST /3.1/projects/{projectId}/companies.

        Returns:
            CompanyResponse with the created company.
        """
        response = self._client.post(
            f"/3.1/projects/{project_id}/companies", json=body
        )
        return convert_to_model(response, CompanyResponse)

    def update_project_company(
        self, project_id: str, company_id: str, body: Dict[str, Any]
    ) -> Optional[CompanyResponse]:
        """PATCH /3.0/projects/{projectId}/companies/{companyId}.

        Returns:
            CompanyResponse with the updated company.
        """
        response = self._client.patch(
            f"/3.0/projects/{project_id}/companies/{company_id}", json=body
        )
        return convert_to_model(response, CompanyResponse)
