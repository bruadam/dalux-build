"""Test Plans API."""

from typing import Literal, overload

from ..api_client import ApiClient
from ..json_types import QueryParams
from ..models import (
    TestPlan,
    TestPlanItem,
    TestPlanItemsListResponse,
    TestPlanItemZone,
    TestPlanItemZonesListResponse,
    TestPlanRegistration,
    TestPlanRegistrationsListResponse,
    TestPlansListResponse,
)
from ..response_converter import convert_to_list_response
from ..utils.pagination import paginate
from ..utils.validation import resolve_project_id


class TestPlansApi:
    """Methods for test plans."""

    def __init__(self, api_client: ApiClient) -> None:
        self._client = api_client

    @overload
    def list_test_plans(
        self,
        params: QueryParams | None = None,
        full_response: Literal[False] = False,
        *,
        project_id: str | None = None,
    ) -> list[TestPlan]: ...
    @overload
    def list_test_plans(
        self,
        params: QueryParams | None = None,
        *,
        full_response: Literal[True],
        project_id: str | None = None,
    ) -> TestPlansListResponse | None: ...
    def list_test_plans(
        self,
        params: QueryParams | None = None,
        full_response: bool = False,
        *,
        project_id: str | None = None,
    ) -> TestPlansListResponse | list[TestPlan] | None:
        """GET /1.2/projects/{projectId}/testPlans.

        Args:
            params: Optional query parameters.
            full_response: If True, return the full TestPlansListResponse
                (including metadata and links). If False (default), return
                just the list of TestPlan items.
            project_id: Project ID. Falls back to the client's configured default.

        Returns:
            List of TestPlan items, or the full TestPlansListResponse
            when full_response=True.
        """
        project_id = resolve_project_id(project_id, self._client.configuration.project_id)
        response = self._client.get(f"/1.2/projects/{project_id}/testPlans", params=params)
        result = convert_to_list_response(response, TestPlansListResponse)
        if full_response:
            return result
        return result.items if result is not None else []

    def get_all_test_plans(
        self,
        params: QueryParams | None = None,
        verbose: bool = False,
        *,
        project_id: str | None = None,
    ) -> list[TestPlan]:
        """Retrieve all test plans by following bookmark pagination automatically.

        Args:
            params: Optional query parameters.
            verbose: Whether to print progress information.
            project_id: Project ID. Falls back to the client's configured default.

        Returns:
            List of all test plan items across pages.
        """
        project_id = resolve_project_id(project_id, self._client.configuration.project_id)
        endpoint = f"/1.2/projects/{project_id}/testPlans"
        raw_items = paginate(endpoint, self._client, params, verbose)
        return TestPlansListResponse.model_validate({"items": raw_items}).items

    @overload
    def list_test_plan_items(
        self,
        params: QueryParams | None = None,
        full_response: Literal[False] = False,
        *,
        project_id: str | None = None,
    ) -> list[TestPlanItem]: ...
    @overload
    def list_test_plan_items(
        self,
        params: QueryParams | None = None,
        *,
        full_response: Literal[True],
        project_id: str | None = None,
    ) -> TestPlanItemsListResponse | None: ...
    def list_test_plan_items(
        self,
        params: QueryParams | None = None,
        full_response: bool = False,
        *,
        project_id: str | None = None,
    ) -> TestPlanItemsListResponse | list[TestPlanItem] | None:
        """GET /1.1/projects/{projectId}/testPlanItems.

        Args:
            params: Optional query parameters.
            full_response: If True, return the full TestPlanItemsListResponse
                (including metadata and links). If False (default), return
                just the list of TestPlanItem items.
            project_id: Project ID. Falls back to the client's configured default.
        """
        project_id = resolve_project_id(project_id, self._client.configuration.project_id)
        response = self._client.get(f"/1.1/projects/{project_id}/testPlanItems", params=params)
        result = convert_to_list_response(response, TestPlanItemsListResponse)
        if full_response:
            return result
        return result.items if result is not None else []

    def get_all_test_plan_items(
        self,
        params: QueryParams | None = None,
        verbose: bool = False,
        *,
        project_id: str | None = None,
    ) -> list[TestPlanItem]:
        """Retrieve all test plan items by following bookmark pagination."""
        project_id = resolve_project_id(project_id, self._client.configuration.project_id)
        endpoint = f"/1.1/projects/{project_id}/testPlanItems"
        raw_items = paginate(endpoint, self._client, params, verbose)
        return TestPlanItemsListResponse.model_validate({"items": raw_items}).items

    @overload
    def list_test_plan_item_zones(
        self,
        params: QueryParams | None = None,
        full_response: Literal[False] = False,
        *,
        project_id: str | None = None,
    ) -> list[TestPlanItemZone]: ...
    @overload
    def list_test_plan_item_zones(
        self,
        params: QueryParams | None = None,
        *,
        full_response: Literal[True],
        project_id: str | None = None,
    ) -> TestPlanItemZonesListResponse | None: ...
    def list_test_plan_item_zones(
        self,
        params: QueryParams | None = None,
        full_response: bool = False,
        *,
        project_id: str | None = None,
    ) -> TestPlanItemZonesListResponse | list[TestPlanItemZone] | None:
        """GET /1.1/projects/{projectId}/testPlanItemZones.

        Args:
            params: Optional query parameters.
            full_response: If True, return the full TestPlanItemZonesListResponse
                (including metadata and links). If False (default), return
                just the list of TestPlanItemZone items.
            project_id: Project ID. Falls back to the client's configured default.
        """
        project_id = resolve_project_id(project_id, self._client.configuration.project_id)
        response = self._client.get(f"/1.1/projects/{project_id}/testPlanItemZones", params=params)
        result = convert_to_list_response(response, TestPlanItemZonesListResponse)
        if full_response:
            return result
        return result.items if result is not None else []

    def get_all_test_plan_item_zones(
        self,
        params: QueryParams | None = None,
        verbose: bool = False,
        *,
        project_id: str | None = None,
    ) -> list[TestPlanItemZone]:
        """Retrieve all test plan item zones by following bookmark pagination."""
        project_id = resolve_project_id(project_id, self._client.configuration.project_id)
        endpoint = f"/1.1/projects/{project_id}/testPlanItemZones"
        raw_items = paginate(endpoint, self._client, params, verbose)
        return TestPlanItemZonesListResponse.model_validate({"items": raw_items}).items

    @overload
    def list_test_plan_registrations(
        self,
        params: QueryParams | None = None,
        full_response: Literal[False] = False,
        *,
        project_id: str | None = None,
    ) -> list[TestPlanRegistration]: ...
    @overload
    def list_test_plan_registrations(
        self,
        params: QueryParams | None = None,
        *,
        full_response: Literal[True],
        project_id: str | None = None,
    ) -> TestPlanRegistrationsListResponse | None: ...
    def list_test_plan_registrations(
        self,
        params: QueryParams | None = None,
        full_response: bool = False,
        *,
        project_id: str | None = None,
    ) -> TestPlanRegistrationsListResponse | list[TestPlanRegistration] | None:
        """GET /1.1/projects/{projectId}/testPlanRegistrations.

        Args:
            params: Optional query parameters.
            full_response: If True, return the full TestPlanRegistrationsListResponse
                (including metadata and links). If False (default), return
                just the list of TestPlanRegistration items.
            project_id: Project ID. Falls back to the client's configured default.
        """
        project_id = resolve_project_id(project_id, self._client.configuration.project_id)
        response = self._client.get(
            f"/1.1/projects/{project_id}/testPlanRegistrations", params=params
        )
        result = convert_to_list_response(response, TestPlanRegistrationsListResponse)
        if full_response:
            return result
        return result.items if result is not None else []

    def get_all_test_plan_registrations(
        self,
        params: QueryParams | None = None,
        verbose: bool = False,
        *,
        project_id: str | None = None,
    ) -> list[TestPlanRegistration]:
        """Retrieve all test plan registrations by following bookmark pagination."""
        project_id = resolve_project_id(project_id, self._client.configuration.project_id)
        endpoint = f"/1.1/projects/{project_id}/testPlanRegistrations"
        raw_items = paginate(endpoint, self._client, params, verbose)
        return TestPlanRegistrationsListResponse.model_validate({"items": raw_items}).items
