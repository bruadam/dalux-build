"""API response models for Inspection Plans endpoint."""

import json
from typing import TYPE_CHECKING

from pydantic import BaseModel, ConfigDict, field_validator

from ...json_types import JSONDict
from ..common import ItemsToDataFrameMixin, Link, Metadata

if TYPE_CHECKING:
    import pandas as pd
from .models import (
    InspectionPlan,
    InspectionPlanItem,
    InspectionPlanItemZone,
    InspectionPlanRegistration,
)


class InspectionPlansListResponse(ItemsToDataFrameMixin, BaseModel):
    """Response from GET /1.2/projects/{projectId}/inspectionPlans - List inspection plans."""

    items: list[InspectionPlan] = []
    metadata: Metadata | None = None
    links: list[Link] | None = None

    model_config = ConfigDict(populate_by_name=True)

    @field_validator("items", mode="before")
    @classmethod
    def unwrap_items(cls, v: object) -> list[object]:
        """Automatically unwrap items that have 'data' wrapper."""
        if not isinstance(v, list):
            return []

        unwrapped = []
        for item in v:
            data = item.get("data") if isinstance(item, dict) and "data" in item else item
            unwrapped.append(data)
        return unwrapped

    @classmethod
    def from_dict(cls, data: JSONDict) -> "InspectionPlansListResponse":
        """Create InspectionPlansListResponse from a dictionary."""
        return cls.model_validate(data)

    @classmethod
    def from_json(cls, json_str: str | bytes) -> "InspectionPlansListResponse":
        """Create InspectionPlansListResponse from a JSON string."""
        if isinstance(json_str, bytes):
            json_str = json_str.decode("utf-8")
        data = json.loads(json_str)
        return cls.from_dict(data)

    def to_dataframe(self) -> "pd.DataFrame":
        """Convert inspection plan items to a flattened pandas DataFrame."""
        try:
            import pandas as pd
        except ImportError as exc:
            raise ImportError(
                "pandas is required for to_dataframe(). Install it with `pip install pandas`."
            ) from exc

        if not self.items:
            return pd.DataFrame()

        rows = [item.model_dump(by_alias=True, mode="json") for item in self.items]
        return pd.json_normalize(rows, sep="::")


class InspectionPlanItemsListResponse(ItemsToDataFrameMixin, BaseModel):
    """Response from GET /1.1/projects/{projectId}/inspectionPlanItems."""

    items: list[InspectionPlanItem] = []
    metadata: Metadata | None = None
    links: list[Link] | None = None

    model_config = ConfigDict(populate_by_name=True)

    @field_validator("items", mode="before")
    @classmethod
    def unwrap_items(cls, v: object) -> list[object]:
        """Automatically unwrap items that have 'data' wrapper."""
        if not isinstance(v, list):
            return []

        unwrapped = []
        for item in v:
            data = item.get("data") if isinstance(item, dict) and "data" in item else item
            unwrapped.append(data)
        return unwrapped


class InspectionPlanItemZonesListResponse(ItemsToDataFrameMixin, BaseModel):
    """Response from GET /1.1/projects/{projectId}/inspectionPlanItemZones."""

    items: list[InspectionPlanItemZone] = []
    metadata: Metadata | None = None
    links: list[Link] | None = None

    model_config = ConfigDict(populate_by_name=True)

    @field_validator("items", mode="before")
    @classmethod
    def unwrap_items(cls, v: object) -> list[object]:
        """Automatically unwrap items that have 'data' wrapper."""
        if not isinstance(v, list):
            return []

        unwrapped = []
        for item in v:
            data = item.get("data") if isinstance(item, dict) and "data" in item else item
            unwrapped.append(data)
        return unwrapped


class InspectionPlanRegistrationsListResponse(ItemsToDataFrameMixin, BaseModel):
    """Response from GET /2.1/projects/{projectId}/inspectionPlanRegistrations."""

    items: list[InspectionPlanRegistration] = []
    metadata: Metadata | None = None
    links: list[Link] | None = None

    model_config = ConfigDict(populate_by_name=True)

    @field_validator("items", mode="before")
    @classmethod
    def unwrap_items(cls, v: object) -> list[object]:
        """Automatically unwrap items that have 'data' wrapper."""
        if not isinstance(v, list):
            return []

        unwrapped = []
        for item in v:
            data = item.get("data") if isinstance(item, dict) and "data" in item else item
            unwrapped.append(data)
        return unwrapped
