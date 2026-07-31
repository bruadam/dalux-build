"""Test Plans API."""
from typing import Dict, List, Optional, Any

from ..api_client import ApiClient
from ..models import (
    TestPlan,
    TestPlanItem,
    TestPlanItemZone,
    TestPlanRegistration,
    TestPlanItemZonesListResponse,
    TestPlanItemsListResponse,
    TestPlanRegistrationsListResponse,
    TestPlansListResponse,
)
from ..response_converter import convert_to_model
from ..utils.pagination import paginate
from ..utils.validation import validate_project_id


class TestPlansApi:
    """Methods for test plans."""

    def __init__(self, api_client: ApiClient) -> None:
        self._client = api_client

    def list_test_plans(
        self, project_id: str, params: Optional[Dict[str, Any]] = None
    ) -> Optional[TestPlansListResponse]:
        """GET /1.2/projects/{projectId}/testPlans.

        Returns:
            TestPlansListResponse with type-safe access to test plans.
        """
        validate_project_id(project_id)
        response = self._client.get(
            f"/1.2/projects/{project_id}/testPlans", params=params
        )
        return convert_to_model(response, TestPlansListResponse)

    def get_all_test_plans(
        self,
        project_id: str,
        params: Optional[Dict[str, object]] = None,
        verbose: bool = False,
    ) -> List[TestPlan]:
        """Retrieve all test plans by following bookmark pagination automatically.

        Args:
            project_id: Project ID.
            params: Optional query parameters.
            verbose: Whether to print progress information.

        Returns:
            List of all test plan items across pages.
        """
        validate_project_id(project_id)
        endpoint = f"/1.2/projects/{project_id}/testPlans"
        raw_items = paginate(endpoint, self._client, params, verbose)
        return TestPlansListResponse.model_validate({"items": raw_items}).items

    def list_test_plan_items(
        self, project_id: str, params: Optional[Dict[str, object]] = None
    ) -> Optional[TestPlanItemsListResponse]:
        """GET /1.1/projects/{projectId}/testPlanItems."""
        validate_project_id(project_id)
        response = self._client.get(
            f"/1.1/projects/{project_id}/testPlanItems", params=params
        )
        return convert_to_model(response, TestPlanItemsListResponse)

    def get_all_test_plan_items(
        self,
        project_id: str,
        params: Optional[Dict[str, object]] = None,
        verbose: bool = False,
    ) -> List[TestPlanItem]:
        """Retrieve all test plan items by following bookmark pagination."""
        validate_project_id(project_id)
        endpoint = f"/1.1/projects/{project_id}/testPlanItems"
        raw_items = paginate(endpoint, self._client, params, verbose)
        return TestPlanItemsListResponse.model_validate({"items": raw_items}).items

    def list_test_plan_item_zones(
        self, project_id: str, params: Optional[Dict[str, object]] = None
    ) -> Optional[TestPlanItemZonesListResponse]:
        """GET /1.1/projects/{projectId}/testPlanItemZones."""
        validate_project_id(project_id)
        response = self._client.get(
            f"/1.1/projects/{project_id}/testPlanItemZones", params=params
        )
        return convert_to_model(response, TestPlanItemZonesListResponse)

    def get_all_test_plan_item_zones(
        self,
        project_id: str,
        params: Optional[Dict[str, object]] = None,
        verbose: bool = False,
    ) -> List[TestPlanItemZone]:
        """Retrieve all test plan item zones by following bookmark pagination."""
        validate_project_id(project_id)
        endpoint = f"/1.1/projects/{project_id}/testPlanItemZones"
        raw_items = paginate(endpoint, self._client, params, verbose)
        return TestPlanItemZonesListResponse.model_validate({"items": raw_items}).items

    def list_test_plan_registrations(
        self, project_id: str, params: Optional[Dict[str, object]] = None
    ) -> Optional[TestPlanRegistrationsListResponse]:
        """GET /1.1/projects/{projectId}/testPlanRegistrations."""
        validate_project_id(project_id)
        response = self._client.get(
            f"/1.1/projects/{project_id}/testPlanRegistrations", params=params
        )
        return convert_to_model(response, TestPlanRegistrationsListResponse)

    def get_all_test_plan_registrations(
        self,
        project_id: str,
        params: Optional[Dict[str, object]] = None,
        verbose: bool = False,
    ) -> List[TestPlanRegistration]:
        """Retrieve all test plan registrations by following bookmark pagination."""
        validate_project_id(project_id)
        endpoint = f"/1.1/projects/{project_id}/testPlanRegistrations"
        raw_items = paginate(endpoint, self._client, params, verbose)
        return TestPlanRegistrationsListResponse.model_validate({"items": raw_items}).items
