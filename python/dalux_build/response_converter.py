"""Utilities for converting API responses to Pydantic models."""
from typing import Any, Type, TypeVar, Optional
from pydantic import BaseModel

T = TypeVar('T', bound=BaseModel)


def convert_to_model(response: Any, model_class: Type[T]) -> Optional[T]:
    """Convert a dict response to a Pydantic model instance.

    Args:
        response: The raw API response (dict or already a model).
        model_class: The Pydantic model class to convert to.

    Returns:
        The response as a model instance, or None if response is None.
    """
    if response is None:
        return None
    if isinstance(response, model_class):
        return response
    if isinstance(response, dict):
        try:
            return model_class.model_validate(response)
        except Exception as e:
            raise ValueError(f"Failed to convert response to {model_class.__name__}: {e}")
    raise TypeError(f"Expected dict or {model_class.__name__}, got {type(response)}")


def convert_to_model_list(items: Any, model_class: Type[T]) -> list[T]:
    """Convert a list of dicts to Pydantic model instances.

    Args:
        items: List of dicts or model instances.
        model_class: The Pydantic model class.

    Returns:
        List of model instances.
    """
    if not isinstance(items, list):
        return []
    return [convert_to_model(item, model_class) for item in items]
