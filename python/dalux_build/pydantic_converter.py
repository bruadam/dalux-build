"""Utility for converting API responses to Pydantic models."""
from typing import Any, Dict, List, Optional, Type, TypeVar

from pydantic import BaseModel

T = TypeVar("T", bound=BaseModel)


def convert_to_pydantic(data: Any, model: Type[T]) -> Optional[T]:
    """Convert a dict to a Pydantic model instance.

    Args:
        data: Dictionary to convert
        model: Pydantic model class

    Returns:
        Model instance if data is valid, None if data is None
    """
    if data is None:
        return None
    try:
        return model(**data)
    except Exception:
        return None


def convert_list_response(
    response: Any, model: Type[T]
) -> "ListResponse[T]":
    """Convert a list response with items to Pydantic models.

    Handles responses like:
    {
        "items": [...],
        "links": [...],
        "metadata": {...}
    }

    Args:
        response: Response dict
        model: Pydantic model class for items

    Returns:
        ListResponse with converted items
    """
    if not isinstance(response, dict):
        return response

    items = response.get("items", [])
    converted_items = []

    for item in items:
        if isinstance(item, dict) and "data" in item:
            # Handle wrapped response like {"data": {...}, "links": [...]}
            data = item.get("data")
            if data:
                converted_items.append(convert_to_pydantic(data, model))
        else:
            # Handle direct response
            converted_items.append(convert_to_pydantic(item, model))

    # Return a dict-like object with converted items
    result = dict(response)
    result["items"] = [item for item in converted_items if item is not None]
    return result


class ListResponse(dict):
    """A dict subclass that provides both dict and attribute access.

    Allows accessing response fields as both dict keys and attributes.
    Prioritizes dict content over built-in methods.
    """

    def __getattr__(self, name: str) -> Any:
        # First check if name is in dict content
        if name in self:
            return self[name]
        # Then try to get the actual attribute
        try:
            return super().__getattribute__(name)
        except AttributeError:
            raise AttributeError(f"'ListResponse' object has no attribute '{name}'")

    def __setattr__(self, name: str, value: Any) -> None:
        self[name] = value

    def __dir__(self) -> List[str]:
        return list(self.keys())
