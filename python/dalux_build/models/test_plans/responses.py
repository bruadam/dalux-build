"""API response models for Test Plans endpoint."""
import json
from typing import Any, Dict, List, Optional, Union

from pydantic import BaseModel, field_validator

from ..common import ItemsToDataFrameMixin, Link, Metadata
from .models import TestPlan, TestPlanItem, TestPlanItemZone, TestPlanRegistration


class TestPlansListResponse(ItemsToDataFrameMixin, BaseModel):
    """Response from GET /1.2/projects/{projectId}/testPlans - List test plans."""

    items: List[TestPlan] = []
    metadata: Optional[Metadata] = None
    links: Optional[List[Link]] = None

    class Config:
        populate_by_name = True

    @field_validator("items", mode="before")
    @classmethod
    def unwrap_items(cls, v):
        """Automatically unwrap items that have 'data' wrapper."""
        if not isinstance(v, list):
            return []

        unwrapped = []
        for item in v:
            data = item.get("data") if isinstance(item, dict) and "data" in item else item
            unwrapped.append(data)
        return unwrapped

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "TestPlansListResponse":
        """Create TestPlansListResponse from a dictionary."""
        return cls.model_validate(data)

    @classmethod
    def from_json(cls, json_str: Union[str, bytes]) -> "TestPlansListResponse":
        """Create TestPlansListResponse from a JSON string."""
        if isinstance(json_str, bytes):
            json_str = json_str.decode('utf-8')
        data = json.loads(json_str)
        return cls.from_dict(data)

    def to_dataframe(self) -> Any:
        """Convert test plan items to a flattened pandas DataFrame."""
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


class TestPlanItemsListResponse(ItemsToDataFrameMixin, BaseModel):
    """Response from GET /1.1/projects/{projectId}/testPlanItems."""

    items: List[TestPlanItem] = []
    metadata: Optional[Metadata] = None
    links: Optional[List[Link]] = None

    class Config:
        populate_by_name = True

    @field_validator("items", mode="before")
    @classmethod
    def unwrap_items(cls, v):
        """Automatically unwrap items that have 'data' wrapper."""
        if not isinstance(v, list):
            return []

        unwrapped = []
        for item in v:
            data = item.get("data") if isinstance(item, dict) and "data" in item else item
            unwrapped.append(data)
        return unwrapped


class TestPlanItemZonesListResponse(ItemsToDataFrameMixin, BaseModel):
    """Response from GET /1.1/projects/{projectId}/testPlanItemZones."""

    items: List[TestPlanItemZone] = []
    metadata: Optional[Metadata] = None
    links: Optional[List[Link]] = None

    class Config:
        populate_by_name = True

    @field_validator("items", mode="before")
    @classmethod
    def unwrap_items(cls, v):
        """Automatically unwrap items that have 'data' wrapper."""
        if not isinstance(v, list):
            return []

        unwrapped = []
        for item in v:
            data = item.get("data") if isinstance(item, dict) and "data" in item else item
            unwrapped.append(data)
        return unwrapped


class TestPlanRegistrationsListResponse(ItemsToDataFrameMixin, BaseModel):
    """Response from GET /1.1/projects/{projectId}/testPlanRegistrations."""

    items: List[TestPlanRegistration] = []
    metadata: Optional[Metadata] = None
    links: Optional[List[Link]] = None

    class Config:
        populate_by_name = True

    @field_validator("items", mode="before")
    @classmethod
    def unwrap_items(cls, v):
        """Automatically unwrap items that have 'data' wrapper."""
        if not isinstance(v, list):
            return []

        unwrapped = []
        for item in v:
            data = item.get("data") if isinstance(item, dict) and "data" in item else item
            unwrapped.append(data)
        return unwrapped
