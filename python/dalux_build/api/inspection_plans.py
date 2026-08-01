"""Inspection Plans API."""

from typing import Literal, overload

from ..api_client import ApiClient
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
from ..response_converter import convert_to_list_response
from ..utils.pagination import paginate
from ..utils.validation import resolve_project_id


class InspectionPlansApi:
    """Methods for inspection plans."""

    def __init__(self, api_client: ApiClient) -> None:
        self._client = api_client

    @overload
    def list_inspection_plans(
        self,
        params: QueryParams | None = None,
        full_response: Literal[False] = False,
        *,
        project_id: str | None = None,
    ) -> list[InspectionPlan]: ...
    @overload
    def list_inspection_plans(
        self,
        params: QueryParams | None = None,
        *,
        full_response: Literal[True],
        project_id: str | None = None,
    ) -> InspectionPlansListResponse | None: ...
    def list_inspection_plans(
        self,
        params: QueryParams | None = None,
        full_response: bool = False,
        *,
        project_id: str | None = None,
    ) -> InspectionPlansListResponse | list[InspectionPlan] | None:
        """GET /1.2/projects/{projectId}/inspectionPlans.

        Args:
            params: Optional query parameters.
            full_response: If True, return the full InspectionPlansListResponse
                (including metadata and links). If False (default), return
                just the list of InspectionPlan items.
            project_id: Project ID. Falls back to the client's configured default.

        Returns:
            List of InspectionPlan items, or the full InspectionPlansListResponse
            when full_response=True.
        """
        project_id = resolve_project_id(project_id, self._client.configuration.project_id)
        response = self._client.get(f"/1.2/projects/{project_id}/inspectionPlans", params=params)
        result = convert_to_list_response(response, InspectionPlansListResponse)
        if full_response:
            return result
        return result.items if result is not None else []

    def get_all_inspection_plans(
        self,
        params: QueryParams | None = None,
        verbose: bool = False,
        *,
        project_id: str | None = None,
    ) -> list[InspectionPlan]:
        """Retrieve all inspection plans by following bookmark pagination automatically.

        Args:
            params: Optional query parameters.
            verbose: Whether to print progress information.
            project_id: Project ID. Falls back to the client's configured default.

        Returns:
            List of all inspection plan items across pages.
        """
        project_id = resolve_project_id(project_id, self._client.configuration.project_id)
        endpoint = f"/1.2/projects/{project_id}/inspectionPlans"
        raw_items = paginate(endpoint, self._client, params, verbose)
        return InspectionPlansListResponse.model_validate({"items": raw_items}).items

    @overload
    def list_inspection_plan_items(
        self,
        params: QueryParams | None = None,
        full_response: Literal[False] = False,
        *,
        project_id: str | None = None,
    ) -> list[InspectionPlanItem]: ...
    @overload
    def list_inspection_plan_items(
        self,
        params: QueryParams | None = None,
        *,
        full_response: Literal[True],
        project_id: str | None = None,
    ) -> InspectionPlanItemsListResponse | None: ...
    def list_inspection_plan_items(
        self,
        params: QueryParams | None = None,
        full_response: bool = False,
        *,
        project_id: str | None = None,
    ) -> InspectionPlanItemsListResponse | list[InspectionPlanItem] | None:
        """GET /1.1/projects/{projectId}/inspectionPlanItems.

        Args:
            params: Optional query parameters.
            full_response: If True, return the full InspectionPlanItemsListResponse
                (including metadata and links). If False (default), return
                just the list of InspectionPlanItem items.
            project_id: Project ID. Falls back to the client's configured default.
        """
        project_id = resolve_project_id(project_id, self._client.configuration.project_id)
        response = self._client.get(
            f"/1.1/projects/{project_id}/inspectionPlanItems", params=params
        )
        result = convert_to_list_response(response, InspectionPlanItemsListResponse)
        if full_response:
            return result
        return result.items if result is not None else []

    def get_all_inspection_plan_items(
        self,
        params: QueryParams | None = None,
        verbose: bool = False,
        *,
        project_id: str | None = None,
    ) -> list[InspectionPlanItem]:
        """Retrieve all inspection plan items by following bookmark pagination."""
        project_id = resolve_project_id(project_id, self._client.configuration.project_id)
        endpoint = f"/1.1/projects/{project_id}/inspectionPlanItems"
        raw_items = paginate(endpoint, self._client, params, verbose)
        return InspectionPlanItemsListResponse.model_validate({"items": raw_items}).items

    @overload
    def list_inspection_plan_item_zones(
        self,
        params: QueryParams | None = None,
        full_response: Literal[False] = False,
        *,
        project_id: str | None = None,
    ) -> list[InspectionPlanItemZone]: ...
    @overload
    def list_inspection_plan_item_zones(
        self,
        params: QueryParams | None = None,
        *,
        full_response: Literal[True],
        project_id: str | None = None,
    ) -> InspectionPlanItemZonesListResponse | None: ...
    def list_inspection_plan_item_zones(
        self,
        params: QueryParams | None = None,
        full_response: bool = False,
        *,
        project_id: str | None = None,
    ) -> InspectionPlanItemZonesListResponse | list[InspectionPlanItemZone] | None:
        """GET /1.1/projects/{projectId}/inspectionPlanItemZones.

        Args:
            params: Optional query parameters.
            full_response: If True, return the full InspectionPlanItemZonesListResponse
                (including metadata and links). If False (default), return
                just the list of InspectionPlanItemZone items.
            project_id: Project ID. Falls back to the client's configured default.
        """
        project_id = resolve_project_id(project_id, self._client.configuration.project_id)
        response = self._client.get(
            f"/1.1/projects/{project_id}/inspectionPlanItemZones", params=params
        )
        result = convert_to_list_response(response, InspectionPlanItemZonesListResponse)
        if full_response:
            return result
        return result.items if result is not None else []

    def get_all_inspection_plan_item_zones(
        self,
        params: QueryParams | None = None,
        verbose: bool = False,
        *,
        project_id: str | None = None,
    ) -> list[InspectionPlanItemZone]:
        """Retrieve all inspection plan item zones by following bookmark pagination."""
        project_id = resolve_project_id(project_id, self._client.configuration.project_id)
        endpoint = f"/1.1/projects/{project_id}/inspectionPlanItemZones"
        raw_items = paginate(endpoint, self._client, params, verbose)
        return InspectionPlanItemZonesListResponse.model_validate({"items": raw_items}).items

    @overload
    def list_inspection_plan_registrations(
        self,
        params: QueryParams | None = None,
        full_response: Literal[False] = False,
        *,
        project_id: str | None = None,
    ) -> list[InspectionPlanRegistration]: ...
    @overload
    def list_inspection_plan_registrations(
        self,
        params: QueryParams | None = None,
        *,
        full_response: Literal[True],
        project_id: str | None = None,
    ) -> InspectionPlanRegistrationsListResponse | None: ...
    def list_inspection_plan_registrations(
        self,
        params: QueryParams | None = None,
        full_response: bool = False,
        *,
        project_id: str | None = None,
    ) -> InspectionPlanRegistrationsListResponse | list[InspectionPlanRegistration] | None:
        """GET /2.1/projects/{projectId}/inspectionPlanRegistrations.

        Args:
            params: Optional query parameters.
            full_response: If True, return the full InspectionPlanRegistrationsListResponse
                (including metadata and links). If False (default), return
                just the list of InspectionPlanRegistration items.
            project_id: Project ID. Falls back to the client's configured default.
        """
        project_id = resolve_project_id(project_id, self._client.configuration.project_id)
        response = self._client.get(
            f"/2.1/projects/{project_id}/inspectionPlanRegistrations", params=params
        )
        result = convert_to_list_response(response, InspectionPlanRegistrationsListResponse)
        if full_response:
            return result
        return result.items if result is not None else []

    def get_all_inspection_plan_registrations(
        self,
        params: QueryParams | None = None,
        verbose: bool = False,
        *,
        project_id: str | None = None,
    ) -> list[InspectionPlanRegistration]:
        """Retrieve all inspection plan registrations by following bookmark pagination."""
        project_id = resolve_project_id(project_id, self._client.configuration.project_id)
        endpoint = f"/2.1/projects/{project_id}/inspectionPlanRegistrations"
        raw_items = paginate(endpoint, self._client, params, verbose)
        return InspectionPlanRegistrationsListResponse.model_validate({"items": raw_items}).items
