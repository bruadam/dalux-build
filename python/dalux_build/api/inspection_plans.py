"""Inspection Plans API."""
from typing import Dict, List, Optional

from ..api_client import ApiClient
from ..models import (
    InspectionPlan,
    InspectionPlanItem,
    InspectionPlanItemZone,
    InspectionPlanRegistration,
    InspectionPlanItemZonesListResponse,
    InspectionPlanItemsListResponse,
    InspectionPlanRegistrationsListResponse,
    InspectionPlansListResponse,
)
from ..response_converter import convert_to_model
from ..utils.pagination import paginate
from ..utils.validation import validate_project_id


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
        validate_project_id(project_id)
        response = self._client.get(
            f"/1.2/projects/{project_id}/inspectionPlans", params=params
        )
        return convert_to_model(response, InspectionPlansListResponse)

    def get_all_inspection_plans(
        self,
        project_id: str,
        params: Optional[Dict[str, object]] = None,
        verbose: bool = False,
    ) -> List[InspectionPlan]:
        """Retrieve all inspection plans by following bookmark pagination automatically.

        Args:
            project_id: Project ID.
            params: Optional query parameters.
            verbose: Whether to print progress information.

        Returns:
            List of all inspection plan items across pages.
        """
        validate_project_id(project_id)
        endpoint = f"/1.2/projects/{project_id}/inspectionPlans"
        raw_items = paginate(endpoint, self._client, params, verbose)
        return InspectionPlansListResponse.model_validate({"items": raw_items}).items

    def list_inspection_plan_items(
        self, project_id: str, params: Optional[Dict[str, object]] = None
    ) -> Optional[InspectionPlanItemsListResponse]:
        """GET /1.1/projects/{projectId}/inspectionPlanItems."""
        validate_project_id(project_id)
        response = self._client.get(
            f"/1.1/projects/{project_id}/inspectionPlanItems", params=params
        )
        return convert_to_model(response, InspectionPlanItemsListResponse)

    def get_all_inspection_plan_items(
        self,
        project_id: str,
        params: Optional[Dict[str, object]] = None,
        verbose: bool = False,
    ) -> List[InspectionPlanItem]:
        """Retrieve all inspection plan items by following bookmark pagination."""
        validate_project_id(project_id)
        endpoint = f"/1.1/projects/{project_id}/inspectionPlanItems"
        raw_items = paginate(endpoint, self._client, params, verbose)
        return InspectionPlanItemsListResponse.model_validate({"items": raw_items}).items

    def list_inspection_plan_item_zones(
        self, project_id: str, params: Optional[Dict[str, object]] = None
    ) -> Optional[InspectionPlanItemZonesListResponse]:
        """GET /1.1/projects/{projectId}/inspectionPlanItemZones."""
        validate_project_id(project_id)
        response = self._client.get(
            f"/1.1/projects/{project_id}/inspectionPlanItemZones", params=params
        )
        return convert_to_model(response, InspectionPlanItemZonesListResponse)

    def get_all_inspection_plan_item_zones(
        self,
        project_id: str,
        params: Optional[Dict[str, object]] = None,
        verbose: bool = False,
    ) -> List[InspectionPlanItemZone]:
        """Retrieve all inspection plan item zones by following bookmark pagination."""
        validate_project_id(project_id)
        endpoint = f"/1.1/projects/{project_id}/inspectionPlanItemZones"
        raw_items = paginate(endpoint, self._client, params, verbose)
        return InspectionPlanItemZonesListResponse.model_validate({"items": raw_items}).items

    def list_inspection_plan_registrations(
        self, project_id: str, params: Optional[Dict[str, object]] = None
    ) -> Optional[InspectionPlanRegistrationsListResponse]:
        """GET /2.1/projects/{projectId}/inspectionPlanRegistrations."""
        validate_project_id(project_id)
        response = self._client.get(
            f"/2.1/projects/{project_id}/inspectionPlanRegistrations", params=params
        )
        return convert_to_model(response, InspectionPlanRegistrationsListResponse)

    def get_all_inspection_plan_registrations(
        self,
        project_id: str,
        params: Optional[Dict[str, object]] = None,
        verbose: bool = False,
    ) -> List[InspectionPlanRegistration]:
        """Retrieve all inspection plan registrations by following bookmark pagination."""
        validate_project_id(project_id)
        endpoint = f"/2.1/projects/{project_id}/inspectionPlanRegistrations"
        raw_items = paginate(endpoint, self._client, params, verbose)
        return InspectionPlanRegistrationsListResponse.model_validate({"items": raw_items}).items
