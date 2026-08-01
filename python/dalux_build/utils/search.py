"""Search and filter utilities for working with API responses."""

from collections.abc import Callable, Iterable
from typing import TypeVar

from pydantic import BaseModel

T = TypeVar("T")


def find_by_field(
    items: Iterable[T],
    field: str,
    value: object,
    accessor: Callable[[T], object] | None = None,
) -> T | None:
    """Find first item where field equals value.

    Args:
        items: Iterable of items to search
        field: Field name to check
        value: Value to match
        accessor: Function to extract data from item (default: identity)

    Returns:
        First matching item or None
    """
    accessor = accessor or (lambda x: x)
    for item in items:
        item_data = accessor(item)
        # Handle Pydantic models
        if isinstance(item_data, BaseModel):
            # Try both the original field name and model field names
            model_dict = item_data.model_dump()
            if model_dict.get(field) == value:
                return item
            # Also try with aliases (API field names)
            try:
                model_dict_with_aliases = item_data.model_dump(by_alias=True)
                if model_dict_with_aliases.get(field) == value:
                    return item
            except Exception:
                pass
            # Also try to get the value using getattr with the original field name
            # This handles cases where Pydantic aliases are used
            try:
                if getattr(item_data, field, None) == value:
                    return item
            except AttributeError:
                pass
        # Handle regular dictionaries
        elif isinstance(item_data, dict) and item_data.get(field) == value:
            return item
    return None


def find_all_by_field(
    items: Iterable[T],
    field: str,
    value: object,
    accessor: Callable[[T], object] | None = None,
) -> list[T]:
    """Find all items where field equals value.

    Args:
        items: Iterable of items to search
        field: Field name to check
        value: Value to match
        accessor: Function to extract data from item (default: identity)

    Returns:
        List of all matching items
    """
    accessor = accessor or (lambda x: x)
    return [
        item
        for item in items
        for item_data in [accessor(item)]
        if (
            (
                isinstance(item_data, BaseModel)
                and (
                    item_data.model_dump().get(field) == value
                    or item_data.model_dump(by_alias=True).get(field) == value
                )
            )
            or (isinstance(item_data, dict) and item_data.get(field) == value)
        )
    ]


def find_by_field_path(
    items: Iterable[T],
    field_path: str,
    value: object,
    accessor: Callable[[T], object] | None = None,
    separator: str = ".",
) -> T | None:
    """Find first item where nested field equals value.

    Args:
        items: Iterable of items to search
        field_path: Dot-separated path to field (e.g., "data.folderName")
        value: Value to match
        accessor: Function to extract data from item (default: identity)
        separator: Separator for field path

    Returns:
        First matching item or None
    """
    accessor = accessor or (lambda x: x)

    def get_nested_value(data: object, path: str) -> object:
        """Get value from nested dictionary using dot notation."""
        parts = path.split(separator)
        current = data
        for part in parts:
            if isinstance(current, dict) and part in current:
                current = current[part]
            else:
                return None
        return current

    for item in items:
        item_data = accessor(item)
        nested_value = get_nested_value(item_data, field_path)
        if nested_value == value:
            return item

    return None
