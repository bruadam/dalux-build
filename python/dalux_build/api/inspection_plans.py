"""Inspection Plans API."""
from typing import Any, Dict, Optional

from ..api_client import ApiClient
from ..models import InspectionPlansListResponse
from ..response_converter import convert_to_model


class InspectionPlansApi:
    """Methods for inspection plans."""

    def __init__(self, api_client: ApiClient) -> None:
        self._client = api_client

    def list_inspection_plans(
        self, project_id: str, params: Optional[Dict[str, Any]] = None
    ) -> Optional[InspectionPlansListResponse]:
        """GET /1.2/projects/{projectId}/inspectionPlans.

        Returns:
            InspectionPlansListResponse with type-safe access to inspection plans.
        """
        response = self._client.get(
            f"/1.2/projects/{project_id}/inspectionPlans", params=params
        )
        return convert_to_model(response, InspectionPlansListResponse)

    def list_inspection_plan_items(
        self, project_id: str, params: Optional[Dict[str, Any]] = None
    ) -> Any:
        """GET /1.1/projects/{projectId}/inspectionPlanItems."""
        return self._client.get(
            f"/1.1/projects/{project_id}/inspectionPlanItems", params=params
        )

    def list_inspection_plan_item_zones(
        self, project_id: str, params: Optional[Dict[str, Any]] = None
    ) -> Any:
        """GET /1.1/projects/{projectId}/inspectionPlanItemZones."""
        return self._client.get(
            f"/1.1/projects/{project_id}/inspectionPlanItemZones", params=params
        )

    def list_inspection_plan_registrations(
        self, project_id: str, params: Optional[Dict[str, Any]] = None
    ) -> Any:
        """GET /2.1/projects/{projectId}/inspectionPlanRegistrations."""
        return self._client.get(
            f"/2.1/projects/{project_id}/inspectionPlanRegistrations", params=params
        )
