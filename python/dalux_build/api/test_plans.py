"""Test Plans API."""
from typing import Any, Dict, Optional

from ..api_client import ApiClient


class TestPlansApi:
    """Methods for test plans."""

    def __init__(self, api_client: ApiClient) -> None:
        self._client = api_client

    def list_test_plans(
        self, project_id: str, params: Optional[Dict[str, Any]] = None
    ) -> Any:
        """GET /1.2/projects/{projectId}/testPlans."""
        response = self._client.get(
            f"/1.2/projects/{project_id}/testPlans", params=params
        )

        if self._client.configuration.use_pydantic and isinstance(response, dict):
            try:
                from ..models import TestPlansListResponse
                return TestPlansListResponse(**response)
            except Exception:
                return response

        return response

    def list_test_plan_items(
        self, project_id: str, params: Optional[Dict[str, Any]] = None
    ) -> Any:
        """GET /1.1/projects/{projectId}/testPlanItems."""
        return self._client.get(
            f"/1.1/projects/{project_id}/testPlanItems", params=params
        )

    def list_test_plan_item_zones(
        self, project_id: str, params: Optional[Dict[str, Any]] = None
    ) -> Any:
        """GET /1.1/projects/{projectId}/testPlanItemZones."""
        return self._client.get(
            f"/1.1/projects/{project_id}/testPlanItemZones", params=params
        )

    def list_test_plan_registrations(
        self, project_id: str, params: Optional[Dict[str, Any]] = None
    ) -> Any:
        """GET /1.1/projects/{projectId}/testPlanRegistrations."""
        return self._client.get(
            f"/1.1/projects/{project_id}/testPlanRegistrations", params=params
        )
