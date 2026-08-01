"""Common base models shared across all API responses."""

from typing import TYPE_CHECKING

from pydantic import BaseModel, ConfigDict, Field

if TYPE_CHECKING:
    import pandas as pd


class Link(BaseModel):
    """API response link."""

    rel: str
    href: str
    method: str | None = None

    model_config = ConfigDict(populate_by_name=True)


class Metadata(BaseModel):
    """Response metadata with pagination info."""

    total_items: int | None = Field(None, alias="totalItems")
    total_remaining_items: int | None = Field(None, alias="totalRemainingItems")

    model_config = ConfigDict(populate_by_name=True)


class ItemsToDataFrameMixin:
    """Mixin adding dataframe export support for responses with an ``items`` field."""

    def to_dataframe(self) -> "pd.DataFrame":
        """Convert ``items`` to a flattened pandas DataFrame using ``::`` separators."""
        from ..response_converter import flatten_items_to_dataframe

        items: object = getattr(self, "items", None)
        return flatten_items_to_dataframe(items if isinstance(items, list) else [])
