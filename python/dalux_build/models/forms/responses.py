"""API response models for Forms endpoint."""

import json

from pydantic import BaseModel, ConfigDict, JsonValue, field_validator

from ..common import ItemsToDataFrameMixin, Link, Metadata


class FormsListResponse(ItemsToDataFrameMixin, BaseModel):
    """Response from GET /2.2/projects/{projectId}/forms - List forms."""

    items: list[dict[str, JsonValue]]
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
    def from_dict(cls, data: dict[str, JsonValue]) -> "FormsListResponse":
        """Create FormsListResponse from a dictionary."""
        return cls.model_validate(data)

    @classmethod
    def from_json(cls, json_str: str | bytes) -> "FormsListResponse":
        """Create FormsListResponse from a JSON string."""
        if isinstance(json_str, bytes):
            json_str = json_str.decode("utf-8")
        data = json.loads(json_str)
        return cls.from_dict(data)


class FormResponse(BaseModel):
    """Response from GET /1.3/projects/{projectId}/forms/{formId} - Get single form."""

    data: dict[str, JsonValue]
    links: list[Link] | None = None

    model_config = ConfigDict(populate_by_name=True)
