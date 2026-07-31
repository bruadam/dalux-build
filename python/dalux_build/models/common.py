"""Common base models shared across all API responses."""
from typing import Any, Optional

from pydantic import BaseModel, Field


class Link(BaseModel):
    """API response link."""

    rel: str
    href: str
    method: Optional[str] = None

    class Config:
        populate_by_name = True


class Metadata(BaseModel):
    """Response metadata with pagination info."""

    total_items: Optional[int] = Field(None, alias="totalItems")
    total_remaining_items: Optional[int] = Field(None, alias="totalRemainingItems")

    class Config:
        populate_by_name = True


class ItemsToDataFrameMixin:
    """Mixin adding dataframe export support for responses with an ``items`` field."""

    def to_dataframe(self) -> Any:
        """Convert ``items`` to a flattened pandas DataFrame using ``::`` separators."""
        try:
            import pandas as pd
        except ImportError as exc:
            raise ImportError(
                "pandas is required for to_dataframe(). Install it with `pip install pandas`."
            ) from exc

        items = getattr(self, "items", None)
        if not items:
            return pd.DataFrame()

        rows = []
        for item in items:
            if hasattr(item, "model_dump"):
                rows.append(item.model_dump(by_alias=True, mode="json"))
            elif isinstance(item, dict):
                rows.append(item)
            else:
                rows.append({"value": item})

        return pd.json_normalize(rows, sep="::")
