"""Test Plans API."""

from typing import TYPE_CHECKING, Literal, overload

from ..api_client import ApiClient
from ..dashboards.api import DashboardApiMixin
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
from ..response_converter import convert_to_list_response, to_dataframe_or_empty
from ..utils.pagination import paginate
from ..utils.validation import resolve_project_id

if TYPE_CHECKING:
    import pandas as pd


class TestPlansApi(DashboardApiMixin):
    """Methods for test plans."""

    dashboard_resource = "test_plans"

    def __init__(self, api_client: ApiClient) -> None:
        self._client = api_client

    @overload
    def list_test_plans(
        self,
        params: QueryParams | None = None,
        full_response: Literal[False] = False,
        to_dataframe: Literal[False] = False,
        *,
        project_id: str | None = None,
    ) -> list[TestPlan]: ...
    @overload
    def list_test_plans(
        self,
        params: QueryParams | None = None,
        *,
        full_response: Literal[True],
        to_dataframe: Literal[False] = False,
        project_id: str | None = None,
    ) -> TestPlansListResponse | None: ...
    @overload
    def list_test_plans(
        self,
        params: QueryParams | None = None,
        full_response: bool = ...,
        *,
        to_dataframe: Literal[True],
        project_id: str | None = None,
    ) -> "pd.DataFrame": ...
    def list_test_plans(
        self,
        params: QueryParams | None = None,
        full_response: bool = False,
        to_dataframe: bool = False,
        *,
        project_id: str | None = None,
    ) -> "TestPlansListResponse | list[TestPlan] | pd.DataFrame | None":
        """GET /1.2/projects/{projectId}/testPlans.

        Args:
            params: Optional query parameters.
            full_response: If True, return the full TestPlansListResponse
                (including metadata and links). If False (default), return
                just the list of TestPlan items.
            to_dataframe: If True, return the items flattened into a pandas
                DataFrame (requires pandas). Takes precedence over full_response.
            project_id: Project ID. Falls back to the client's configured default.

        Returns:
            List of TestPlan items, the full TestPlansListResponse
            when full_response=True, or a DataFrame when to_dataframe=True.
        """
        project_id = resolve_project_id(project_id, self._client.configuration.project_id)
        response = self._client.get(f"/1.2/projects/{project_id}/testPlans", params=params)
        result = convert_to_list_response(response, TestPlansListResponse)
        if to_dataframe:
            return to_dataframe_or_empty(result)
        if full_response:
            return result
        return result.items if result is not None else []

    @overload
    def get_all_test_plans(
        self,
        params: QueryParams | None = None,
        verbose: bool = False,
        to_dataframe: Literal[False] = False,
        *,
        project_id: str | None = None,
    ) -> list[TestPlan]: ...
    @overload
    def get_all_test_plans(
        self,
        params: QueryParams | None = None,
        verbose: bool = False,
        *,
        to_dataframe: Literal[True],
        project_id: str | None = None,
    ) -> "pd.DataFrame": ...
    def get_all_test_plans(
        self,
        params: QueryParams | None = None,
        verbose: bool = False,
        to_dataframe: bool = False,
        *,
        project_id: str | None = None,
    ) -> "list[TestPlan] | pd.DataFrame":
        """Retrieve all test plans by following bookmark pagination automatically.

        Args:
            params: Optional query parameters.
            verbose: Whether to print progress information.
            to_dataframe: If True, return the items flattened into a pandas
                DataFrame (requires pandas) instead of a list.
            project_id: Project ID. Falls back to the client's configured default.

        Returns:
            List of all test plan items across pages, or a DataFrame when
            to_dataframe=True.
        """
        project_id = resolve_project_id(project_id, self._client.configuration.project_id)
        endpoint = f"/1.2/projects/{project_id}/testPlans"
        raw_items = paginate(endpoint, self._client, params, verbose)
        result = TestPlansListResponse.model_validate({"items": raw_items})
        if to_dataframe:
            return result.to_dataframe()
        return result.items

    @overload
    def list_test_plan_items(
        self,
        params: QueryParams | None = None,
        full_response: Literal[False] = False,
        to_dataframe: Literal[False] = False,
        *,
        project_id: str | None = None,
    ) -> list[TestPlanItem]: ...
    @overload
    def list_test_plan_items(
        self,
        params: QueryParams | None = None,
        *,
        full_response: Literal[True],
        to_dataframe: Literal[False] = False,
        project_id: str | None = None,
    ) -> TestPlanItemsListResponse | None: ...
    @overload
    def list_test_plan_items(
        self,
        params: QueryParams | None = None,
        full_response: bool = ...,
        *,
        to_dataframe: Literal[True],
        project_id: str | None = None,
    ) -> "pd.DataFrame": ...
    def list_test_plan_items(
        self,
        params: QueryParams | None = None,
        full_response: bool = False,
        to_dataframe: bool = False,
        *,
        project_id: str | None = None,
    ) -> "TestPlanItemsListResponse | list[TestPlanItem] | pd.DataFrame | None":
        """GET /1.1/projects/{projectId}/testPlanItems.

        Args:
            params: Optional query parameters.
            full_response: If True, return the full TestPlanItemsListResponse
                (including metadata and links). If False (default), return
                just the list of TestPlanItem items.
            to_dataframe: If True, return the items flattened into a pandas
                DataFrame (requires pandas). Takes precedence over full_response.
            project_id: Project ID. Falls back to the client's configured default.
        """
        project_id = resolve_project_id(project_id, self._client.configuration.project_id)
        response = self._client.get(f"/1.1/projects/{project_id}/testPlanItems", params=params)
        result = convert_to_list_response(response, TestPlanItemsListResponse)
        if to_dataframe:
            return to_dataframe_or_empty(result)
        if full_response:
            return result
        return result.items if result is not None else []

    @overload
    def get_all_test_plan_items(
        self,
        params: QueryParams | None = None,
        verbose: bool = False,
        to_dataframe: Literal[False] = False,
        *,
        project_id: str | None = None,
    ) -> list[TestPlanItem]: ...
    @overload
    def get_all_test_plan_items(
        self,
        params: QueryParams | None = None,
        verbose: bool = False,
        *,
        to_dataframe: Literal[True],
        project_id: str | None = None,
    ) -> "pd.DataFrame": ...
    def get_all_test_plan_items(
        self,
        params: QueryParams | None = None,
        verbose: bool = False,
        to_dataframe: bool = False,
        *,
        project_id: str | None = None,
    ) -> "list[TestPlanItem] | pd.DataFrame":
        """Retrieve all test plan items by following bookmark pagination."""
        project_id = resolve_project_id(project_id, self._client.configuration.project_id)
        endpoint = f"/1.1/projects/{project_id}/testPlanItems"
        raw_items = paginate(endpoint, self._client, params, verbose)
        result = TestPlanItemsListResponse.model_validate({"items": raw_items})
        if to_dataframe:
            return result.to_dataframe()
        return result.items

    @overload
    def list_test_plan_item_zones(
        self,
        params: QueryParams | None = None,
        full_response: Literal[False] = False,
        to_dataframe: Literal[False] = False,
        *,
        project_id: str | None = None,
    ) -> list[TestPlanItemZone]: ...
    @overload
    def list_test_plan_item_zones(
        self,
        params: QueryParams | None = None,
        *,
        full_response: Literal[True],
        to_dataframe: Literal[False] = False,
        project_id: str | None = None,
    ) -> TestPlanItemZonesListResponse | None: ...
    @overload
    def list_test_plan_item_zones(
        self,
        params: QueryParams | None = None,
        full_response: bool = ...,
        *,
        to_dataframe: Literal[True],
        project_id: str | None = None,
    ) -> "pd.DataFrame": ...
    def list_test_plan_item_zones(
        self,
        params: QueryParams | None = None,
        full_response: bool = False,
        to_dataframe: bool = False,
        *,
        project_id: str | None = None,
    ) -> "TestPlanItemZonesListResponse | list[TestPlanItemZone] | pd.DataFrame | None":
        """GET /1.1/projects/{projectId}/testPlanItemZones.

        Args:
            params: Optional query parameters.
            full_response: If True, return the full TestPlanItemZonesListResponse
                (including metadata and links). If False (default), return
                just the list of TestPlanItemZone items.
            to_dataframe: If True, return the items flattened into a pandas
                DataFrame (requires pandas). Takes precedence over full_response.
            project_id: Project ID. Falls back to the client's configured default.
        """
        project_id = resolve_project_id(project_id, self._client.configuration.project_id)
        response = self._client.get(f"/1.1/projects/{project_id}/testPlanItemZones", params=params)
        result = convert_to_list_response(response, TestPlanItemZonesListResponse)
        if to_dataframe:
            return to_dataframe_or_empty(result)
        if full_response:
            return result
        return result.items if result is not None else []

    @overload
    def get_all_test_plan_item_zones(
        self,
        params: QueryParams | None = None,
        verbose: bool = False,
        to_dataframe: Literal[False] = False,
        *,
        project_id: str | None = None,
    ) -> list[TestPlanItemZone]: ...
    @overload
    def get_all_test_plan_item_zones(
        self,
        params: QueryParams | None = None,
        verbose: bool = False,
        *,
        to_dataframe: Literal[True],
        project_id: str | None = None,
    ) -> "pd.DataFrame": ...
    def get_all_test_plan_item_zones(
        self,
        params: QueryParams | None = None,
        verbose: bool = False,
        to_dataframe: bool = False,
        *,
        project_id: str | None = None,
    ) -> "list[TestPlanItemZone] | pd.DataFrame":
        """Retrieve all test plan item zones by following bookmark pagination."""
        project_id = resolve_project_id(project_id, self._client.configuration.project_id)
        endpoint = f"/1.1/projects/{project_id}/testPlanItemZones"
        raw_items = paginate(endpoint, self._client, params, verbose)
        result = TestPlanItemZonesListResponse.model_validate({"items": raw_items})
        if to_dataframe:
            return result.to_dataframe()
        return result.items

    @overload
    def list_test_plan_registrations(
        self,
        params: QueryParams | None = None,
        full_response: Literal[False] = False,
        to_dataframe: Literal[False] = False,
        *,
        project_id: str | None = None,
    ) -> list[TestPlanRegistration]: ...
    @overload
    def list_test_plan_registrations(
        self,
        params: QueryParams | None = None,
        *,
        full_response: Literal[True],
        to_dataframe: Literal[False] = False,
        project_id: str | None = None,
    ) -> TestPlanRegistrationsListResponse | None: ...
    @overload
    def list_test_plan_registrations(
        self,
        params: QueryParams | None = None,
        full_response: bool = ...,
        *,
        to_dataframe: Literal[True],
        project_id: str | None = None,
    ) -> "pd.DataFrame": ...
    def list_test_plan_registrations(
        self,
        params: QueryParams | None = None,
        full_response: bool = False,
        to_dataframe: bool = False,
        *,
        project_id: str | None = None,
    ) -> "TestPlanRegistrationsListResponse | list[TestPlanRegistration] | pd.DataFrame | None":
        """GET /1.1/projects/{projectId}/testPlanRegistrations.

        Args:
            params: Optional query parameters.
            full_response: If True, return the full TestPlanRegistrationsListResponse
                (including metadata and links). If False (default), return
                just the list of TestPlanRegistration items.
            to_dataframe: If True, return the items flattened into a pandas
                DataFrame (requires pandas). Takes precedence over full_response.
            project_id: Project ID. Falls back to the client's configured default.
        """
        project_id = resolve_project_id(project_id, self._client.configuration.project_id)
        response = self._client.get(
            f"/1.1/projects/{project_id}/testPlanRegistrations", params=params
        )
        result = convert_to_list_response(response, TestPlanRegistrationsListResponse)
        if to_dataframe:
            return to_dataframe_or_empty(result)
        if full_response:
            return result
        return result.items if result is not None else []

    @overload
    def get_all_test_plan_registrations(
        self,
        params: QueryParams | None = None,
        verbose: bool = False,
        to_dataframe: Literal[False] = False,
        *,
        project_id: str | None = None,
    ) -> list[TestPlanRegistration]: ...
    @overload
    def get_all_test_plan_registrations(
        self,
        params: QueryParams | None = None,
        verbose: bool = False,
        *,
        to_dataframe: Literal[True],
        project_id: str | None = None,
    ) -> "pd.DataFrame": ...
    def get_all_test_plan_registrations(
        self,
        params: QueryParams | None = None,
        verbose: bool = False,
        to_dataframe: bool = False,
        *,
        project_id: str | None = None,
    ) -> "list[TestPlanRegistration] | pd.DataFrame":
        """Retrieve all test plan registrations by following bookmark pagination."""
        project_id = resolve_project_id(project_id, self._client.configuration.project_id)
        endpoint = f"/1.1/projects/{project_id}/testPlanRegistrations"
        raw_items = paginate(endpoint, self._client, params, verbose)
        result = TestPlanRegistrationsListResponse.model_validate({"items": raw_items})
        if to_dataframe:
            return result.to_dataframe()
        return result.items
