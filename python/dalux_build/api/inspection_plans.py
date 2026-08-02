"""Inspection Plans API."""

from typing import TYPE_CHECKING, Literal, overload

from ..api_client import ApiClient
from ..dashboards.api import DashboardApiMixin
from ..json_types import QueryParams
from ..models import (
    InspectionPlan,
    InspectionPlanItem,
    InspectionPlanItemsListResponse,
    InspectionPlanItemZone,
    InspectionPlanItemZonesListResponse,
    InspectionPlanRegistration,
    InspectionPlanRegistrationsListResponse,
    InspectionPlansListResponse,
)
from ..response_converter import convert_to_list_response, to_dataframe_or_empty
from ..utils.pagination import paginate
from ..utils.validation import resolve_project_id

if TYPE_CHECKING:
    import pandas as pd


class InspectionPlansApi(DashboardApiMixin):
    """Methods for inspection plans."""

    dashboard_resource = "inspection_plans"

    def __init__(self, api_client: ApiClient) -> None:
        self._client = api_client

    @overload
    def list_inspection_plans(
        self,
        params: QueryParams | None = None,
        full_response: Literal[False] = False,
        to_dataframe: Literal[False] = False,
        *,
        project_id: str | None = None,
    ) -> list[InspectionPlan]: ...
    @overload
    def list_inspection_plans(
        self,
        params: QueryParams | None = None,
        *,
        full_response: Literal[True],
        to_dataframe: Literal[False] = False,
        project_id: str | None = None,
    ) -> InspectionPlansListResponse | None: ...
    @overload
    def list_inspection_plans(
        self,
        params: QueryParams | None = None,
        full_response: bool = ...,
        *,
        to_dataframe: Literal[True],
        project_id: str | None = None,
    ) -> "pd.DataFrame": ...
    def list_inspection_plans(
        self,
        params: QueryParams | None = None,
        full_response: bool = False,
        to_dataframe: bool = False,
        *,
        project_id: str | None = None,
    ) -> "InspectionPlansListResponse | list[InspectionPlan] | pd.DataFrame | None":
        """GET /1.2/projects/{projectId}/inspectionPlans.

        Args:
            params: Optional query parameters.
            full_response: If True, return the full InspectionPlansListResponse
                (including metadata and links). If False (default), return
                just the list of InspectionPlan items.
            to_dataframe: If True, return the items flattened into a pandas
                DataFrame (requires pandas). Takes precedence over full_response.
            project_id: Project ID. Falls back to the client's configured default.

        Returns:
            List of InspectionPlan items, the full InspectionPlansListResponse
            when full_response=True, or a DataFrame when to_dataframe=True.
        """
        project_id = resolve_project_id(project_id, self._client.configuration.project_id)
        response = self._client.get(f"/1.2/projects/{project_id}/inspectionPlans", params=params)
        result = convert_to_list_response(response, InspectionPlansListResponse)
        if to_dataframe:
            return to_dataframe_or_empty(result)
        if full_response:
            return result
        return result.items if result is not None else []

    @overload
    def get_all_inspection_plans(
        self,
        params: QueryParams | None = None,
        verbose: bool = False,
        to_dataframe: Literal[False] = False,
        *,
        project_id: str | None = None,
    ) -> list[InspectionPlan]: ...
    @overload
    def get_all_inspection_plans(
        self,
        params: QueryParams | None = None,
        verbose: bool = False,
        *,
        to_dataframe: Literal[True],
        project_id: str | None = None,
    ) -> "pd.DataFrame": ...
    def get_all_inspection_plans(
        self,
        params: QueryParams | None = None,
        verbose: bool = False,
        to_dataframe: bool = False,
        *,
        project_id: str | None = None,
    ) -> "list[InspectionPlan] | pd.DataFrame":
        """Retrieve all inspection plans by following bookmark pagination automatically.

        Args:
            params: Optional query parameters.
            verbose: Whether to print progress information.
            to_dataframe: If True, return the items flattened into a pandas
                DataFrame (requires pandas) instead of a list.
            project_id: Project ID. Falls back to the client's configured default.

        Returns:
            List of all inspection plan items across pages, or a DataFrame
            when to_dataframe=True.
        """
        project_id = resolve_project_id(project_id, self._client.configuration.project_id)
        endpoint = f"/1.2/projects/{project_id}/inspectionPlans"
        raw_items = paginate(endpoint, self._client, params, verbose)
        result = InspectionPlansListResponse.model_validate({"items": raw_items})
        if to_dataframe:
            return result.to_dataframe()
        return result.items

    @overload
    def list_inspection_plan_items(
        self,
        params: QueryParams | None = None,
        full_response: Literal[False] = False,
        to_dataframe: Literal[False] = False,
        *,
        project_id: str | None = None,
    ) -> list[InspectionPlanItem]: ...
    @overload
    def list_inspection_plan_items(
        self,
        params: QueryParams | None = None,
        *,
        full_response: Literal[True],
        to_dataframe: Literal[False] = False,
        project_id: str | None = None,
    ) -> InspectionPlanItemsListResponse | None: ...
    @overload
    def list_inspection_plan_items(
        self,
        params: QueryParams | None = None,
        full_response: bool = ...,
        *,
        to_dataframe: Literal[True],
        project_id: str | None = None,
    ) -> "pd.DataFrame": ...
    def list_inspection_plan_items(
        self,
        params: QueryParams | None = None,
        full_response: bool = False,
        to_dataframe: bool = False,
        *,
        project_id: str | None = None,
    ) -> "InspectionPlanItemsListResponse | list[InspectionPlanItem] | pd.DataFrame | None":
        """GET /1.1/projects/{projectId}/inspectionPlanItems.

        Args:
            params: Optional query parameters.
            full_response: If True, return the full InspectionPlanItemsListResponse
                (including metadata and links). If False (default), return
                just the list of InspectionPlanItem items.
            to_dataframe: If True, return the items flattened into a pandas
                DataFrame (requires pandas). Takes precedence over full_response.
            project_id: Project ID. Falls back to the client's configured default.
        """
        project_id = resolve_project_id(project_id, self._client.configuration.project_id)
        response = self._client.get(
            f"/1.1/projects/{project_id}/inspectionPlanItems", params=params
        )
        result = convert_to_list_response(response, InspectionPlanItemsListResponse)
        if to_dataframe:
            return to_dataframe_or_empty(result)
        if full_response:
            return result
        return result.items if result is not None else []

    @overload
    def get_all_inspection_plan_items(
        self,
        params: QueryParams | None = None,
        verbose: bool = False,
        to_dataframe: Literal[False] = False,
        *,
        project_id: str | None = None,
    ) -> list[InspectionPlanItem]: ...
    @overload
    def get_all_inspection_plan_items(
        self,
        params: QueryParams | None = None,
        verbose: bool = False,
        *,
        to_dataframe: Literal[True],
        project_id: str | None = None,
    ) -> "pd.DataFrame": ...
    def get_all_inspection_plan_items(
        self,
        params: QueryParams | None = None,
        verbose: bool = False,
        to_dataframe: bool = False,
        *,
        project_id: str | None = None,
    ) -> "list[InspectionPlanItem] | pd.DataFrame":
        """Retrieve all inspection plan items by following bookmark pagination."""
        project_id = resolve_project_id(project_id, self._client.configuration.project_id)
        endpoint = f"/1.1/projects/{project_id}/inspectionPlanItems"
        raw_items = paginate(endpoint, self._client, params, verbose)
        result = InspectionPlanItemsListResponse.model_validate({"items": raw_items})
        if to_dataframe:
            return result.to_dataframe()
        return result.items

    @overload
    def list_inspection_plan_item_zones(
        self,
        params: QueryParams | None = None,
        full_response: Literal[False] = False,
        to_dataframe: Literal[False] = False,
        *,
        project_id: str | None = None,
    ) -> list[InspectionPlanItemZone]: ...
    @overload
    def list_inspection_plan_item_zones(
        self,
        params: QueryParams | None = None,
        *,
        full_response: Literal[True],
        to_dataframe: Literal[False] = False,
        project_id: str | None = None,
    ) -> InspectionPlanItemZonesListResponse | None: ...
    @overload
    def list_inspection_plan_item_zones(
        self,
        params: QueryParams | None = None,
        full_response: bool = ...,
        *,
        to_dataframe: Literal[True],
        project_id: str | None = None,
    ) -> "pd.DataFrame": ...
    def list_inspection_plan_item_zones(
        self,
        params: QueryParams | None = None,
        full_response: bool = False,
        to_dataframe: bool = False,
        *,
        project_id: str | None = None,
    ) -> "InspectionPlanItemZonesListResponse | list[InspectionPlanItemZone] | pd.DataFrame | None":
        """GET /1.1/projects/{projectId}/inspectionPlanItemZones.

        Args:
            params: Optional query parameters.
            full_response: If True, return the full InspectionPlanItemZonesListResponse
                (including metadata and links). If False (default), return
                just the list of InspectionPlanItemZone items.
            to_dataframe: If True, return the items flattened into a pandas
                DataFrame (requires pandas). Takes precedence over full_response.
            project_id: Project ID. Falls back to the client's configured default.
        """
        project_id = resolve_project_id(project_id, self._client.configuration.project_id)
        response = self._client.get(
            f"/1.1/projects/{project_id}/inspectionPlanItemZones", params=params
        )
        result = convert_to_list_response(response, InspectionPlanItemZonesListResponse)
        if to_dataframe:
            return to_dataframe_or_empty(result)
        if full_response:
            return result
        return result.items if result is not None else []

    @overload
    def get_all_inspection_plan_item_zones(
        self,
        params: QueryParams | None = None,
        verbose: bool = False,
        to_dataframe: Literal[False] = False,
        *,
        project_id: str | None = None,
    ) -> list[InspectionPlanItemZone]: ...
    @overload
    def get_all_inspection_plan_item_zones(
        self,
        params: QueryParams | None = None,
        verbose: bool = False,
        *,
        to_dataframe: Literal[True],
        project_id: str | None = None,
    ) -> "pd.DataFrame": ...
    def get_all_inspection_plan_item_zones(
        self,
        params: QueryParams | None = None,
        verbose: bool = False,
        to_dataframe: bool = False,
        *,
        project_id: str | None = None,
    ) -> "list[InspectionPlanItemZone] | pd.DataFrame":
        """Retrieve all inspection plan item zones by following bookmark pagination."""
        project_id = resolve_project_id(project_id, self._client.configuration.project_id)
        endpoint = f"/1.1/projects/{project_id}/inspectionPlanItemZones"
        raw_items = paginate(endpoint, self._client, params, verbose)
        result = InspectionPlanItemZonesListResponse.model_validate({"items": raw_items})
        if to_dataframe:
            return result.to_dataframe()
        return result.items

    @overload
    def list_inspection_plan_registrations(
        self,
        params: QueryParams | None = None,
        full_response: Literal[False] = False,
        to_dataframe: Literal[False] = False,
        *,
        project_id: str | None = None,
    ) -> list[InspectionPlanRegistration]: ...
    @overload
    def list_inspection_plan_registrations(
        self,
        params: QueryParams | None = None,
        *,
        full_response: Literal[True],
        to_dataframe: Literal[False] = False,
        project_id: str | None = None,
    ) -> InspectionPlanRegistrationsListResponse | None: ...
    @overload
    def list_inspection_plan_registrations(
        self,
        params: QueryParams | None = None,
        full_response: bool = ...,
        *,
        to_dataframe: Literal[True],
        project_id: str | None = None,
    ) -> "pd.DataFrame": ...
    def list_inspection_plan_registrations(
        self,
        params: QueryParams | None = None,
        full_response: bool = False,
        to_dataframe: bool = False,
        *,
        project_id: str | None = None,
    ) -> (
        "InspectionPlanRegistrationsListResponse | list[InspectionPlanRegistration] "
        "| pd.DataFrame | None"
    ):
        """GET /2.1/projects/{projectId}/inspectionPlanRegistrations.

        Args:
            params: Optional query parameters.
            full_response: If True, return the full InspectionPlanRegistrationsListResponse
                (including metadata and links). If False (default), return
                just the list of InspectionPlanRegistration items.
            to_dataframe: If True, return the items flattened into a pandas
                DataFrame (requires pandas). Takes precedence over full_response.
            project_id: Project ID. Falls back to the client's configured default.
        """
        project_id = resolve_project_id(project_id, self._client.configuration.project_id)
        response = self._client.get(
            f"/2.1/projects/{project_id}/inspectionPlanRegistrations", params=params
        )
        result = convert_to_list_response(response, InspectionPlanRegistrationsListResponse)
        if to_dataframe:
            return to_dataframe_or_empty(result)
        if full_response:
            return result
        return result.items if result is not None else []

    @overload
    def get_all_inspection_plan_registrations(
        self,
        params: QueryParams | None = None,
        verbose: bool = False,
        to_dataframe: Literal[False] = False,
        *,
        project_id: str | None = None,
    ) -> list[InspectionPlanRegistration]: ...
    @overload
    def get_all_inspection_plan_registrations(
        self,
        params: QueryParams | None = None,
        verbose: bool = False,
        *,
        to_dataframe: Literal[True],
        project_id: str | None = None,
    ) -> "pd.DataFrame": ...
    def get_all_inspection_plan_registrations(
        self,
        params: QueryParams | None = None,
        verbose: bool = False,
        to_dataframe: bool = False,
        *,
        project_id: str | None = None,
    ) -> "list[InspectionPlanRegistration] | pd.DataFrame":
        """Retrieve all inspection plan registrations by following bookmark pagination."""
        project_id = resolve_project_id(project_id, self._client.configuration.project_id)
        endpoint = f"/2.1/projects/{project_id}/inspectionPlanRegistrations"
        raw_items = paginate(endpoint, self._client, params, verbose)
        result = InspectionPlanRegistrationsListResponse.model_validate({"items": raw_items})
        if to_dataframe:
            return result.to_dataframe()
        return result.items
