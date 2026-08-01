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
        try:
            import pandas as pd
        except ImportError as exc:
            raise ImportError(
                "pandas is required for to_dataframe(). Install it with `pip install pandas`."
            ) from exc

        items: object = getattr(self, "items", None)
        if not items or not isinstance(items, list):
            return pd.DataFrame()

        rows: list[dict[str, object]] = []
        for item in items:
            if hasattr(item, "model_dump"):
                rows.append(item.model_dump(by_alias=True, mode="json"))
            elif isinstance(item, dict):
                rows.append(item)
            else:
                rows.append({"value": item})

        return pd.json_normalize(rows, sep="::")
